import Innertube from "youtubei.js";

let innertubePromise: Promise<Innertube> | null = null;

/**
 * Shared youtubei.js client in the **watch tab** content script.
 * InnerTube `getBasicInfo` / player calls return **403** from the MV3
 * service worker and **offscreen** document — they need this first-party page context.
 */
export function getSharedInnertube(): Promise<Innertube> {
  innertubePromise ??= Innertube.create();
  return innertubePromise;
}
