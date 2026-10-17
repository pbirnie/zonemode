/**
 * Profile-filter test bench — see docs/PRD-test-bench.md
 */

import {
  MAX_CLASSIFIER_LABEL_CHARS,
  MAX_CLASSIFIER_LABELS,
  MAX_CLASSIFIER_TEXT_CHARS,
} from "../shared/classifierConstants";
import type {
  ProfileFilterMetadataEntry,
  ProfileFilterVideoResult,
} from "../shared/profileFilterMessages";
import { stripUrlsForClassifierText } from "../shared/profileFilterClassifierText";
import {
  finalizeProfileVideoResult,
  keywordMatchTermsFromVideoKeywordsAndAuthor,
} from "../shared/profileFilterScoring";
import {
  TEST_BENCH_GET_METADATA_SNAPSHOT,
  type TestBenchGetMetadataSnapshotBgResponse,
} from "../shared/testBenchMessages";

import sampleRows from "./sample-data.json";

function runtimeSendMessage<T>(msg: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError?.message) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

type SampleRow = {
  videoId: string;
  title: string;
  shortDescription: string;
  author: string;
  channel: string;
  viewCount?: number;
  category?: string;
  keywords?: string[];
  tags?: string[];
};

type TestBenchRow =
  | { kind: "sample"; videoId: string; sample: SampleRow }
  | {
      kind: "cache";
      videoId: string;
      entry: ProfileFilterMetadataEntry;
      fetchedAt: number;
    };

const sampleSource = sampleRows as SampleRow[];

let activeBenchRows: TestBenchRow[] = [];

function benchRowsFromSample(): TestBenchRow[] {
  return sampleSource.map((s) => ({
    kind: "sample" as const,
    videoId: s.videoId,
    sample: s,
  }));
}

function getDataSource(): "sample" | "youtube" {
  const el = document.querySelector(
    'input[name="dataSource"]:checked'
  ) as HTMLInputElement | null;
  return el?.value === "youtube" ? "youtube" : "sample";
}

function normalizeLabels(candidateLabels: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidateLabels) {
    const k = raw.trim().slice(0, MAX_CLASSIFIER_LABEL_CHARS);
    if (!k) continue;
    const low = k.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    out.push(k);
    if (out.length >= MAX_CLASSIFIER_LABELS) break;
  }
  return out;
}

function parseKeywordsInput(raw: string): string[] {
  return normalizeLabels(
    raw
      .split(/[,|\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function pushSampleTerm(parts: string[], raw: string): void {
  const s = raw.trim();
  if (!s) return;
  if (s.includes(",")) {
    for (const piece of s.split(",")) {
      const t = piece.trim();
      if (t) parts.push(t);
    }
    return;
  }
  parts.push(s);
}

function metadataTermsFromSample(row: SampleRow): string[] {
  const parts: string[] = [];
  if (row.title) pushSampleTerm(parts, row.title);
  if (row.author) pushSampleTerm(parts, row.author);
  if (row.channel) pushSampleTerm(parts, row.channel);
  if (row.shortDescription) pushSampleTerm(parts, row.shortDescription);
  if (row.category) pushSampleTerm(parts, row.category);
  if (Array.isArray(row.keywords)) {
    for (const k of row.keywords) {
      if (typeof k === "string" && k) pushSampleTerm(parts, k);
    }
  }
  if (Array.isArray(row.tags)) {
    for (const t of row.tags) {
      if (typeof t === "string" && t) pushSampleTerm(parts, t);
    }
  }
  return parts;
}

function innertubeKeywordsDisplayFromSample(row: SampleRow): string {
  if (!Array.isArray(row.keywords) || row.keywords.length === 0) return "";
  return row.keywords
    .map((k) => (typeof k === "string" ? k.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

function buildClassifierText(row: SampleRow): string {
  const parts: string[] = [];
  if (row.title.trim()) parts.push(row.title.trim());
  if (row.shortDescription.trim()) parts.push(row.shortDescription.trim());
  return stripUrlsForClassifierText(parts.join("\n\n"));
}

function entryFromSample(row: SampleRow): ProfileFilterMetadataEntry {
  const terms = metadataTermsFromSample(row);
  const innertubeTokenized = Array.isArray(row.keywords) ? row.keywords : [];
  const authorForMatch =
    typeof row.author === "string" && row.author.trim()
      ? row.author.trim()
      : typeof row.channel === "string" && row.channel.trim()
        ? row.channel.trim()
        : undefined;
  const videoKeywordsLower = keywordMatchTermsFromVideoKeywordsAndAuthor(
    innertubeTokenized,
    authorForMatch
  );
  return {
    haystackLower: terms.join("\n").toLowerCase(),
    metadataTermsLower: terms.map((t) => t.toLowerCase()),
    videoKeywordsLower,
    previewTitle: row.title,
    classifierText: buildClassifierText(row),
    ...(typeof row.author === "string" && row.author.trim()
      ? { author: row.author.trim() }
      : {}),
    ...(typeof row.viewCount === "number" &&
    Number.isFinite(row.viewCount) &&
    row.viewCount >= 0
      ? { viewCount: row.viewCount }
      : {}),
  };
}

function rowDisplayTitle(r: TestBenchRow): string {
  return r.kind === "sample" ? r.sample.title : r.entry.previewTitle;
}

const viewCountFormatter = new Intl.NumberFormat("en-US");

function rowDisplayAuthor(r: TestBenchRow): string {
  if (r.kind === "sample") {
    return r.sample.author?.trim()
      ? r.sample.author.trim()
      : r.sample.channel?.trim() || "—";
  }
  const a = r.entry.author?.trim();
  return a ? a : "—";
}

function rowDisplayViewCount(r: TestBenchRow): string {
  if (r.kind === "sample") {
    const n = r.sample.viewCount;
    return typeof n === "number" && Number.isFinite(n)
      ? viewCountFormatter.format(Math.round(n))
      : "—";
  }
  const n = r.entry.viewCount;
  return typeof n === "number" && Number.isFinite(n)
    ? viewCountFormatter.format(Math.round(n))
    : "—";
}

function rowDisplayKeywords(r: TestBenchRow): string {
  if (r.kind === "sample") {
    return innertubeKeywordsDisplayFromSample(r.sample) || "—";
  }
  const k = r.entry.videoKeywordsLower ?? [];
  return k.length > 0 ? k.join(", ") : "—";
}

function rowDisplayDescription(r: TestBenchRow): string {
  if (r.kind === "sample") return r.sample.shortDescription || "—";
  return r.entry.classifierText || "—";
}

function resolveEntry(row: TestBenchRow): ProfileFilterMetadataEntry {
  if (row.kind === "cache") return row.entry;
  return entryFromSample(row.sample);
}

function classificationCellHtml(finalized: ProfileFilterVideoResult): string {
  const main = `${escapeHtml(finalized.disposition)}${
    finalized.matchVia ? ` (${escapeHtml(finalized.matchVia)})` : ""
  }${
    finalized.matchedKeyword
      ? `<br /><small>keyword: ${escapeHtml(finalized.matchedKeyword)}</small>`
      : ""
  }`;
  return main;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

function showYoutubePlaceholder(tbody: HTMLTableSectionElement): void {
  tbody.replaceChildren();
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="7" class="placeholder-hint"><em>Open a YouTube tab (a <code>/watch</code> page with sidebar tiles scanned is best). Click <strong>Load from YouTube tab</strong> to pull the in-tab <code>profileFilterMetaCache</code> Map into this table.</em></td>`;
  tbody.appendChild(tr);
}

function renderMetadataRows(
  rows: TestBenchRow[],
  tbody: HTMLTableSectionElement
): void {
  tbody.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.dataset.videoId = row.videoId;
    tr.innerHTML = [
      `<td class="col-id">${escapeHtml(row.videoId)}</td>`,
      `<td class="col-title">${escapeHtml(rowDisplayTitle(row))}</td>`,
      `<td class="col-author">${escapeHtml(rowDisplayAuthor(row))}</td>`,
      `<td class="col-views">${escapeHtml(rowDisplayViewCount(row))}</td>`,
      `<td class="col-keywords">${escapeHtml(rowDisplayKeywords(row))}</td>`,
      `<td class="col-description">${escapeHtml(rowDisplayDescription(row))}</td>`,
      `<td class="col-classification cell-classification">${escapeHtml("—")}</td>`,
    ].join("");
    tbody.appendChild(tr);
  }
}

function syncUiForDataSource(tbody: HTMLTableSectionElement): void {
  const loadBtn = $("loadYoutubeCache") as HTMLButtonElement;
  if (getDataSource() === "sample") {
    loadBtn.disabled = true;
    activeBenchRows = benchRowsFromSample();
    renderMetadataRows(activeBenchRows, tbody);
  } else {
    loadBtn.disabled = false;
    activeBenchRows = [];
    showYoutubePlaceholder(tbody);
  }
}

function main(): void {
  const tbody = $("tbody") as HTMLTableSectionElement;
  const summaryEl = $("summary");
  const configEcho = $("configEcho");
  const errEl = $("error");
  const reclassifyBtn = $("reclassify") as HTMLButtonElement;
  const loadYoutubeBtn = $("loadYoutubeCache") as HTMLButtonElement;

  activeBenchRows = benchRowsFromSample();
  renderMetadataRows(activeBenchRows, tbody);
  (loadYoutubeBtn as HTMLButtonElement).disabled = true;

  for (const el of document.querySelectorAll<HTMLInputElement>(
    'input[name="dataSource"]'
  )) {
    el.addEventListener("change", () => syncUiForDataSource(tbody));
  }

  loadYoutubeBtn.addEventListener("click", () => {
    void (async () => {
      errEl.hidden = true;
      errEl.textContent = "";
      loadYoutubeBtn.disabled = true;
      try {
        const res = await runtimeSendMessage<TestBenchGetMetadataSnapshotBgResponse>(
          { type: TEST_BENCH_GET_METADATA_SNAPSHOT }
        );
        if (!res.ok) {
          errEl.hidden = false;
          errEl.textContent = res.error;
          return;
        }
        if (res.rows.length === 0) {
          errEl.hidden = false;
          errEl.textContent =
            "Metadata cache is empty on that tab. Open a /watch page and let the profile filter scan sidebar videos, then try again.";
          activeBenchRows = [];
          tbody.replaceChildren();
          return;
        }
        activeBenchRows = res.rows.map((r) => ({
          kind: "cache" as const,
          videoId: r.videoId,
          entry: r.entry,
          fetchedAt: r.fetchedAt,
        }));
        renderMetadataRows(activeBenchRows, tbody);
        configEcho.textContent = [
          `loadedFrom=youtube tab ${res.tabId}`,
          res.tabUrl ? `tabUrl=${res.tabUrl}` : "",
          `rows=${res.rows.length}`,
        ]
          .filter(Boolean)
          .join("\n");
      } catch (e) {
        errEl.hidden = false;
        errEl.textContent =
          e instanceof Error ? e.message : `Load failed: ${String(e)}`;
      } finally {
        if (getDataSource() === "youtube") loadYoutubeBtn.disabled = false;
      }
    })();
  });

  reclassifyBtn.addEventListener("click", () => {
    void reclassify(tbody, summaryEl, configEcho, errEl, reclassifyBtn);
  });
}

async function reclassify(
  tbody: HTMLTableSectionElement,
  summaryEl: HTMLElement,
  configEcho: HTMLElement,
  errEl: HTMLElement,
  reclassifyBtn: HTMLButtonElement
): Promise<void> {
  errEl.hidden = true;
  errEl.textContent = "";

  const dataSource = getDataSource();
  if (dataSource === "youtube" && activeBenchRows.length === 0) {
    errEl.hidden = false;
    errEl.textContent =
      "Load metadata from a YouTube tab first (or switch to Sample JSON).";
    return;
  }

  const keywordsRaw = ($("keywords") as HTMLInputElement).value;
  const labels = parseKeywordsInput(keywordsRaw);

  if (labels.length === 0) {
    errEl.hidden = false;
    errEl.textContent = "Enter at least one keyword / label.";
    return;
  }

  reclassifyBtn.disabled = true;

  const cfgLines = [
    `dataSource=${dataSource}`,
    `matcher=finalizeProfileVideoResult (metadata_exact only)`,
    dataSource === "sample"
      ? `classifierText=title+shortDescription (sample rows)`
      : `classifierText=cached per row`,
    `labelCount=${labels.length}`,
    `rows=${activeBenchRows.length}`,
  ];
  configEcho.textContent = cfgLines.join("\n");

  const rowEls = tbody.querySelectorAll<HTMLTableRowElement>("tr[data-video-id]");
  for (let i = 0; i < rowEls.length; i++) {
    const tr = rowEls[i]!;
    const vid = tr.dataset.videoId;
    const benchRow = activeBenchRows.find((r) => r.videoId === vid);
    if (!benchRow) continue;

    const classCell = tr.querySelector(".cell-classification");
    if (!(classCell instanceof HTMLTableCellElement)) continue;

    classCell.textContent = "…";

    const entry = resolveEntry(benchRow);
    void entry.classifierText.trim().slice(0, MAX_CLASSIFIER_TEXT_CHARS);

    const finalized = finalizeProfileVideoResult(
      entry,
      benchRow.videoId,
      labels
    );
    classCell.innerHTML = classificationCellHtml(finalized);
  }

  summaryEl.innerHTML = [
    `<strong>Data</strong>: ${escapeHtml(dataSource)}`,
    `<strong>Matcher</strong>: Innertube <code>videoKeywordsLower</code> vs profile keywords (<code>metadata_exact</code>)`,
    `<strong>Rows</strong>: ${escapeHtml(String(rowEls.length))}`,
  ].join(" &nbsp;|&nbsp; ");

  reclassifyBtn.disabled = false;
}

main();
