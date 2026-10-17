import type Innertube from "youtubei.js";
import { narrowYoutubeBasicInfo } from "./narrowYoutubeBasicInfo";

export const DIAGNOSTIC_JSON_OMIT_KEYS = new Set([
  "streaming_data",
  "playback_tracking",
  "player_config",
  "thumbnail",
  "thumbnails",
  "playability_status",
  "captions",
  "storyboards",
  "cards",
  "available_countries",
  "annotations",
  "endscreen",
  "page",
]);

export type BasicVideoInfo = Awaited<
  ReturnType<InstanceType<typeof Innertube>["getBasicInfo"]>
>;

/** Pretty JSON for debugging (handles cycles, class instances, Maps/Sets). */
export function safePrettyJson(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (key, val: unknown) => {
      if (typeof key === "string" && DIAGNOSTIC_JSON_OMIT_KEYS.has(key)) {
        return undefined;
      }
      if (typeof val === "bigint") return val.toString();
      if (val instanceof Error) {
        return {
          name: val.name,
          message: val.message,
          stack: val.stack,
        };
      }
      if (typeof val === "function") return undefined;
      if (typeof val === "symbol") return String(val);
      if (val instanceof Map) return Object.fromEntries(val);
      if (val instanceof Set) return [...val];
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
        if (Array.isArray(val)) return val;

        const ctor = val.constructor?.name;
        if (ctor && ctor !== "Object") {
          const plain: Record<string, unknown> = { __type: ctor };
          for (const k of Object.keys(val as object)) {
            if (DIAGNOSTIC_JSON_OMIT_KEYS.has(k)) continue;
            plain[k] = (val as Record<string, unknown>)[k];
          }
          return plain;
        }
      }
      return val;
    },
    2
  );
}

export function buildDiagnosticPayload(videoId: string, info: BasicVideoInfo) {
  return {
    video_id: videoId,
    source: "youtubei.js getBasicInfo",
    basic_info: narrowYoutubeBasicInfo(info, videoId),
  };
}

export function serializeYoutubeiDiagnostics(
  videoId: string,
  info: BasicVideoInfo
): string {
  try {
    return safePrettyJson(buildDiagnosticPayload(videoId, info));
  } catch (e) {
    return safePrettyJson({
      video_id: videoId,
      source: "youtubei.js getBasicInfo",
      basic_info: narrowYoutubeBasicInfo(info, videoId),
      note:
        "Full diagnostic payload failed to stringify; showing narrowed basic_info only.",
      stringify_error: e instanceof Error ? e.message : String(e),
    });
  }
}
