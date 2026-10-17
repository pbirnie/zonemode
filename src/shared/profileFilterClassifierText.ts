/**
 * URL stripping for classifier input — shared by test-bench / content re-exports.
 * Full InnerTube metadata parsing lives in `src/offscreen/profileFilterMetaCache.ts`.
 */
export function stripUrlsForClassifierText(text: string): string {
  let s = text;
  s = s.replace(/\bhttps?:\/\/[^\s<>"')\]]+/gi, " ");
  s = s.replace(/\bwww\.[^\s<>"')\]]+/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
