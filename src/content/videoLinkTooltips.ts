import {
  isExtensionContextValid,
  safeStorageSyncGet,
} from "../shared/extensionContext";
import { createLogger } from "../shared/logger";
import { logPrdEvent } from "../shared/prdEventLog";
import {
  mergeExtensionProfileFilterIntoObject,
} from "../shared/compactVideoProfileMeta";
import { STORAGE_KEY_METADATA_HOVER_ENABLED } from "../shared/summaryProfiles";
import { extractVideoIdFromHref } from "../shared/youtubeUrl";
import {
  serializeYoutubeiDiagnostics,
  safePrettyJson,
} from "../shared/youtubeiDiagnostics";
import type { ProfileFilterMetadataEntry } from "../shared/profileFilterMessages";
import {
  getCachedFilterMetadataSnapshot,
  getCachedFilterMetadataSnapshotAsync,
} from "./profileFilterMetaCache";
import { getSharedInnertube } from "./youtubeInnerTube";

const log = createLogger("video-tooltip");

const TOOLTIP_ID = "zonemode-video-metadata-tooltip";
const EXT_CONTAINER_ID = "zonemode-extension-container";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wait before treating hover as intentional (avoids fetches when the cursor skims links). */
const HOVER_SHOW_DELAY_MS = 300;

type CachedEntry = { fetchedAt: number; jsonText: string };

const cache = new Map<string, CachedEntry>();
/** Merges live profile-filter tile meta (`scores`, etc.) for cache hits and fresh fetches. */
function attachExtensionProfileFilter(videoId: string, youtubeiJson: string): string {
  try {
    const obj = JSON.parse(youtubeiJson) as Record<string, unknown>;
    mergeExtensionProfileFilterIntoObject(videoId, obj);
    return safePrettyJson(obj);
  } catch {
    return youtubeiJson;
  }
}

/** While true, panel stays open until Close (or Escape); new link hovers are ignored. */
let diagnosticPinned = false;

function closeDiagnosticPanel() {
  logPrdEvent("video-tooltip", "4", "close_diagnostic_panel", {});
  diagnosticPinned = false;
  clearTimers();
  fetchGeneration++;
  hideTooltip();
}

function buildPanelHeader(videoId: string): HTMLElement {
  const header = document.createElement("div");
  header.className = "yt-sum-tip-panel-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "yt-sum-tip-panel-title-wrap";
  const title = document.createElement("div");
  title.className = "yt-sum-tip-panel-title";
  title.textContent = "Video diagnostics";
  const sub = document.createElement("div");
  sub.className = "yt-sum-tip-panel-sub";
  sub.textContent = `youtubei.js · ${videoId}`;
  titleWrap.append(title, sub);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "yt-sum-tip-close";
  closeBtn.setAttribute("aria-label", "Close diagnostics panel");
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeDiagnosticPanel();
  });

  header.append(titleWrap, closeBtn);
  return header;
}

function renderPinnedPanel(
  tip: HTMLDivElement,
  videoId: string,
  bodyEl: HTMLElement
) {
  tip.replaceChildren();
  tip.append(buildPanelHeader(videoId), bodyEl);
  tip.setAttribute("role", "dialog");
  tip.setAttribute("aria-modal", "false");
  diagnosticPinned = true;
}

function renderLoadingBody(): HTMLElement {
  const body = document.createElement("div");
  body.className = "yt-sum-tip-panel-body";
  const loading = document.createElement("div");
  loading.className = "yt-sum-tip-loading";
  loading.textContent = "Loading getBasicInfo…";
  body.appendChild(loading);
  return body;
}

function renderJsonBody(jsonText: string): HTMLElement {
  const body = document.createElement("div");
  body.className = "yt-sum-tip-panel-body";
  const pre = document.createElement("pre");
  pre.className = "yt-sum-tip-json";
  pre.textContent = jsonText;
  body.appendChild(pre);
  return body;
}

function ensureTooltipEl(): HTMLDivElement {
  let el = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = TOOLTIP_ID;
    el.className = "yt-sum-video-tooltip yt-sum-video-tooltip--diagnostic";
    el.hidden = true;
    document.documentElement.appendChild(el);
  }
  return el;
}

function positionTooltip(anchor: HTMLElement, tip: HTMLDivElement) {
  tip.hidden = false;
  const margin = 8;
  const maxW = Math.min(560, Math.floor(window.innerWidth * 0.92));
  tip.style.maxWidth = `${maxW}px`;

  const r = anchor.getBoundingClientRect();
  const rect = tip.getBoundingClientRect();
  let left = r.left + r.width / 2 - rect.width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));

  let top = r.bottom + margin;
  if (top + rect.height > window.innerHeight - margin) {
    top = Math.max(margin, r.top - rect.height - margin);
  }

  tip.style.left = `${left + window.scrollX}px`;
  tip.style.top = `${top + window.scrollY}px`;
}

let hoverTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let activeAnchor: HTMLAnchorElement | null = null;
let activeVideoId: string | null = null;
let fetchGeneration = 0;

let metadataHoverEnabled = false;

function clearTimers() {
  if (hoverTimer != null) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (hideTimer != null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function hideTooltip() {
  const tip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
  if (tip) {
    tip.hidden = true;
    tip.replaceChildren();
    tip.removeAttribute("role");
    tip.removeAttribute("aria-modal");
  }
  activeAnchor = null;
  activeVideoId = null;
}

function repositionIfVisible() {
  const tip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
  if (!tip || tip.hidden || !activeAnchor) return;
  positionTooltip(activeAnchor, tip);
}

function isIgnorableAnchor(a: HTMLAnchorElement): boolean {
  return !!a.closest(`#${EXT_CONTAINER_ID}`);
}

function getTooltipEl(): HTMLDivElement | null {
  return document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
}

function buildProfileFilterWorkerCachePayload(
  videoId: string,
  entry: ProfileFilterMetadataEntry,
  fetchedAt: number
): Record<string, unknown> {
  return {
    video_id: videoId,
    source: "profile_filter_page_cache",
    note:
      "Cache-only row from the profile-filter worker in this tab. Full basic_info loads when getBasicInfo resolves.",
    profile_filter_worker: {
      fetched_at_ms: fetchedAt,
      cache_age_ms: Date.now() - fetchedAt,
      preview_title: entry.previewTitle,
      haystack_lower: entry.haystackLower,
      classifier_text: entry.classifierText,
      ...(entry.author !== undefined ? { author: entry.author } : {}),
      ...(entry.viewCount !== undefined ? { view_count: entry.viewCount } : {}),
    },
  };
}

function renderCacheOnlyProfileFilterPanel(
  tip: HTMLDivElement,
  anchor: HTMLAnchorElement,
  videoId: string,
  snap: { hit: true; entry: ProfileFilterMetadataEntry; fetchedAt: number }
): void {
  const fast = buildProfileFilterWorkerCachePayload(
    videoId,
    snap.entry,
    snap.fetchedAt
  );
  mergeExtensionProfileFilterIntoObject(videoId, fast);
  renderPinnedPanel(tip, videoId, renderJsonBody(safePrettyJson(fast)));
  positionTooltip(anchor, tip);
  requestAnimationFrame(() => positionTooltip(anchor, tip));
}

async function showMetadataForAnchor(
  anchor: HTMLAnchorElement,
  videoId: string
) {
  const gen = ++fetchGeneration;
  const tip = ensureTooltipEl();

  const cached = cache.get(videoId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;
    logPrdEvent("video-tooltip", "4", "showMetadataForAnchor", {
      videoId,
      cacheHit: true,
    });
    renderPinnedPanel(
      tip,
      videoId,
      renderJsonBody(attachExtensionProfileFilter(videoId, cached.jsonText))
    );
    positionTooltip(anchor, tip);
    requestAnimationFrame(() => positionTooltip(anchor, tip));
    return;
  }

  // Overlap Innertube with optional chrome.storage hydration when L1 is cold.
  const ytInfoPromise = getSharedInnertube().then((yt) =>
    yt.getBasicInfo(videoId)
  );

  logPrdEvent("video-tooltip", "4", "showMetadataForAnchor", {
    videoId,
    cacheHit: false,
  });

  const syncSnap = getCachedFilterMetadataSnapshot(videoId);
  if (syncSnap.hit) {
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;
    renderCacheOnlyProfileFilterPanel(tip, anchor, videoId, syncSnap);
  } else {
    renderPinnedPanel(tip, videoId, renderLoadingBody());
    positionTooltip(anchor, tip);

    const swSnap = await getCachedFilterMetadataSnapshotAsync(videoId);
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;

    if (swSnap.hit) {
      renderCacheOnlyProfileFilterPanel(tip, anchor, videoId, swSnap);
    }
  }

  try {
    const info = await ytInfoPromise;
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;

    const youtubeiJson = serializeYoutubeiDiagnostics(videoId, info);
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;

    cache.set(videoId, { fetchedAt: Date.now(), jsonText: youtubeiJson });

    const t = getTooltipEl();
    if (!t || gen !== fetchGeneration) return;
    renderPinnedPanel(
      t,
      videoId,
      renderJsonBody(attachExtensionProfileFilter(videoId, youtubeiJson))
    );
    if (activeAnchor) positionTooltip(activeAnchor, t);
    requestAnimationFrame(() => {
      const anchor = activeAnchor;
      const tipNode = getTooltipEl();
      if (anchor && tipNode) positionTooltip(anchor, tipNode);
    });
  } catch (e) {
    log.error("getBasicInfo failed:", e);
    if (gen !== fetchGeneration || activeVideoId !== videoId) return;
    const errBase: Record<string, unknown> = {
      error: "getBasicInfo failed",
      video_id: videoId,
      message: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
    };
    mergeExtensionProfileFilterIntoObject(videoId, errBase);
    const errJson = safePrettyJson(errBase);
    const t = getTooltipEl();
    if (!t) return;
    renderPinnedPanel(t, videoId, renderJsonBody(errJson));
    if (activeAnchor) positionTooltip(activeAnchor, t);
  }
}

function onDocMouseOver(e: MouseEvent) {
  if (!metadataHoverEnabled) return;

  const t = e.target;
  if (!(t instanceof Element)) return;

  const tipEl = getTooltipEl();
  if (tipEl?.contains(t)) return;

  if (diagnosticPinned) return;

  const a = t.closest("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return;
  if (isIgnorableAnchor(a)) return;

  const id = extractVideoIdFromHref(a.href);
  if (!id) return;

  clearTimers();

  activeAnchor = a;
  activeVideoId = id;

  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (diagnosticPinned) return;
    if (activeAnchor !== a || activeVideoId !== id) return;

    logPrdEvent("video-tooltip", "4", "mouseover_hover_delay_elapsed", {
      videoId: id,
    });

    void showMetadataForAnchor(a, id);
  }, HOVER_SHOW_DELAY_MS);
}

function onDocMouseOut(e: MouseEvent) {
  if (diagnosticPinned) return;

  const t = e.target;
  const related = e.relatedTarget;
  if (!(t instanceof Element)) return;

  const a = t.closest("a[href]");
  if (!(a instanceof HTMLAnchorElement)) return;

  const id = extractVideoIdFromHref(a.href);
  if (!id || id !== activeVideoId) return;

  if (related instanceof Node && a.contains(related)) return;

  clearTimers();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (diagnosticPinned) return;
    if (activeVideoId === id) {
      logPrdEvent("video-tooltip", "4", "mouseout_hide_scheduled", {
        videoId: id,
      });
      hideTooltip();
    }
  }, 200);
}

function hideOnNavigate() {
  logPrdEvent("video-tooltip", "4", "yt-navigate-finish_hide_tooltip", {});
  diagnosticPinned = false;
  clearTimers();
  fetchGeneration++;
  hideTooltip();
}

function onEscapeKey(e: KeyboardEvent) {
  if (e.key !== "Escape" || !diagnosticPinned) return;
  const tip = getTooltipEl();
  if (!tip || tip.hidden) return;
  e.preventDefault();
  e.stopPropagation();
  logPrdEvent("video-tooltip", "4", "keydown_escape_close_panel", {});
  closeDiagnosticPanel();
}

/**
 * Hover diagnostics use **event delegation**: capture-phase `mouseover` on
 * `document`, then `(target as Element).closest("a[href]")` for a watch/shorts
 * URL and `extractVideoIdFromHref`. Sidebar compact tiles get **grey / green /
 * red** outlines from the profile filter (`videoProfileFilter.ts`); hover uses
 * `#dismissible` when present for tooltip positioning.
 */
let lastPrdRepositionLogAt = 0;
const PRD_REPOSITION_LOG_INTERVAL_MS = 4000;

export function initVideoLinkMetadataTooltips(): void {
  if (!location.hostname.endsWith("youtube.com")) {
    logPrdEvent("video-tooltip", "4", "init_skip_not_youtube", {
      hostname: location.hostname,
    });
    return;
  }

  safeStorageSyncGet([STORAGE_KEY_METADATA_HOVER_ENABLED], (r) => {
    metadataHoverEnabled = r[STORAGE_KEY_METADATA_HOVER_ENABLED] === true;
    log.log("metadata hover popup", metadataHoverEnabled ? "enabled" : "disabled");
    logPrdEvent("video-tooltip", "4", "init_metadata_hover_loaded", {
      metadataHoverEnabled,
    });
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isExtensionContextValid() || area !== "sync") return;
    if (changes[STORAGE_KEY_METADATA_HOVER_ENABLED]) {
      metadataHoverEnabled =
        changes[STORAGE_KEY_METADATA_HOVER_ENABLED].newValue === true;
      log.log(
        "metadata hover popup toggled",
        metadataHoverEnabled ? "enabled" : "disabled"
      );
      logPrdEvent("video-tooltip", "4", "chrome.storage.onChanged_metadata_hover", {
        metadataHoverEnabled,
      });
      if (!metadataHoverEnabled) {
        closeDiagnosticPanel();
      }
    }
  });

  document.addEventListener("mouseover", onDocMouseOver, true);
  document.addEventListener("mouseout", onDocMouseOut, true);
  document.addEventListener("keydown", onEscapeKey, true);

  const repositionSoon = () =>
    requestAnimationFrame(() => {
      repositionIfVisible();
      const now = Date.now();
      if (now - lastPrdRepositionLogAt >= PRD_REPOSITION_LOG_INTERVAL_MS) {
        lastPrdRepositionLogAt = now;
        logPrdEvent("video-tooltip", "4", "scroll_or_wheel_reposition", {});
      }
    });
  window.addEventListener("scroll", repositionSoon, true);
  document.addEventListener("scroll", repositionSoon, true);
  document.addEventListener("wheel", repositionSoon, {
    capture: true,
    passive: true,
  });
  document.addEventListener("yt-navigate-finish", hideOnNavigate);

  log.log("video link metadata tooltips enabled");
  logPrdEvent("video-tooltip", "4", "init_listeners_attached", {});
}
