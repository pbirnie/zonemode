import type Innertube from "youtubei.js";

/** Subset of Innertube **`basic_info`** kept after **`getBasicInfo`** for filtering and diagnostics. */
export type NarrowYoutubeBasicInfo = {
  id: string;
  title: string;
  keywords: string[];
  short_description: string;
  view_count: number | null;
  author: string;
  is_family_safe: boolean | null;
  category: string;
  tags: string[] | null;
};

export type YoutubeGetBasicInfoResult = Awaited<
  ReturnType<InstanceType<typeof Innertube>["getBasicInfo"]>
>;

function coerceString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  return "";
}

function stringifyHubLike(item: unknown): string | null {
  if (typeof item === "string") {
    const t = item.trim();
    return t || null;
  }
  if (item != null && typeof item === "object") {
    const o = item as Record<string, unknown>;
    if (typeof o.text === "string") {
      const t = o.text.trim();
      if (t) return t;
    }
    if (typeof o.simpleText === "string") {
      const t = o.simpleText.trim();
      if (t) return t;
    }
  }
  return null;
}

/** Split commas and Hub runs into individual tokens we can match on. */
function flattenCommaOrHubList(raw: unknown): string[] {
  const out: string[] = [];
  const pushOne = (s: string): void => {
    const u = s.trim();
    if (!u) return;
    if (u.includes(",")) {
      for (const piece of u.split(",")) pushOne(piece);
      return;
    }
    out.push(u);
  };
  if (typeof raw === "string") pushOne(raw);
  else if (Array.isArray(raw)) {
    for (const k of raw) {
      const s = stringifyHubLike(k);
      if (s) pushOne(s);
    }
  }
  return out;
}

function normalizeTagsField(rawTags: unknown): string[] | null {
  if (rawTags === null) return null;
  const flat = flattenCommaOrHubList(rawTags);
  return flat.length > 0 ? flat : null;
}

function topLevelVideoId(info: YoutubeGetBasicInfoResult): string {
  const v = info as YoutubeGetBasicInfoResult & Record<string, unknown>;
  return coerceString(v.id);
}

/**
 * Drops all Innertube **`basic_info`** fields except **`id`**, **`title`**, **`keywords`**,
 * **`short_description`**, **`view_count`**, **`author`**, **`is_family_safe`**, **`category`**, **`tags`**.
 */
export function narrowYoutubeBasicInfo(
  rawInfo: YoutubeGetBasicInfoResult,
  videoIdFallback: string
): NarrowYoutubeBasicInfo {
  const raw = rawInfo.basic_info as Record<string, unknown> | undefined;
  const b = raw ?? {};

  const author = coerceString(b.author);
  const title = coerceString(b.title);
  const shortDescription = coerceString(b.short_description);
  const category = coerceString(b.category);
  const keywords = flattenCommaOrHubList(b.keywords);
  const tags = normalizeTagsField(b.tags);

  const vc = b.view_count;
  const view_count =
    typeof vc === "number" && Number.isFinite(vc) ? Math.trunc(vc) : null;

  let is_family_safe: boolean | null = null;
  if (typeof b.is_family_safe === "boolean") is_family_safe = b.is_family_safe;

  const idFromBasic = coerceString(b.id);
  const id = idFromBasic || topLevelVideoId(rawInfo) || videoIdFallback;

  return {
    id,
    title,
    keywords,
    short_description: shortDescription,
    view_count,
    author,
    is_family_safe,
    category,
    tags,
  };
}
