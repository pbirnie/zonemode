import type { ProfileFilterMetadataEntry } from "./profileFilterMessages";

export const TEST_BENCH_GET_METADATA_SNAPSHOT = "TEST_BENCH_GET_METADATA_SNAPSHOT" as const;

/** One row from the in-tab `profileFilterMetaCache` Map (test-bench / dev only). */
export type ProfileFilterMetaCacheSnapshotRow = {
  videoId: string;
  entry: ProfileFilterMetadataEntry;
  fetchedAt: number;
};

export type TestBenchGetMetadataSnapshotContentResponse =
  | { ok: true; rows: ProfileFilterMetaCacheSnapshotRow[] }
  | { ok: false; error: string };

export type TestBenchGetMetadataSnapshotBgResponse =
  | {
      ok: true;
      rows: ProfileFilterMetaCacheSnapshotRow[];
      tabId: number;
      tabUrl?: string;
    }
  | { ok: false; error: string };
