const VIDEO_ID_RE = /^[\w-]{11}$/;

/** Resolve an 11-char video id from watch / shorts / youtu.be URLs. */
export function extractVideoIdFromHref(href: string): string | null {
  try {
    const u = new URL(href, "https://www.youtube.com");
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0]?.split("?")[0] ?? "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (!host.endsWith("youtube.com")) return null;

    if (u.pathname.startsWith("/shorts/")) {
      const id =
        u.pathname.replace(/^\/shorts\//, "").split("/")[0]?.split("?")[0] ??
        "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    if (u.pathname.startsWith("/watch")) {
      const v = u.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
      const seg = u.pathname.split("/").filter(Boolean);
      if (seg[0] === "watch" && seg[1] && VIDEO_ID_RE.test(seg[1]))
        return seg[1];
    }

    return null;
  } catch {
    return null;
  }
}
