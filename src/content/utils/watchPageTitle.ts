/**
 * Best-effort title on YouTube watch pages for prompt placeholders (`{{TITLE}}`).
 * Returns empty string when unavailable.
 */
export function getWatchPageVideoTitle(): string {
  try {
    const og = document.querySelector('meta[property="og:title"]');
    const fromOg =
      og instanceof HTMLMetaElement ? og.getAttribute("content")?.trim() : "";
    if (fromOg) return fromOg;
    const dt = document.title?.trim() ?? "";
    if (!dt) return "";
    const stripped = dt.replace(/\s*-\s*YouTube\s*$/i, "").trim();
    return stripped || dt;
  } catch {
    return "";
  }
}
