/**
 * Video tile helpers: full-row outline target (`#dismissible` / card host),
 * thumbnail-only fallback (`findThumbnailHighlightForWatchAnchor`), and
 * selectors for tile discovery.
 */

export const VIDEO_TILE_CARD_SELECTOR_LIST = [
  "ytd-rich-item-renderer",
  "ytd-rich-grid-media",
  "ytd-video-renderer",
  "ytd-compact-video-renderer",
  "ytd-compact-autoplay-renderer",
  "ytd-compact-mix-renderer",
  "ytd-grid-video-renderer",
  "ytd-playlist-panel-video-renderer",
  "ytd-mini-guide-entry-renderer",
  "ytd-reel-item-renderer",
] as const;

const CARD_SELECTOR_LIST = VIDEO_TILE_CARD_SELECTOR_LIST;

const THUMB_IMAGE_CLASS = "ytThumbnailViewModelImage";

function walkComposedAncestors(start: Element): Element[] {
  const out: Element[] = [];
  let el: Element | null = start;
  for (let depth = 0; depth < 80 && el; depth++) {
    out.push(el);
    if (el.parentElement) {
      el = el.parentElement;
    } else {
      const root = el.getRootNode();
      if (root instanceof ShadowRoot && root.host) {
        el = root.host;
      } else {
        break;
      }
    }
  }
  return out;
}

export function isVideoTileCardElement(el: Element): boolean {
  for (const sel of CARD_SELECTOR_LIST) {
    try {
      if (el.matches(sel)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Comma-separated selector for `querySelectorAll` over video tile hosts. */
export const VIDEO_TILE_CARD_SELECTOR = VIDEO_TILE_CARD_SELECTOR_LIST.join(
  ", ",
);

/**
 * Prefer `#dismissible` (thumbnail + metadata row) inside the tile; it usually
 * lives in the host's shadow root on compact/search layouts.
 */
export function resolveVideoTileOutlineHost(card: HTMLElement): HTMLElement {
  const fromShadow = card.shadowRoot?.getElementById("dismissible");
  if (fromShadow instanceof HTMLElement) return fromShadow;
  const fromLight = card.querySelector(":scope > #dismissible");
  if (fromLight instanceof HTMLElement) return fromLight;
  return card;
}

/** Nearest known video tile host walking up through shadow boundaries. */
export function findNearestVideoTileCard(
  anchor: HTMLAnchorElement
): HTMLElement | null {
  for (const el of walkComposedAncestors(anchor)) {
    if (el instanceof HTMLElement && isVideoTileCardElement(el)) return el;
  }
  return null;
}

function findFirstThumbnailDeep(root: Node, maxNodes: number): HTMLElement | null {
  let seen = 0;
  function walk(node: Node): HTMLElement | null {
    if (seen++ > maxNodes) return null;
    if (
      node instanceof HTMLElement &&
      node.classList?.contains(THUMB_IMAGE_CLASS)
    ) {
      return node;
    }
    if (node instanceof Element && node.shadowRoot) {
      const inner = walk(node.shadowRoot);
      if (inner) return inner;
    }
    const kids = node.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const inner = walk(kids[i]);
      if (inner) return inner;
    }
    return null;
  }
  return walk(root);
}

/**
 * Prefer `.ytThumbnailViewModelImage` inside the nearest known video tile;
 * else thumbnail under the anchor; else the anchor (outline clickable area).
 */
export function findThumbnailHighlightForWatchAnchor(
  anchor: HTMLAnchorElement
): HTMLElement {
  for (const el of walkComposedAncestors(anchor)) {
    if (isVideoTileCardElement(el)) {
      const thumb = findFirstThumbnailDeep(el, 800);
      if (thumb) return thumb;
      break;
    }
  }
  const under = findFirstThumbnailDeep(anchor, 250);
  if (under) return under;
  return anchor;
}
