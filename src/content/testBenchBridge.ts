import { TEST_BENCH_GET_METADATA_SNAPSHOT } from "../shared/testBenchMessages";
import { exportProfileFilterMetaCacheSnapshotAsync } from "./profileFilterMetaCache";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === TEST_BENCH_GET_METADATA_SNAPSHOT) {
    void (async () => {
      try {
        const rows = await exportProfileFilterMetaCacheSnapshotAsync();
        sendResponse({ ok: true, rows });
      } catch (e) {
        sendResponse({
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return true;
  }
  return false;
});
