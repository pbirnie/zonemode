import Innertube from "youtubei.js";

import { createLogger } from "../shared/logger";

import {

  narrowYoutubeBasicInfo,

  type NarrowYoutubeBasicInfo,

} from "../shared/narrowYoutubeBasicInfo";

import type {

  ProfileFilterComputePayload,

  ProfileFilterComputeResponse,

  ProfileFilterMetadataEntry,

} from "../shared/profileFilterMessages";

import {

  PROFILE_FILTER_META_STORAGE_KEY_PREFIX,

  PROFILE_FILTER_META_TTL_MS,

  clearAllPersistedProfileFilterMetaKeys,

  getPersistedProfileFilterMetaRow,

  isProfileFilterMetaHaystackPersisted,

  setPersistedProfileFilterMetaRow,

  type ProfileFilterMetaHaystackPersisted,

} from "../shared/profileFilterMetaStorage";

import type { ProfileFilterMetaCacheSnapshotRow } from "../shared/testBenchMessages";

import { keywordMatchTermsFromVideoKeywordsAndAuthor } from "../shared/profileFilterScoring";

import { stripUrlsForClassifierText } from "../shared/profileFilterClassifierText";

import { getSharedInnertube } from "./youtubeInnerTube";



const log = createLogger("profile-filter-meta");



const META_CACHE_MS = PROFILE_FILTER_META_TTL_MS;



type HaystackEntry = ProfileFilterMetaHaystackPersisted;



const metaCache = new Map<string, HaystackEntry>();



/** Uploader/channel label (**`basic_info.author`** only; no fallback to nested channel objects). */

function displayAuthorFromBasic(basic: NarrowYoutubeBasicInfo): string | undefined {

  const a = basic.author.trim();

  return a || undefined;

}



function viewCountFromBasic(basic: NarrowYoutubeBasicInfo): number | undefined {

  const v = basic.view_count;

  return v != null ? v : undefined;

}



function buildTitleDescriptionForClassifier(basic: NarrowYoutubeBasicInfo): string {

  const parts: string[] = [];

  if (basic.title.trim()) parts.push(basic.title.trim());

  if (basic.short_description.trim()) parts.push(basic.short_description.trim());

  return parts.join("\n\n");

}



function pushMetadataTerm(parts: string[], raw: string): void {

  const s = raw.trim();

  if (!s) return;

  if (s.includes(",")) {

    for (const piece of s.split(",")) {

      const t = piece.trim();

      if (t) parts.push(t);

    }

    return;

  }

  parts.push(s);

}



/**

 * Tokens for substring-style haystack (profile filter legacy path). Only uses narrowed

 * **`basic_info`** fields.

 */

function extractMetadataTerms(basic: NarrowYoutubeBasicInfo): string[] {

  const parts: string[] = [];

  if (basic.title.trim()) pushMetadataTerm(parts, basic.title);

  if (basic.author.trim()) pushMetadataTerm(parts, basic.author);

  if (basic.short_description.trim()) pushMetadataTerm(parts, basic.short_description);

  if (basic.category.trim()) pushMetadataTerm(parts, basic.category);

  for (const k of basic.keywords) pushMetadataTerm(parts, k);

  if (basic.tags)

    for (const t of basic.tags) pushMetadataTerm(parts, t);

  return parts;

}



/** Match tokens: narrowed **`keywords`** only (comma-separated originals already split upstream). */

function extractInnertubeVideoKeywords(basic: NarrowYoutubeBasicInfo): string[] {

  return [...basic.keywords];

}



function chunk<T>(arr: T[], size: number): T[][] {

  const out: T[][] = [];

  for (let i = 0; i < arr.length; i += size) {

    out.push(arr.slice(i, i + size));

  }

  return out;

}



async function ensureHaystackCached(

  videoId: string,

  yt: InstanceType<typeof Innertube>

): Promise<void> {

  const prev = metaCache.get(videoId);

  if (prev && Date.now() - prev.fetchedAt < META_CACHE_MS) {

    return;

  }



  const persisted = await getPersistedProfileFilterMetaRow(videoId);

  if (persisted) {

    metaCache.set(videoId, persisted);

    return;

  }



  try {

    const info = await yt.getBasicInfo(videoId);

    const basic = narrowYoutubeBasicInfo(info, videoId);

    const rawTitle = basic.title.trim() ? basic.title.trim() : "";

    const previewTitle = rawTitle || videoId;

    const classifierText = stripUrlsForClassifierText(

      buildTitleDescriptionForClassifier(basic)

    );

    const metadataTerms = extractMetadataTerms(basic);

    const videoKeywordTokens = extractInnertubeVideoKeywords(basic);

    const authorDisplay = displayAuthorFromBasic(basic);

    const videoKeywordsLower = keywordMatchTermsFromVideoKeywordsAndAuthor(

      videoKeywordTokens,

      authorDisplay

    );

    const vc = viewCountFromBasic(basic);

    const row: HaystackEntry = {

      haystackLower: metadataTerms.join("\n").toLowerCase(),

      metadataTermsLower: metadataTerms.map((t) => t.toLowerCase()),

      videoKeywordsLower,

      previewTitle,

      classifierText,

      ...(authorDisplay !== undefined ? { author: authorDisplay } : {}),

      ...(vc !== undefined ? { viewCount: vc } : {}),

      fetchedAt: Date.now(),

    };

    metaCache.set(videoId, row);

    try {

      await setPersistedProfileFilterMetaRow(videoId, row);

    } catch (persistErr) {

      log.error("persist profile-filter meta:", videoId, persistErr);

    }

  } catch (e) {

    log.error("getBasicInfo for filter:", videoId, e);

    const row: HaystackEntry = {

      haystackLower: null,

      metadataTermsLower: [],

      videoKeywordsLower: [],

      previewTitle: "(fetch failed)",

      classifierText: "",

      fetchedAt: Date.now(),

    };

    metaCache.set(videoId, row);

    try {

      await setPersistedProfileFilterMetaRow(videoId, row);

    } catch (persistErr) {

      log.error(

        "persist profile-filter meta (failed fetch):",

        videoId,

        persistErr

      );

    }

  }

}



function toPayloadEntry(entry: HaystackEntry): ProfileFilterMetadataEntry {

  const out: ProfileFilterMetadataEntry = {

    haystackLower: entry.haystackLower,

    metadataTermsLower: entry.metadataTermsLower,

    videoKeywordsLower: entry.videoKeywordsLower,

    previewTitle: entry.previewTitle,

    classifierText: entry.classifierText,

  };

  if (entry.author !== undefined) out.author = entry.author;

  if (entry.viewCount !== undefined) out.viewCount = entry.viewCount;

  return out;

}



export function getCachedFilterMetadataSnapshot(

  videoId: string

):

  | { hit: true; entry: ProfileFilterMetadataEntry; fetchedAt: number }

  | { hit: false } {

  const row = metaCache.get(videoId);

  if (!row) return { hit: false };

  if (Date.now() - row.fetchedAt >= META_CACHE_MS) return { hit: false };

  return { hit: true, entry: toPayloadEntry(row), fetchedAt: row.fetchedAt };

}



/**

 * Like {@link getCachedFilterMetadataSnapshot} but hydrates the L1 Map from

 * `chrome.storage.local` when the tab replica is cold.

 */

export async function getCachedFilterMetadataSnapshotAsync(

  videoId: string

): Promise<

  | { hit: true; entry: ProfileFilterMetadataEntry; fetchedAt: number }

  | { hit: false }

> {

  const l1 = getCachedFilterMetadataSnapshot(videoId);

  if (l1.hit) return l1;



  const row = await getPersistedProfileFilterMetaRow(videoId);

  if (!row) return { hit: false };

  metaCache.set(videoId, row);

  return {

    hit: true,

    entry: toPayloadEntry(row),

    fetchedAt: row.fetchedAt,

  };

}



export function clearProfileFilterMetaCache(): void {

  metaCache.clear();

  void clearAllPersistedProfileFilterMetaKeys().catch((e) => {

    log.error("clear persisted profile-filter meta:", e);

  });

}



/** Full in-memory cache dump for classifier test-bench (any TTL; includes stale rows). */

export function exportProfileFilterMetaCacheSnapshot(): ProfileFilterMetaCacheSnapshotRow[] {

  const out: ProfileFilterMetaCacheSnapshotRow[] = [];

  for (const [videoId, row] of metaCache) {

    out.push({

      videoId,

      entry: toPayloadEntry(row),

      fetchedAt: row.fetchedAt,

    });

  }

  return out;

}



/**

 * Merge `chrome.storage.local` rows (fresh TTL) with the in-tab Map export;

 * L1 wins on duplicate `videoId`.

 */

export async function exportProfileFilterMetaCacheSnapshotAsync(): Promise<

  ProfileFilterMetaCacheSnapshotRow[]

> {

  const all = await chrome.storage.local.get(null);

  const merged = new Map<string, HaystackEntry>();



  for (const [k, v] of Object.entries(all)) {

    if (!k.startsWith(PROFILE_FILTER_META_STORAGE_KEY_PREFIX)) continue;

    if (typeof v !== "string") continue;

    const videoId = k.slice(PROFILE_FILTER_META_STORAGE_KEY_PREFIX.length);

    if (!videoId) continue;

    try {

      const o = JSON.parse(v) as unknown;

      if (!isProfileFilterMetaHaystackPersisted(o)) continue;

      if (Date.now() - o.fetchedAt >= META_CACHE_MS) continue;

      merged.set(videoId, o);

    } catch {

      /* skip */

    }

  }



  for (const [videoId, row] of metaCache) {

    merged.set(videoId, row);

  }



  return [...merged.entries()].map(([videoId, row]) => ({

    videoId,

    entry: toPayloadEntry(row),

    fetchedAt: row.fetchedAt,

  }));

}



export async function computeProfileFilterMetadata(

  payload: ProfileFilterComputePayload

): Promise<ProfileFilterComputeResponse> {

  const { generation, videoIds } = payload;



  try {

    const yt = await getSharedInnertube();

    const uniqueIds = [...new Set(videoIds)];



    for (const batch of chunk(uniqueIds, 4)) {

      await Promise.all(batch.map((id) => ensureHaystackCached(id, yt)));

    }



    const metadataByVideoId: Record<string, ProfileFilterMetadataEntry> = {};

    for (const videoId of uniqueIds) {

      const entry = metaCache.get(videoId);

      if (entry) {

        metadataByVideoId[videoId] = toPayloadEntry(entry);

      } else {

        metadataByVideoId[videoId] = {

          haystackLower: null,

          metadataTermsLower: [],

          videoKeywordsLower: [],

          previewTitle: videoId,

          classifierText: "",

        };

      }

    }



    return { generation, metadataByVideoId };

  } catch (e) {

    const msg = e instanceof Error ? e.message : String(e);

    log.error("computeProfileFilterMetadata failed:", e);

    return { generation, metadataByVideoId: {}, error: msg };

  }

}

