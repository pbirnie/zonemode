import { logPrdEvent } from "../shared/prdEventLog";

/**
 * youtubei.js calls stored `fetch` as `Platform.shim.fetch(...)`, so `this` is
 * not `Window`. Native `fetch` requires a bound receiver — otherwise Chrome
 * throws "Illegal invocation" in extension content scripts.
 */
if (typeof globalThis.fetch === "function") {
  globalThis.fetch = globalThis.fetch.bind(globalThis);
  logPrdEvent("content", "1", "fetch_bind_patch_applied", {});
}
