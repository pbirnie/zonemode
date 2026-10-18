import {
  fetchTranscript,
  YoutubeTranscriptNotAvailableLanguageError,
} from "youtube-transcript-plus";
import { createLogger } from "../../shared/logger";

const log = createLogger("subtitles");

/** Minimum meaningful transcript length (characters) after trim. */
const MIN_TRANSCRIPT_CHARS = 40;

const TRANSCRIPT_CACHE_TTL_MS = 1_800_000;

/**
 * youtube-transcript-plus matches `languageCode === lang` exactly.
 * YouTube often publishes English as `en-US` / `en-GB` rather than `en`.
 * Prefer exact `en`, then any `en-*`, otherwise the first listed track.
 */
export function pickCaptionLanguageCode(
  codes: readonly string[]
): string | undefined {
  const available = codes.map((code) => code.trim()).filter(Boolean);
  const exact = available.find((code) => code.toLowerCase() === "en");
  if (exact) return exact;
  const regional = available.find((code) =>
    code.toLowerCase().startsWith("en-")
  );
  if (regional) return regional;
  return available[0];
}

async function fetchLibrarySegments(videoId: string) {
  try {
    return await fetchTranscript(videoId, {
      lang: "en",
      cacheTTL: TRANSCRIPT_CACHE_TTL_MS,
    });
  } catch (err) {
    if (!(err instanceof YoutubeTranscriptNotAvailableLanguageError)) {
      throw err;
    }
    const lang = pickCaptionLanguageCode(err.availableLangs);
    if (!lang || lang.toLowerCase() === "en") {
      throw err;
    }
    log.log("caption language is not exact en, fetching", {
      lang,
      available: err.availableLangs,
    });
    return fetchTranscript(videoId, {
      lang,
      cacheTTL: TRANSCRIPT_CACHE_TTL_MS,
    });
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(
  selector: string,
  timeoutMs = 8000
): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await wait(250);
  }
  return null;
}

function findTranscriptTrigger(): HTMLButtonElement | null {
  const sectionBtn = document.querySelector(
    "ytd-video-description-transcript-section-renderer button"
  ) as HTMLButtonElement | null;
  if (sectionBtn) return sectionBtn;

  const withAria = Array.from(
    document.querySelectorAll("button[aria-label]")
  );
  for (const el of withAria) {
    const label = el.getAttribute("aria-label")?.toLowerCase() ?? "";
    if (label.includes("transcript")) return el as HTMLButtonElement;
  }

  return null;
}

async function extractFromPageTranscript(): Promise<string | null> {
  log.log("fallback: attempting to extract transcript from YouTube page UI");

  const transcriptButton = findTranscriptTrigger();

  if (!transcriptButton) {
    log.warn("fallback: no transcript trigger found on page");
    return null;
  }

  log.log("fallback: clicking transcript button");
  transcriptButton.click();

  const container = await waitForSelector("#segments-container", 8000);
  if (!container) {
    log.warn("fallback: transcript panel did not appear in time");
    return null;
  }

  await wait(600);

  const segments = document.querySelectorAll(
    "ytd-transcript-segment-renderer"
  );
  if (!segments.length) {
    log.warn("fallback: no transcript segments found in panel");
    return null;
  }

  const text = Array.from(segments)
    .map((seg) => {
      const el = seg.querySelector(".segment-text") as HTMLElement | null;
      return el?.textContent?.trim() ?? "";
    })
    .filter(Boolean)
    .join(" ");

  log.log("fallback: extracted transcript from page", {
    segments: segments.length,
    chars: text.length,
  });

  return text?.trim() || null;
}

export type TranscriptUnavailableCode =
  | "no_video_id"
  | "empty_transcript"
  | "unavailable";

export type ExtractSubtitlesResult =
  | { ok: true; transcript: string }
  | { ok: false; code: TranscriptUnavailableCode };

/** User-facing title + tips when captions cannot be used. */
export function transcriptUnavailableHelp(code: TranscriptUnavailableCode): {
  title: string;
  bullets: string[];
} {
  switch (code) {
    case "no_video_id":
      return {
        title: "This page doesn’t look like a normal video watch URL.",
        bullets: [
          "Open a standard watch page whose address includes watch?v=… (not just youtube.com Shorts or embedded players in some cases).",
        ],
      };
    case "empty_transcript":
      return {
        title: "Captions were found but contained almost no text.",
        bullets: [
          "Try refreshing the page and tapping Summarize again.",
          "If the video only has sparse auto-captions, try another video to confirm everything works.",
        ],
      };
    case "unavailable":
    default:
      return {
        title: "No usable transcript was found for this video.",
        bullets: [
          "Many videos have no captions — the creator must enable them or YouTube must generate auto-captions.",
          'If YouTube offers "Show transcript" under the description, open it, wait until lines appear, then tap Summarize again — the extension can read that panel.',
          "Live streams, music-only uploads, and some Shorts often have no transcript.",
          "Try a popular talk or tutorial with clear speech to verify the extension.",
        ],
      };
  }
}

export async function extractSubtitles(): Promise<ExtractSubtitlesResult> {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get("v");
  if (!videoId) {
    log.error("Could not find video ID");
    return { ok: false, code: "no_video_id" };
  }

  log.log("extractSubtitles for videoId:", videoId);

  let libraryErrorMessage = "";
  let transcriptFromLibrary = "";

  try {
    const segments = await fetchLibrarySegments(videoId);

    log.log("got segments", { count: segments.length });

    transcriptFromLibrary = segments.map((s) => s.text).join(" ").trim();
    if (transcriptFromLibrary.length >= MIN_TRANSCRIPT_CHARS) {
      log.log("transcript ready", { chars: transcriptFromLibrary.length });
      return { ok: true, transcript: transcriptFromLibrary };
    }
    log.warn("library transcript below threshold or empty, trying page fallback", {
      chars: transcriptFromLibrary.length,
    });
  } catch (error) {
    libraryErrorMessage =
      error instanceof Error ? error.message : String(error);
    log.warn("library extraction failed, trying page fallback:", error);
  }

  let transcriptFromPage: string | null = null;
  try {
    transcriptFromPage = await extractFromPageTranscript();
  } catch (error) {
    log.error("page transcript fallback failed:", error);
  }

  const candidates = [transcriptFromLibrary, transcriptFromPage ?? ""].filter(
    (t) => t.length > 0
  );
  const best =
    candidates.length === 0
      ? ""
      : candidates.reduce((a, b) => (a.length >= b.length ? a : b));

  if (best.length >= MIN_TRANSCRIPT_CHARS) {
    log.log("transcript ready (after fallback merge)", { chars: best.length });
    return { ok: true, transcript: best };
  }
  if (best.length > 0) {
    return { ok: false, code: "empty_transcript" };
  }

  if (libraryErrorMessage) {
    log.log("final transcript failure context", { libraryErrorMessage });
  }
  return { ok: false, code: "unavailable" };
}
