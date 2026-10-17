/**
 * Persisted profile-filter metadata rows in chrome.storage.local (per video).
 * Not sync — see HURDLES (sync quotas). Content script reads/writes; Clear Cache wipes keys.
 */

export const PROFILE_FILTER_META_STORAGE_KEY_PREFIX = "ytSum_pfMeta_v1::";

/** Same freshness window as the in-tab Map replica. */
export const PROFILE_FILTER_META_TTL_MS = 12 * 60 * 1000;

/** Cap distinct videos stored; oldest `fetchedAt` evicted first. */
export const PROFILE_FILTER_META_PERSIST_MAX_ENTRIES = 200;

export type ProfileFilterMetaHaystackPersisted = {
  haystackLower: string | null;
  metadataTermsLower: string[];
  videoKeywordsLower: string[];
  previewTitle: string;
  classifierText: string;
  author?: string;
  viewCount?: number;
  fetchedAt: number;
};

export function isProfileFilterMetaHaystackPersisted(
  x: unknown
): x is ProfileFilterMetaHaystackPersisted {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (!(o.haystackLower === null || typeof o.haystackLower === "string"))
    return false;
  if (!Array.isArray(o.metadataTermsLower)) return false;
  if (!o.metadataTermsLower.every((t) => typeof t === "string")) return false;
  if (!Array.isArray(o.videoKeywordsLower)) return false;
  if (!o.videoKeywordsLower.every((t) => typeof t === "string")) return false;
  if (typeof o.previewTitle !== "string") return false;
  if (typeof o.classifierText !== "string") return false;
  if (
    o.author !== undefined &&
    (typeof o.author !== "string" || o.author.length > 512)
  )
    return false;
  if (
    o.viewCount !== undefined &&
    (typeof o.viewCount !== "number" || !Number.isFinite(o.viewCount))
  )
    return false;
  /** Legacy rows cached title-only `classifierText`; invalidate so they refetch with title + description. */
  if ((o as Record<string, unknown>).classifierTitleOnly === true)
    return false;
  if (typeof o.fetchedAt !== "number" || !Number.isFinite(o.fetchedAt))
    return false;
  return true;
}

export function storageKeyForProfileFilterMeta(videoId: string): string {
  return `${PROFILE_FILTER_META_STORAGE_KEY_PREFIX}${videoId}`;
}

export async function getPersistedProfileFilterMetaRow(
  videoId: string
): Promise<ProfileFilterMetaHaystackPersisted | null> {
  const key = storageKeyForProfileFilterMeta(videoId);
  const bag = await chrome.storage.local.get(key);
  const raw = bag[key];
  if (typeof raw !== "string") return null;
  try {
    const o = JSON.parse(raw) as unknown;
    if (!isProfileFilterMetaHaystackPersisted(o)) return null;
    if (Date.now() - o.fetchedAt >= PROFILE_FILTER_META_TTL_MS) return null;
    return o;
  } catch {
    return null;
  }
}

async function evictProfileFilterMetaIfOverLimit(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  type RowMeta = { key: string; fetchedAt: number };
  const fresh: RowMeta[] = [];
  const staleOrBad: string[] = [];

  for (const [k, v] of Object.entries(all)) {
    if (!k.startsWith(PROFILE_FILTER_META_STORAGE_KEY_PREFIX)) continue;
    if (typeof v !== "string") {
      staleOrBad.push(k);
      continue;
    }
    try {
      const o = JSON.parse(v) as unknown;
      if (!isProfileFilterMetaHaystackPersisted(o)) {
        staleOrBad.push(k);
        continue;
      }
      if (Date.now() - o.fetchedAt >= PROFILE_FILTER_META_TTL_MS) {
        staleOrBad.push(k);
        continue;
      }
      fresh.push({ key: k, fetchedAt: o.fetchedAt });
    } catch {
      staleOrBad.push(k);
    }
  }

  const toRemove = [...staleOrBad];
  if (fresh.length > PROFILE_FILTER_META_PERSIST_MAX_ENTRIES) {
    fresh.sort((a, b) => a.fetchedAt - b.fetchedAt);
    const excess = fresh.length - PROFILE_FILTER_META_PERSIST_MAX_ENTRIES;
    toRemove.push(...fresh.slice(0, excess).map((r) => r.key));
  }

  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

export async function setPersistedProfileFilterMetaRow(
  videoId: string,
  row: ProfileFilterMetaHaystackPersisted
): Promise<void> {
  const key = storageKeyForProfileFilterMeta(videoId);
  await chrome.storage.local.set({ [key]: JSON.stringify(row) });
  await evictProfileFilterMetaIfOverLimit();
}

export async function clearAllPersistedProfileFilterMetaKeys(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) =>
    k.startsWith(PROFILE_FILTER_META_STORAGE_KEY_PREFIX)
  );
  if (keys.length > 0) await chrome.storage.local.remove(keys);
}
