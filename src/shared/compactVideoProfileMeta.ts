/** Compact tile JSON written by `videoProfileFilter.ts` (profile keyword disposition; legacy **`scores`** from removed semantic classifier may remain until tiles re-scan). */
export const COMPACT_VIDEO_META_ATTR = "data-yt-sum-compact-meta";

/**
 * Omit useless `extension_profile_filter` blobs (e.g. only `kept_no_metadata`
 * with no scores) from hover diagnostics JSON.
 */
export function shouldIncludeExtensionProfileFilterInDiagnostics(
  ext: Record<string, unknown> | null | undefined
): boolean {
  if (!ext) return false;
  const scores = ext["scores"];
  const hasScores =
    scores &&
    typeof scores === "object" &&
    !Array.isArray(scores) &&
    Object.keys(scores as Record<string, unknown>).length > 0;
  if (hasScores) return true;
  const kw = ext["matchedKeyword"];
  if (typeof kw === "string" && kw.trim().length > 0) return true;
  const mv = ext["matchVia"];
  if (
    mv === "zero_shot" ||
    mv === "metadata_exact" ||
    mv === "substring"
  )
    return true;
  const disp = ext["disposition"];
  if (disp === "no_keyword_match" || disp === "kept_match") return true;
  return false;
}

/**
 * If a sidebar tile for `videoId` has been scanned by the profile filter, return
 * parsed `data-yt-sum-compact-meta` (includes `scores` when zero-shot ran).
 */
export function getCompactProfileFilterMetaForVideoId(
  videoId: string
): Record<string, unknown> | null {
  const sel = `[${COMPACT_VIDEO_META_ATTR}]`;
  const tiles = document.querySelectorAll(sel);
  for (let i = 0; i < tiles.length; i++) {
    const el = tiles.item(i);
    if (!(el instanceof HTMLElement)) continue;
    const raw = el.getAttribute(COMPACT_VIDEO_META_ATTR);
    if (!raw) continue;
    try {
      const o = JSON.parse(raw) as { videoId?: string };
      if (o && typeof o.videoId === "string" && o.videoId === videoId) {
        return o as Record<string, unknown>;
      }
    } catch {
      /* ignore malformed */
    }
  }
  return null;
}

/** Adds `extension_profile_filter` to a diagnostics object when tile meta is meaningful. */
export function mergeExtensionProfileFilterIntoObject(
  videoId: string,
  obj: Record<string, unknown>
): void {
  const ext = getCompactProfileFilterMetaForVideoId(videoId);
  if (shouldIncludeExtensionProfileFilterInDiagnostics(ext)) {
    obj.extension_profile_filter = ext;
  } else {
    delete obj.extension_profile_filter;
  }
}
