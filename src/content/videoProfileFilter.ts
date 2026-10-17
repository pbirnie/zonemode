import {
  isExtensionContextInvalidatedError,
  isExtensionContextValid,
  safeStorageSyncGet,
} from "../shared/extensionContext";
import { createLogger } from "../shared/logger";
import {
  type ProfileFilterComputeResponse,
  type ProfileFilterVideoResult,
} from "../shared/profileFilterMessages";
import { finalizeProfileVideoResult } from "../shared/profileFilterScoring";
import { logPrdEvent } from "../shared/prdEventLog";
import {
  DEFAULT_SUMMARY_PROFILE_ID,
  STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
  STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
  STORAGE_KEY_SUMMARY_USER_PROFILES,
  normalizeUserProfiles,
  type SummaryUserProfile,
} from "../shared/summaryProfiles";
import { COMPACT_VIDEO_META_ATTR } from "../shared/compactVideoProfileMeta";
import { extractVideoIdFromHref } from "../shared/youtubeUrl";
import {
  computeProfileFilterMetadata,
  getCachedFilterMetadataSnapshot,
} from "./profileFilterMetaCache";
const log = createLogger("profile-filter");

/** Lets the page paint / handle input between large DOM walks. */
function yieldToMain(): Promise<void> {
  const sched = (
    globalThis as unknown as {
      scheduler?: {
        postTask: (cb: () => void, opts?: { priority: string }) => void;
      };
    }
  ).scheduler;
  if (sched?.postTask) {
    return new Promise((resolve) => {
      sched.postTask(() => resolve(), { priority: "background" });
    });
  }
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const LARGE_RENDERER_YIELD_THRESHOLD = 80;

/** After SPA/mutation bursts: re-run classify if sidebar tiles / video IDs changed (YT often mounts related videos after yt-navigate-finish). */
const DOM_SIDEBAR_FILTER_DEBOUNCE_MS = 1500;

const OUTLINE_BASE_CLASS = "yt-sum-compact-thumb-outline";
const OUTLINE_STATE_ATTR = "data-yt-sum-compact-outline";
/**
 * Auto-hide: marks no-match tiles; opaque mask covers the whole card via
 * {@link TILE_MASK_CLASS}. Storage key unchanged.
 */
const FILTER_HIDE_NON_MATCH_CLASS = "yt-sum-profile-filter-hide-non-match";

/** Full-card opaque mask layer (blocks pointer events). */
const TILE_MASK_CLASS = "yt-sum-profile-filter-tile-mask";
/** Stacking anchor on the renderer root (`position: relative`). */
const TILE_MASK_HOST_CLASS = "yt-sum-profile-filter-tile-mask-host";
/** Orphan strips after rename from thumbnail-only overlays. */
const LEGACY_TILE_MASK_CLASS = "yt-sum-profile-filter-thumb-mask";
const LEGACY_TILE_MASK_HOST_CLASS = "yt-sum-profile-filter-thumb-mask-host";

type CompactOutlineState = "default" | "match" | "nomatch";

function setCompactOutlineState(
  el: HTMLElement,
  state: CompactOutlineState
): void {
  el.classList.add(OUTLINE_BASE_CLASS);
  el.setAttribute(OUTLINE_STATE_ATTR, state);
}

function stripTileMuteSubtree(tile: HTMLElement): void {
  tile.querySelectorAll("." + TILE_MASK_CLASS).forEach((n) => n.remove());
  tile.querySelectorAll("." + LEGACY_TILE_MASK_CLASS).forEach((n) => n.remove());
  tile.querySelectorAll("." + TILE_MASK_HOST_CLASS).forEach((el) => {
    if (el instanceof HTMLElement)
      el.classList.remove(TILE_MASK_HOST_CLASS);
  });
  tile.querySelectorAll("." + LEGACY_TILE_MASK_HOST_CLASS).forEach((el) => {
    if (el instanceof HTMLElement)
      el.classList.remove(LEGACY_TILE_MASK_HOST_CLASS);
  });
}

/** Mask is anchored on the sidebar tile renderer root ({@link setCompactOutlineState} host). */
function ensureTileMuteOverlay(tile: HTMLElement): void {
  stripTileMuteSubtree(tile);

  if (tile.querySelector(":scope > ." + TILE_MASK_CLASS)) return;

  tile.classList.add(TILE_MASK_HOST_CLASS);
  const mask = document.createElement("div");
  mask.className = TILE_MASK_CLASS;
  mask.setAttribute("aria-hidden", "true");
  tile.appendChild(mask);
}

function setCompactNonMatchHidden(tile: HTMLElement, hide: boolean): void {
  tile.classList.toggle(FILTER_HIDE_NON_MATCH_CLASS, hide);
  if (hide) {
    ensureTileMuteOverlay(tile);
  } else {
    stripTileMuteSubtree(tile);
  }
}
const OUTLINE_DEBOUNCE_MS = 150;

/**
 * Known video-tile custom-element tag names (light DOM). Order does not matter.
 * Kept broad on purpose — YouTube ships several layouts and renames over time.
 */
const TILE_TAG_LIST = [
  "ytd-compact-video-renderer",
  "ytd-compact-movie-renderer",
  "ytd-compact-radio-renderer",
  "ytd-compact-playlist-renderer",
  "ytd-compact-mix-renderer",
  "ytd-compact-autoplay-renderer",
  "ytd-rich-item-renderer",
  "ytd-rich-grid-media",
  "ytd-video-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "ytd-reel-item-renderer",
  "yt-lockup-view-model",
] as const;

const TILE_SELECTOR = TILE_TAG_LIST.join(", ");

const TILE_TAG_SET: ReadonlySet<string> = new Set(
  TILE_TAG_LIST.map((t) => t.toUpperCase())
);

const WATCH_ANCHOR_SELECTOR = 'a[href*="/watch"]';
const EXT_CONTAINER_SELECTOR = "#zonemode-extension-container";
/** Don't climb into the main video player / chrome above the sidebar. */
const NEVER_TILE_TAGS: ReadonlySet<string> = new Set([
  "YTD-WATCH-FLEXY",
  "YTD-PLAYER",
  "YTD-APP",
  "BODY",
  "HTML",
]);
/** Hard cap on parent walk steps when finding tile from an anchor. */
const TILE_CLIMB_MAX_STEPS = 80;

let filterGeneration = 0;
let debounceTimer: number | null = null;

let domSidebarStaleTimer: number | null = null;
/** Fingerprint after last completed filter pass (see fingerprintRendererVideoMap); empty after All / no-keywords runs. */
let lastProfileFilterFingerprint = "";

function resolveProfileKeywords(
  selectedId: string,
  profiles: SummaryUserProfile[]
): string[] {
  if (selectedId === DEFAULT_SUMMARY_PROFILE_ID) return [];
  const p = profiles.find((x) => x.id === selectedId);
  if (!p) return [];
  return p.keywords.map((k) => k.trim()).filter(Boolean);
}

function loadFilterState(): Promise<{
  selectedId: string;
  profiles: SummaryUserProfile[];
  hideNonMatchingCompact: boolean;
}> {
  return new Promise((resolve) => {
    const defaults = {
      selectedId: DEFAULT_SUMMARY_PROFILE_ID,
      profiles: [] as SummaryUserProfile[],
      hideNonMatchingCompact: false,
    };
    safeStorageSyncGet(
      [
        STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
        STORAGE_KEY_SUMMARY_USER_PROFILES,
        STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
      ],
      (r) => {
        const profiles = normalizeUserProfiles(
          r[STORAGE_KEY_SUMMARY_USER_PROFILES]
        );
        let selectedId =
          typeof r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID] === "string"
            ? r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID].trim()
            : DEFAULT_SUMMARY_PROFILE_ID;
        if (
          selectedId !== DEFAULT_SUMMARY_PROFILE_ID &&
          !profiles.some((p) => p.id === selectedId)
        ) {
          selectedId = DEFAULT_SUMMARY_PROFILE_ID;
        }
        const hideNonMatchingCompact =
          r[STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT] === true;
        resolve({
          selectedId,
          profiles,
          hideNonMatchingCompact,
        });
      }
    );
    if (!isExtensionContextValid()) resolve(defaults);
  });
}

/** Watch / shorts / youtu.be id from resolved `href` or raw attribute. */
function videoIdFromAnchorCandidate(a: HTMLAnchorElement): string | null {
  const fromResolved = extractVideoIdFromHref(a.href);
  if (fromResolved) return fromResolved;
  const raw = a.getAttribute("href");
  if (raw) return extractVideoIdFromHref(raw);
  return null;
}

/**
 * First watch/shorts link under `root` (DFS: open shadow roots + slot-assigned
 * subtrees), bounded nodes.
 */
function findFirstWatchAnchorDeep(
  root: Node,
  maxNodes: number
): HTMLAnchorElement | null {
  let seen = 0;
  function walk(n: Node): HTMLAnchorElement | null {
    if (seen++ > maxNodes) return null;
    if (n instanceof HTMLAnchorElement) {
      const id = videoIdFromAnchorCandidate(n);
      if (id) return n;
    }
    if (n instanceof Element && n.shadowRoot) {
      const inner = walk(n.shadowRoot);
      if (inner) return inner;
    }
    if (n instanceof HTMLSlotElement) {
      try {
        const assigned = n.assignedElements({ flatten: true });
        for (let i = 0; i < assigned.length; i++) {
          const inner = walk(assigned[i]!);
          if (inner) return inner;
        }
      } catch {
        /* assignedElements unsupported */
      }
    }
    const kids = n.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const inner = walk(kids[i]!);
      if (inner) return inner;
    }
    return null;
  }
  return walk(root);
}

export function clearCompactVideoProfileMeta(): void {
  document.querySelectorAll(`[${COMPACT_VIDEO_META_ATTR}]`).forEach((node) => {
    node.removeAttribute(COMPACT_VIDEO_META_ATTR);
  });
}

function stripProfileFilterMuteArtifactsDeep(root: ParentNode): void {
  try {
    root
      .querySelectorAll<HTMLElement>("." + TILE_MASK_CLASS)
      .forEach((el) => el.remove());
    root
      .querySelectorAll<HTMLElement>("." + LEGACY_TILE_MASK_CLASS)
      .forEach((el) => el.remove());
    root
      .querySelectorAll<HTMLElement>("." + TILE_MASK_HOST_CLASS)
      .forEach((el) => el.classList.remove(TILE_MASK_HOST_CLASS));
    root
      .querySelectorAll<HTMLElement>("." + LEGACY_TILE_MASK_HOST_CLASS)
      .forEach((el) => el.classList.remove(LEGACY_TILE_MASK_HOST_CLASS));
    root
      .querySelectorAll<HTMLElement>("." + FILTER_HIDE_NON_MATCH_CLASS)
      .forEach((el) => el.classList.remove(FILTER_HIDE_NON_MATCH_CLASS));
  } catch {
    /* invalid ParentNode */
  }
}

/** Drop Auto-hide masks + markers everywhere (including shadow roots). Covers tiles missed by {@link collectCompactVideoRenderers}. */
function stripMuteArtifactsEverywhere(): void {
  stripProfileFilterMuteArtifactsDeep(document);
  function walkShadows(node: Node): void {
    if (node instanceof Element && node.shadowRoot) {
      stripProfileFilterMuteArtifactsDeep(node.shadowRoot);
      walkShadows(node.shadowRoot);
    }
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) walkShadows(kids[i]!);
  }
  walkShadows(document.documentElement);
}

function clearFilterVisuals(): void {
  stripMuteArtifactsEverywhere();
  for (const el of collectCompactVideoRenderers()) {
    setCompactNonMatchHidden(el, false);
    setCompactOutlineState(el, "default");
  }
}

let outlineFlushTimer: number | null = null;

/** Only log `collectCompactVideoRenderers` when this signature changes (avoids MutationObserver spam). */
let lastCompactCollectionLogSignature = "";

function compactCollectionSignature(results: HTMLElement[]): string {
  const counts = new Map<string, number>();
  for (const el of results) {
    const t = el.tagName.toLowerCase();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const hist = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([t, n]) => `${t}:${n}`)
    .join(",");
  return `${results.length}|${hist}`;
}

function isTileTag(el: Element): boolean {
  return TILE_TAG_SET.has(el.tagName);
}

/**
 * From any descendant element, climb the **composed** parent chain (parent ->
 * shadow host when needed) until a known tile custom element is reached, or a
 * "never tile" boundary is hit. Returns `null` if nothing matches.
 */
function climbToTileLikeAncestor(start: Element): HTMLElement | null {
  let el: Element | null = start;
  for (let i = 0; i < TILE_CLIMB_MAX_STEPS && el; i++) {
    if (el instanceof HTMLElement && isTileTag(el)) return el;
    if (NEVER_TILE_TAGS.has(el.tagName)) return null;
    if (el.parentElement) {
      el = el.parentElement;
      continue;
    }
    const root = el.getRootNode();
    if (root instanceof ShadowRoot && root.host) {
      el = root.host;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Robust tile discovery (resilient to YouTube layout changes):
 *   A) Selector pass over the document and every open shadow root.
 *   B) Anchor-up: every `<a href*="/watch">` (light + shadow) climbs to the
 *      nearest known tile tag in its composed ancestor chain.
 *
 * Anchors inside the extension's own container are ignored. Tiles whose anchor
 * does not resolve to an 11-char video id are dropped via the caller's
 * `videoIdFromCompactRenderer`.
 */
function collectCompactVideoRenderers(): HTMLElement[] {
  const found = new Set<HTMLElement>();
  let selectorHits = 0;
  let anchorClimbHits = 0;
  let anchorClimbMisses = 0;
  let shadowRootsSearched = 0;

  function addFromSelector(root: ParentNode): void {
    try {
      const hits = root.querySelectorAll<HTMLElement>(TILE_SELECTOR);
      for (let i = 0; i < hits.length; i++) {
        const el = hits[i]!;
        if (!found.has(el)) {
          found.add(el);
          selectorHits++;
        }
      }
    } catch {
      /* root may not support querySelectorAll */
    }
  }

  function addFromAnchors(root: ParentNode): void {
    let list: NodeListOf<HTMLAnchorElement> | null = null;
    try {
      list = root.querySelectorAll<HTMLAnchorElement>(WATCH_ANCHOR_SELECTOR);
    } catch {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list.item(i);
      if (!videoIdFromAnchorCandidate(a)) continue;
      if (a.closest(EXT_CONTAINER_SELECTOR)) continue;
      const tile = climbToTileLikeAncestor(a);
      if (!tile) {
        anchorClimbMisses++;
        continue;
      }
      if (!found.has(tile)) {
        found.add(tile);
        anchorClimbHits++;
      }
    }
  }

  function walkShadows(node: Node): void {
    if (node instanceof Element && node.shadowRoot) {
      shadowRootsSearched++;
      addFromSelector(node.shadowRoot);
      addFromAnchors(node.shadowRoot);
      walkShadows(node.shadowRoot);
    }
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) walkShadows(kids[i]!);
  }

  addFromSelector(document);
  addFromAnchors(document);
  walkShadows(document.documentElement);

  const results = Array.from(found);

  const signature = compactCollectionSignature(results);
  if (signature !== lastCompactCollectionLogSignature) {
    lastCompactCollectionLogSignature = signature;
    log.log("collectCompactVideoRenderers", {
      selectorHits,
      anchorClimbHits,
      anchorClimbMisses,
      shadowRootsSearched,
      uniqueTotal: results.length,
      tagNames: results.map((el) => el.tagName.toLowerCase()),
      signature,
    });
    logPrdEvent("profile-filter", "5", "collectCompactVideoRenderers", {
      selectorHits,
      anchorClimbHits,
      anchorClimbMisses,
      shadowRootsSearched,
      uniqueTotal: results.length,
      signature,
    });
  }

  return results;
}

function applyDefaultOutlineToNewCompactRenderers(): void {
  const renderers = collectCompactVideoRenderers();
  for (const el of renderers) {
    if (!el.classList.contains(OUTLINE_BASE_CLASS)) {
      setCompactOutlineState(el, "default");
    }
  }
}

let lastMutationObserverPrdLogAt = 0;
const MUTATION_OBSERVER_PRD_LOG_MS = 2500;

/** Shadow trees do not bubble mutations to `document`; observe each root once. */
const shadowRootsWithMutationObserver = new WeakSet<ShadowRoot>();

function scheduleCompactOutlineFlush(): void {
  if (outlineFlushTimer != null) return;
  outlineFlushTimer = window.setTimeout(() => {
    outlineFlushTimer = null;
    applyDefaultOutlineToNewCompactRenderers();
  }, OUTLINE_DEBOUNCE_MS);
}

/**
 * Discover `shadowRoot` hosts under `start` (bounded) and attach the same
 * mutation observer YouTube uses for related/sidebar tiles inside shadow DOM.
 */
function discoverShadowHostsInSubtree(start: Element, maxHosts: number): void {
  const queue: Element[] = [start];
  let hosts = 0;
  while (queue.length > 0 && hosts < maxHosts) {
    const el = queue.shift()!;
    if (el.shadowRoot && !shadowRootsWithMutationObserver.has(el.shadowRoot)) {
      shadowRootsWithMutationObserver.add(el.shadowRoot);
      const mo = new MutationObserver(profileFilterDomMutationCallback);
      mo.observe(el.shadowRoot, { childList: true, subtree: true });
      hosts++;
      for (let i = 0; i < el.shadowRoot.children.length; i++) {
        const c = el.shadowRoot.children.item(i);
        if (c instanceof Element) queue.push(c);
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children.item(i);
      if (c instanceof Element) queue.push(c);
    }
  }
}

/** One-time walk of the document tree to catch shadow hosts that already exist. */
function walkDocumentAndAttachShadowObservers(): void {
  const stack: Element[] = [document.documentElement];
  let steps = 0;
  const maxSteps = 25000;
  while (stack.length > 0 && steps < maxSteps) {
    const el = stack.pop()!;
    steps++;
    if (el.shadowRoot && !shadowRootsWithMutationObserver.has(el.shadowRoot)) {
      shadowRootsWithMutationObserver.add(el.shadowRoot);
      const mo = new MutationObserver(profileFilterDomMutationCallback);
      mo.observe(el.shadowRoot, { childList: true, subtree: true });
      for (let i = 0; i < el.shadowRoot.children.length; i++) {
        const c = el.shadowRoot.children.item(i);
        if (c instanceof Element) stack.push(c);
      }
    }
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children.item(i);
      if (c instanceof Element) stack.push(c);
    }
  }
}

function profileFilterDomMutationCallback(records: MutationRecord[]): void {
  let sawElement = false;
  let loggedThisTick = false;
  for (const rec of records) {
    const added = rec.addedNodes;
    for (let i = 0; i < added.length; i++) {
      const n = added[i];
      if (n instanceof Element) {
        if (!loggedThisTick) {
          const now = Date.now();
          if (now - lastMutationObserverPrdLogAt >= MUTATION_OBSERVER_PRD_LOG_MS) {
            lastMutationObserverPrdLogAt = now;
            logPrdEvent("profile-filter", "5", "mutation_observer_child_list", {
              recordCount: records.length,
            });
            loggedThisTick = true;
          }
        }
        discoverShadowHostsInSubtree(n, 400);
        sawElement = true;
      }
    }
  }
  if (sawElement) {
    scheduleCompactOutlineFlush();
    // Related / sidebar tiles often mount **after** `yt-navigate-finish` without
    // another navigation — debounced re-scan when renderer/video-id set grows.
    scheduleDomSidebarProfileFilterStaleCheck();
  }
}

function scheduleDomSidebarProfileFilterStaleCheck(): void {
  if (!isExtensionContextValid()) return;
  if (domSidebarStaleTimer !== null) {
    window.clearTimeout(domSidebarStaleTimer);
  }
  domSidebarStaleTimer = window.setTimeout(() => {
    domSidebarStaleTimer = null;
    void maybeRunProfileFilterIfSidebarVideosChanged();
  }, DOM_SIDEBAR_FILTER_DEBOUNCE_MS);
}

async function maybeRunProfileFilterIfSidebarVideosChanged(): Promise<void> {
  if (!isExtensionContextValid()) return;
  const state = await loadFilterState();
  const profileKws = resolveProfileKeywords(state.selectedId, state.profiles);
  if (profileKws.length === 0) return;

  const rendererToId = collectRendererTileToVideoIdMap();
  const fp = fingerprintRendererVideoMap(rendererToId);
  if (fp === lastProfileFilterFingerprint) return;

  scheduleProfileFilterRun();
}

function initCompactVideoOutlines(): void {
  applyDefaultOutlineToNewCompactRenderers();
  requestAnimationFrame(applyDefaultOutlineToNewCompactRenderers);

  walkDocumentAndAttachShadowObservers();

  const mo = new MutationObserver(profileFilterDomMutationCallback);
  mo.observe(document.documentElement, { childList: true, subtree: true });
  logPrdEvent("profile-filter", "5", "initCompactVideoOutlines_observer", {
    subtree: true,
    shadowObservers: true,
  });
}

let lastScheduleProfileFilterPrdAt = 0;
const SCHEDULE_PROFILE_FILTER_PRD_MS = 2000;

function scheduleProfileFilterRun(): void {
  if (!isExtensionContextValid()) return;

  const now = Date.now();
  if (now - lastScheduleProfileFilterPrdAt >= SCHEDULE_PROFILE_FILTER_PRD_MS) {
    lastScheduleProfileFilterPrdAt = now;
    logPrdEvent("profile-filter", "5", "scheduleProfileFilterRun", {
      debounceMs: 500,
    });
  }
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void runProfileVideoFilter().catch((e) => {
      if (!isExtensionContextInvalidatedError(e)) {
        log.error("runProfileVideoFilter failed:", e);
      }
    });
  }, 500);
}

/**
 * Chrome does not fire `storage.onChanged` in the same context that called
 * `storage.set`, so the watch-page profile dropdown must call this after saving.
 * @param immediate When true, run the filter now (e.g. user changed profile).
 */
export function requestProfileFilterRefresh(immediate = false): void {
  if (!isExtensionContextValid()) return;

  logPrdEvent("profile-filter", "5", "requestProfileFilterRefresh", {
    immediate,
  });
  if (immediate) {
    if (debounceTimer != null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    void runProfileVideoFilter().catch((e) => {
      if (!isExtensionContextInvalidatedError(e)) {
        log.error("runProfileVideoFilter failed:", e);
      }
    });
    return;
  }
  scheduleProfileFilterRun();
}

/**
 * Resolve a video id from a compact renderer by walking its subtree for the
 * first watch/shorts anchor.
 */
function videoIdFromCompactRenderer(el: HTMLElement): string | null {
  const a = findFirstWatchAnchorDeep(el, 5000);
  if (a) return videoIdFromAnchorCandidate(a);
  return null;
}

function collectRendererTileToVideoIdMap(): Map<HTMLElement, string> {
  return rendererTileVideoMapFromList(collectCompactVideoRenderers());
}

function rendererTileVideoMapFromList(
  renderers: HTMLElement[]
): Map<HTMLElement, string> {
  const rendererToId = new Map<HTMLElement, string>();
  for (const el of renderers) {
    const id = videoIdFromCompactRenderer(el);
    if (id) rendererToId.set(el, id);
  }
  return rendererToId;
}

/** Stable string for detecting new sidebar tiles or virtualized swaps (counts + sorted unique ids). */
function fingerprintRendererVideoMap(rendererToId: Map<HTMLElement, string>): string {
  const uniq = [...new Set(rendererToId.values())].sort().join("|");
  return `${rendererToId.size}|${uniq}`;
}

async function runProfileVideoFilter(): Promise<void> {
  if (!isExtensionContextValid()) return;

  const gen = ++filterGeneration;
  logPrdEvent("profile-filter", "5", "runProfileVideoFilter_start", { gen });
  clearFilterVisuals();

  const state = await loadFilterState();
  if (gen !== filterGeneration) return;

  const profileKws = resolveProfileKeywords(state.selectedId, state.profiles);
  if (profileKws.length === 0) {
    lastProfileFilterFingerprint = "";
    return;
  }

  const renderers = collectCompactVideoRenderers();
  if (renderers.length > LARGE_RENDERER_YIELD_THRESHOLD) {
    await yieldToMain();
    if (gen !== filterGeneration) return;
  }
  const rendererToId = rendererTileVideoMapFromList(renderers);

  if (rendererToId.size === 0) {
    log.log("profile filter: no compact video renderers with video ids", {
      profileId: state.selectedId,
      profileKeywords: profileKws,
      compactRenderersFound: renderers.length,
    });
    lastProfileFilterFingerprint =
      fingerprintRendererVideoMap(rendererToId);
    return;
  }

  log.log("profile filter keyword labels (active profile)", {
    count: profileKws.length,
    keywords: profileKws.slice(0, 60),
    ...(profileKws.length > 60 ? { keywordsOmitted: profileKws.length - 60 } : {}),
  });

  const uniqueIds = [...new Set(rendererToId.values())];

  const metaById: Record<string, import("../shared/profileFilterMessages").ProfileFilterMetadataEntry> = {};
  const uncachedIds: string[] = [];
  for (const id of uniqueIds) {
    const snap = getCachedFilterMetadataSnapshot(id);
    if (snap.hit) {
      metaById[id] = snap.entry;
    } else {
      uncachedIds.push(id);
    }
  }

  if (uncachedIds.length > 0) {
    let resp: ProfileFilterComputeResponse;
    try {
      resp = await computeProfileFilterMetadata({
        generation: gen,
        videoIds: uncachedIds,
      });
    } catch (e) {
      log.error("profile filter: computeProfileFilterMetadata failed:", e);
      return;
    }
    if (!resp || typeof resp.generation !== "number") {
      log.error("profile filter: invalid compute response", resp);
      return;
    }
    if (gen !== filterGeneration) return;
    if (resp.error) {
      log.error("profile filter: compute error:", resp.error);
      return;
    }
    if (resp.generation !== gen) return;
    Object.assign(metaById, resp.metadataByVideoId ?? {});
  }

  const results: Record<string, ProfileFilterVideoResult> = {};
  for (const videoId of uniqueIds) {
    results[videoId] = finalizeProfileVideoResult(
      metaById[videoId],
      videoId,
      profileKws
    );
  }

  type DecisionRow = {
    videoId: string;
    title: string;
    disposition: "no_keyword_match" | "kept_match" | "kept_no_metadata";
    matchedKeyword?: string;
    matchVia?: "zero_shot" | "metadata_exact" | "substring";
    scores?: Record<string, number>;
  };

  const rows: DecisionRow[] = [];

  for (const [el, videoId] of rendererToId) {
    const r = results[videoId];
    if (!r) {
      rows.push({
        videoId,
        title: videoId,
        disposition: "kept_no_metadata",
      });
      el.removeAttribute(COMPACT_VIDEO_META_ATTR);
      setCompactOutlineState(el, "default");
      continue;
    }

    rows.push({
      videoId,
      title: r.previewTitle,
      disposition: r.disposition,
      matchedKeyword: r.matchedKeyword,
      matchVia: r.matchVia,
      scores: r.scores,
    });

    const meta: Record<string, unknown> = {
      videoId,
      disposition: r.disposition,
    };
    if (r.matchedKeyword !== undefined) meta.matchedKeyword = r.matchedKeyword;
    if (r.matchVia !== undefined) meta.matchVia = r.matchVia;
    if (r.scores && Object.keys(r.scores).length > 0) {
      meta.scores = r.scores;
    }
    el.setAttribute(COMPACT_VIDEO_META_ATTR, JSON.stringify(meta));

    if (r.disposition === "no_keyword_match") {
      setCompactOutlineState(el, "nomatch");
      setCompactNonMatchHidden(el, state.hideNonMatchingCompact);
    } else {
      setCompactNonMatchHidden(el, false);
      setCompactOutlineState(el, "match");
    }
  }

  lastProfileFilterFingerprint = fingerprintRendererVideoMap(rendererToId);

  const excludedRows = rows.filter((r) => r.disposition === "no_keyword_match");
  const keptRows = rows.filter((r) => r.disposition !== "no_keyword_match");
  const MAX_LIST = 80;

  log.log("profile filter video decisions", {
    profileId: state.selectedId,
    profileKeywords: profileKws,
    summary: {
      compactRenderers: renderers.length,
      withVideoId: rendererToId.size,
      noMatchOutlines: excludedRows.length,
      kept: keptRows.length,
    },
    excluded: excludedRows.slice(0, MAX_LIST).map((r) => ({
      videoId: r.videoId,
      title: r.title,
      ...(r.scores && Object.keys(r.scores).length > 0
        ? { scores: r.scores }
        : {}),
    })),
    ...(excludedRows.length > MAX_LIST
      ? { excludedOmitted: excludedRows.length - MAX_LIST }
      : {}),
    kept: keptRows.slice(0, MAX_LIST).map((r) => ({
      videoId: r.videoId,
      title: r.title,
      reason:
        r.disposition === "kept_no_metadata"
          ? "no_metadata_or_fetch_failed"
          : "keyword_metadata_exact_match",
      matchedKeyword: r.matchedKeyword,
      ...(r.scores && Object.keys(r.scores).length > 0
        ? { scores: r.scores }
        : {}),
    })),
    ...(keptRows.length > MAX_LIST
      ? { keptOmitted: keptRows.length - MAX_LIST }
      : {}),
  });
}

const PROFILE_FILTER_RESYNC_STORAGE_KEYS = new Set([
  STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
  STORAGE_KEY_SUMMARY_USER_PROFILES,
  STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
]);

function onStorageChanged(
  changes: Record<string, chrome.storage.StorageChange>,
  area: string
): void {
  if (!isExtensionContextValid() || area !== "sync") return;

  const keys = Object.keys(changes);
  if (!keys.some((k) => PROFILE_FILTER_RESYNC_STORAGE_KEYS.has(k))) return;

  logPrdEvent("profile-filter", "5", "chrome.storage.onChanged_profile_filter", {
    keys: keys.filter((k) => PROFILE_FILTER_RESYNC_STORAGE_KEYS.has(k)),
  });
  scheduleProfileFilterRun();
}

/**
 * Full filter (metadata + Innertube **`metadata_exact`** matching) runs when: initial load, `yt-navigate-finish`,
 * **profile-related sync keys** change (**`selectedSummaryProfileId`**, **`summaryUserProfiles`**,
 * **`profileFilterHideNonMatchingCompact`**), or explicit **`requestProfileFilterRefresh`**
 * from the watch bar (e.g. profile dropdown, Clear Cache).
 * Sidebar-related DOM churn is debounced (**`DOM_SIDEBAR_FILTER_DEBOUNCE_MS`**): if compact
 * renderers / resolved video IDs differ from the last completed filter pass, we run again.
 * Lighter **`MutationObserver`** work still refreshes grey default outlines only between runs.
 *
 * With a profile that has keywords, matching tiles turn green and non-matching red.
 */
export function initVideoProfileFilter(): void {
  if (!location.hostname.endsWith("youtube.com")) {
    logPrdEvent("profile-filter", "5", "initVideoProfileFilter_skip", {
      hostname: location.hostname,
    });
    return;
  }

  logPrdEvent("profile-filter", "5", "initVideoProfileFilter", {});

  initCompactVideoOutlines();
  scheduleProfileFilterRun();
  chrome.storage.onChanged.addListener(onStorageChanged);
  document.addEventListener("yt-navigate-finish", () => {
    if (domSidebarStaleTimer !== null) {
      window.clearTimeout(domSidebarStaleTimer);
      domSidebarStaleTimer = null;
    }
    lastCompactCollectionLogSignature = "";
    lastProfileFilterFingerprint = "";
    logPrdEvent("profile-filter", "5", "yt-navigate-finish", {});
    applyDefaultOutlineToNewCompactRenderers();
    scheduleProfileFilterRun();
  });
}
