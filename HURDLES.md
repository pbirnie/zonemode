# Engineering hurdles

This document records **non-obvious platform, browser, or API constraints** that forced a design or implementation change. Entries are numbered **`## 1.` … `## N.` in chronological order**: **oldest constraint first** (by first appearance in **parent** Cursor agent transcripts for this repo, where timestamps exist; otherwise by inferred development phase). For user-facing release notes see **ENHANCEMENTS.md**; for product behavior see **PRD.md**.

**Transcript source (analyze-sessions style):** Parent JSONL only — `~/.cursor/projects/c-projects-zonemode/agent-transcripts/<uuid>/<uuid>.jsonl` (not `subagents/`). Layout and `jq` notes: **`.cursor/rules/cursor-transcript-layout.mdc`**.

| Session UUID (parent) | First dated user turn | Theme (short) |
|------------------------|------------------------|---------------|
| `8390fba5-ec52-490e-bcb4-c7078e1f2d45` | *(undated in file)* | In-Chrome settings / OpenRouter API key discovery |
| `29df97d9-7886-4b5a-851c-bb60ca6491a4` | 2026-05-03 | Release **1.0.5** / versioning & changelog hygiene |
| `efafd8c2-62a1-4af0-960a-115cc1cc7679` | 2026-05-04 | OpenRouter AI SDK, streaming, logging, transcripts, zip releases, profiles, hover metadata, semantic filter |
| `7796a06f-60fa-403d-baf5-348f09d49ec9` | *(no `<timestamp>` on first line)* | Git vs “last change in this chat” |

---

## 1. Toolbar-only MV3 extension had no obvious in-Chrome configuration path

**Obstacle.** Early feedback (parent session **`8390fba5…`**): the extension loaded in Chrome and showed a toolbar icon, but there was **no clear way to configure** it (e.g. OpenRouter API key) from inside the browser. MV3 extensions do not get a configuration UI unless you ship **`options_page` / `action` default_popup**, in-page UI, or document how to open settings.

**Mitigation.** Add a **settings surface**: popup and/or gear on the watch page, **`chrome.storage.sync`** for keys and provider, and consistent entry points (later: **`OPEN_SETTINGS_UI`**, cog opens same popup — see that session’s follow-ups).

---

## 2. Release versioning must stay aligned across manifest, package, and changelogs

**Obstacle.** Parent session **`29df97d9…`** (2026-05-03): shipping a version (“realse 1.0.5”) requires **`package.json`**, **`manifest.json`**, **ENHANCEMENTS.md**, and **`popupChangelog.ts`** to stay coherent; drift confuses testers and store submissions.

**Mitigation.** Treat version bumps as a **single atomic edit** across those files; repo rule **`.cursor/rules/enhancements-log.mdc`** (reverse-chronological changelog) encodes ordering expectations.

---

## 3. OpenRouter in the MV3 service worker: raw `fetch` vs AI SDK, and bundling visibility

**Obstacle.** Session **`efafd8c2…`** (2026-05-04 onward): moving OpenRouter to **`@openrouter/ai-sdk-provider`** + **`ai`** required running **`streamText` / `generateText`** in the **background** and relaying chunks over **`chrome.runtime.connect`** ports. Investigation showed the **built `dist/background/index.js` sometimes lacked** the new OpenRouter path (“tree-shaken out or failed to bundle”) — silent failure at runtime until bundle contents were grepped.

**Mitigation.** Keep OpenRouter handlers **explicitly imported** and verified in **`build.ts`** output; add logging on port open/first chunk; later **`OPENROUTER_COMPLETE`** non-streaming path reduced moving parts when streaming was toggled off.

---

## 4. Streaming adds complexity in MV3 (ports, chunk relay, user-visible “tokens:0”)

**Obstacle.** Same **`efafd8c2…`** thread: streaming required **long-lived ports**, chunk queues, and coordinated errors; users hit **empty streams** (`tokens:0`) and unclear service-worker logs. Product direction oscillated (“remove streaming” / “change code back to support streaming”).

**Mitigation.** Support both patterns over time: **`streamText`** + **`fullStream`/`textStream` diagnostics** when streaming; **`generateText`** for **`OPENROUTER_COMPLETE`** when non-streaming; **`.cursor/rules/api-logging.mdc`** + shared logger for outbound/response visibility.

---

## 5. YouTube transcript extraction: Google rate limits and identical upstream endpoints

**Obstacle.** **`efafd8c2…`**: “google is rate limiting” — any library that scrapes InnerTube / timedtext hits the **same** rate limits; swapping npm names alone does not remove quotas.

**Mitigation.** **`youtube-transcript-plus`** with **`cacheTTL`**, then **DOM fallback** (click **Show transcript**, scrape `#segments-container` / segment renderers) when the library fails — see **`src/content/utils/subtitles.ts`** and transcript-related **ENHANCEMENTS** bullets.

---

## 6. Windows release artifacts: `tar` vs real `.zip` for GitHub uploads

**Obstacle.** **`efafd8c2…`**: user could not extract a “zip” produced the wrong way on Windows; asked to use **`zip` not `tar`**.

**Mitigation.** **`.cursor/skills/build-extension-zip/SKILL.md`** documents building **`extension-unpacked.zip`** via **PowerShell `ZipFile`** (or equivalent) from **`dist/`**; **`extension-unpacked.zip`** in **`.gitignore`**.

---

## 7. Classic MV3 content script bundle lacks real `import.meta`

**Obstacle.** Content scripts are **classic scripts**, not `type="module"`, but **Transformers.js / ORT** expect **`import.meta.url`** (or similar) for asset bases.

**Mitigation.** **`build.ts`** **`define`** for the content entry: replace **`import.meta`** with `({ url: chrome.runtime.getURL("content/index.js") })` so bundled deps resolve extension URLs correctly.

---

## 8. Native `fetch` and “Illegal invocation” under youtubei.js

**Obstacle.** **`efafd8c2…`**: hover / **`getBasicInfo`** failed with **`Failed to execute 'fetch' on 'Window': Illegal invocation`** — **youtubei.js** calls a **stored** `fetch` without binding **`this`**, and Chromium’s intrinsic **`fetch`** rejects unbound calls.

**Mitigation.** **`src/content/fetchBindPatch.ts`**, imported first from **`src/content/index.ts`**: `globalThis.fetch = globalThis.fetch.bind(globalThis)`.

---

## 9. InnerTube `getBasicInfo` from the extension service worker returns HTTP 403

**Obstacle.** **`/youtubei/v1/player`**-style traffic from the **MV3 service worker** often returns **403** (no first-party tab session / client parity with the watch page). Profile-filter metadata was initially fetched from the SW.

**Mitigation.** **`src/offscreen/profileFilterMetaCache.ts`** + **`getSharedInnertube()`** in the **offscreen document**; the **content script** keeps a **read replica** in `src/content/profileFilterMetaCache.ts` (updated from RPC responses). Hover diagnostics call **`INNERTUBE_GET_DIAGNOSTIC_JSON`** offscreen (no youtubei.js in the service worker). If offscreen **`getBasicInfo`** ever regresses (403 in some Chrome builds), fall back or document here.

---

## 10. ONNX Runtime Web dynamic `import()` in the MV3 service worker

**Obstacle.** ORT’s browser bundle loads WASM glue via dynamic `import()` of a runtime URL (minified as `(await import($)).default`). The HTML spec **disallows `import()` in `ServiceWorkerGlobalScope`**; vendored **`ort-wasm-*.mjs`** files also contain `import()`, so a post-build rewire of the main bundle alone still fails with **`no available backend found`** / **`import() is disallowed on ServiceWorkerGlobalScope`**.

**Mitigation.** **Zero-shot classification runs in the MV3 offscreen document** (`src/offscreen/zeroShotClassifier.ts`), where extension-scoped dynamic `import()` is allowed. The **watch-page content script** sends ops via **`chrome.runtime.connect`** (**`extensionOffscreenRpc`**: `src/shared/extensionOffscreenRpc.ts`, re-exported as `src/content/offscreenClient.ts` → **`CONTENT_OFFSCREEN_RPC_PORT_NAME`** → `orchestrator.forwardToOffscreen`). **`preloadOrtWasmBinary`** pre-fetches WASM bytes via `fetch()` in offscreen. The **classifier test bench** uses the same port client + dedicated thin module [`testBenchZeroShot.ts`](../src/test-bench/testBenchZeroShot.ts) so **`test-bench/index.js` does not bundle a second Transformers/ONNX/MobileBERT stack**. The **service worker** does **not** bundle Transformers.js / ORT (see **`.cursor/rules/mv3-sw-orchestrator.mdc`**).

---

## 11. Vendored zero-shot model and ONNX Runtime Web binaries (build-time embedding)

**Obstacle.** Runtime Hub/CDN downloads for **MobileBERT MNLI** + **onnxruntime-web** imply **`host_permissions`**, latency, and non-reproducible builds.

**Mitigation.** **`build.ts`** vendors **`Xenova/mobilebert-uncased-mnli`** with **`onnx/model_q4f16.onnx`** only (smallest ONNX in that Hub folder; no fp32 **`model.onnx`** in the shipped package). Copies pinned **ORT** **`.mjs`/`.wasm`** into **`dist/onnx-wasm/`**, **`local_files_only: true`**, **`chrome.runtime.getURL`**, manifest **`web_accessible_resources`**.

---

## 12. Hub `tokenizer_config.json` `model_max_length` vs. bundled ONNX sequence cap

**Obstacle.** Hub export can advertise **`model_max_length`** incompatible with the **fixed ONNX** graph → shape errors (e.g. 512 vs longer spans).

**Mitigation.** Post-vendor rewrite in **`build.ts`**: set **`model_max_length`: 512** in **`tokenizer_config.json`**.

---

## 13. Web Cache API rejects `chrome-extension:` URLs (Transformers.js WASM / model cache)

**Obstacle.** **Transformers.js** sets **`useWasmCache` / `useBrowserCache`** when **`caches`** exists; **`caches.put`** with **`chrome-extension://…`** throws **unsupported scheme** (e.g. **`ort-wasm-simd-threaded.asyncify.wasm`**).

**Mitigation.** **`applyExtensionTransformersEnv`** in **`src/offscreen/zeroShotClassifier.ts`**: **`env.useWasmCache = false`**, **`env.useBrowserCache = false`**, keep **`wasm.wasmPaths`** pointing at vendored extension URLs.

---

## 14. Controlled React textarea and comma / newline keyword parsing

**Obstacle.** Re-parsing on every **`onChange`** strips **trailing commas** and makes typing feel “broken” for multi-line keyword lists.

**Mitigation.** **`SettingsPanel.tsx`**: **`keywordsDraftByProfileId`**, parsed on **blur** (comma/newline-preserving drafts while typing via **`parseKeywordsCsv`** — **`summaryProfiles.ts`**). The **toolbar popup** (**`tabbed`**) buffers **all** fields in React and writes **`chrome.storage.sync` only after **Save**; **Close** discards unsaved edits. **Keyword drafts** merge into profiles on blur or atomically during **Save** via **`mergeKeywordDraftsIntoProfiles`**.

---

## 15. `chrome.storage.sync` per-item and total byte quotas

**Obstacle.** **`QUOTA_BYTES_PER_ITEM`** (8 192 B) and **`QUOTA_BYTES`** (~100 KiB total). **`summaryUserProfiles`** is one JSON blob under one key — competes with prompts, **`apiKey`**, provider JSON, etc.

**Mitigation.** Keep heavy assets **bundled** (see **§11**); no automatic sharding today — future: **`storage.local`**, split keys, preflight size checks, surface **`runtime.lastError`**.

---

## 16. MV3 service worker cannot host long `fetch` / ORT / LLM stacks

**Obstacle.** MV3 **service workers** are **`ServiceWorkerGlobalScope`**: dynamic **`import()`** (ORT WASM glue), **youtubei.js** first-party parity, and bundling **OpenRouter + AI SDK** next to short-lived SW lifetimes all caused brittle builds and platform mismatches (see HURDLES **§3**, **§9**, **§10**).

**Mitigation.** **`chrome.offscreen.createDocument`** (`offscreen/offscreen.html` + bundled **`offscreen/offscreen.js`**) runs **Innertube metadata**, **Transformers zero-shot**, **`OPENROUTER_COMPLETE`**, and **`PROXY_REQUEST`** **`fetch`**. The SW (`background/index.ts`) only **routes** tab/popup messages and **`OFFSCREEN_RPC`** through **`orchestrator.ts`**. Rule: **`.cursor/rules/mv3-sw-orchestrator.mdc`**.

---

## 17. MV3 default extension CSP blocks WebAssembly unless `wasm-unsafe-eval`

**Obstacle.** Without an explicit **`content_security_policy.extension_pages`**, Chrome’s default for MV3 is **`script-src 'self'`** only — **`WebAssembly.instantiate()`** is rejected (“**wasm-eval** / **unsafe-eval** … not allowed … **script-src 'self'**”), so **ONNX Runtime Web** cannot run in **extension pages** (e.g. **`test-bench/index.html`**, offscreen document, popup) even for same-origin packaged **`.wasm`** assets.

**Mitigation.** Declare the documented minimum policy in **`manifest.json`**: **`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`** (`[src/static/manifest/manifest.json](src/static/manifest/manifest.json)`). **`'unsafe-eval'`** remains disallowed for extension pages; **`'wasm-unsafe-eval'`** is the narrow WebAssembly carve-out. See [Chrome — Manifest CSP](https://developer.chrome.com/docs/extensions/mv3/manifest/content_security_policy/).

---

## 18. Classifier test-bench needs `tabs` to read `profileFilterMetaCache` on a live YouTube tab

**Obstacle.** The test-bench **extension page** cannot access another tab’s content-script in-memory **`Map`**. **`activeTab`** does not grant the background enough access to **arbitrary** open **`youtube.com`** tabs from the test-bench UI.

**Mitigation.** **`tabs`** in **`manifest.json`** so the **service worker** can **`chrome.tabs.query`** YouTube URLs and **`tabs.sendMessage`** **`TEST_BENCH_GET_METADATA_SNAPSHOT`** to **`content/testBenchBridge.ts`**, which returns **`exportProfileFilterMetaCacheSnapshotAsync`** (merges **L1** `Map` + **`chrome.storage.local`** rows) from **`profileFilterMetaCache.ts`**. See **[docs/PRD-test-bench.md](docs/PRD-test-bench.md)** §4.0a.

---

## 19. Profile-filter metadata: `chrome.storage.sync` quota vs. cross-session cache

**Obstacle.** Caching many **`getBasicInfo`** slices for the profile filter would quickly exceed **`chrome.storage.sync`** per-item (**8 192 B**) and total (**~100 KiB**) quotas if keys lived in sync (see **HURDLES §15**).

**Mitigation.** Persist rows under **`chrome.storage.local`** only — keys **`ytSum_pfMeta_v1::<videoId>`** (JSON strings), **12-minute** freshness parity with the in-tab **`Map`**, **~200** non-stale rows max (eviction + stale key purge in **`profileFilterMetaStorage.ts`**). **`clearProfileFilterMetaCache`** clears **L1** and **all** prefixed local keys on **Clear Cache**.

---

## 20. `chrome.offscreen.closeDocument()` races `hasDocument` during offscreen bootstrap

**Obstacle.** **`ensureOffscreenDocument`** calls **`chrome.offscreen.closeDocument()`** when **`hasDocument`** is true but the **background ↔ offscreen** **`runtime.Port`** is missing. **`closeDocument`** can reject **“No current offscreen document.”** when internal state races teardown.

**Mitigation.** **`orchestrator.ts`** wraps **`closeDocument()`** in **`try/catch`** so rejection does not abort **`ensureOffscreenDocument`** before **`createDocument`** for **`PROXY_REQUEST`** / **`forwardToOffscreen`** (e.g. Hugging Face fetches from **`src/content/utils/ai.ts`**). An earlier settings-only **`GET`** to OpenRouter’s **`/api/v1/key`** (account limits UI) justified **`manifest` `host_permissions`** for **`https://openrouter.ai/*`** — that popup UI and **`host_permission`** row were removed; OpenRouter completions still use **`OPENROUTER_COMPLETE`** in offscreen.

---

## 21. MV3 `sendMessage` channel vs. multi-second `OFFSCREEN_RPC` (zero-shot batch)

**Obstacle.** Watch-page **`callOffscreen`** used **`chrome.runtime.sendMessage`** with **`OFFSCREEN_RPC`** and **`handleOffscreenRpc`** returning **`true`** and **`sendResponse`** only after **`await forwardToOffscreen`** (slow **`CLASSIFY_VIDEO_BATCH`** over ONNX). Chrome surfaces **“A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received”** — the **`sendMessage`** reply channel does not reliably stay open through long SW ↔ offscreen RPC.

**Mitigation.** **`src/shared/extensionOffscreenRpc.ts`** (re-exported from **`src/content/offscreenClient.ts`** for watch pages) opens **`chrome.runtime.connect`** (**`CONTENT_OFFSCREEN_RPC_PORT_NAME`** in **`src/shared/offscreenMessages.ts`**); **`src/background/orchestrator.ts`** **`chrome.runtime.onConnect`** routes that port through **`wireContentToBackgroundOffscreenRpc`** → **`forwardToOffscreen`**, replying via **`port.postMessage`**. **Classifier test bench** uses **`extensionCallOffscreen`** from the same **`extensionOffscreenRpc.ts`**. **`handleOffscreenRpc`** stays for any **`sendMessage`** **`OFFSCREEN_RPC`** callers.

---

## 22. YouTube watch sidebar mounts related tiles after navigation (no extra `yt-navigate-finish`)

**Obstacle.** **`yt-navigate-finish`** fires when the primary watch page transitions, but **`ytd-watch-flexy`** often **lazy-appends** related / sidebar video renderers afterward. **`runProfileVideoFilter`** used to run **only** on that event (plus settings / refresh), while **`MutationObserver`** paths only applied **grey** default outlines — so **metadata + zero-shot classification** tended to stick to whichever tiles existed at **first pass** (often the first handful of DOM-mounted related videos).

**Mitigation.** **`videoProfileFilter.ts`**: **`scheduleDomSidebarProfileFilterStaleCheck()`** (**`DOM_SIDEBAR_FILTER_DEBOUNCE_MS`** debounced) compares a **renderer-count + sorted-video-id fingerprint** against **`lastProfileFilterFingerprint`** after a completed pass; mismatches enqueue **`scheduleProfileFilterRun()`**. **`yt-navigate-finish`** clears **`lastProfileFilterFingerprint`** so the first SPA burst after navigation still retriggers cleanly.

---

## 23. ONNX / Transformers semantic profile-filter stack removed (Approx. era: profile-filter pivot, 2026-05)

**Obstacle.** Vendoring **MobileBERT**, **ONNX Runtime Web**, and **`@huggingface/transformers`** bloated **`dist/`**, forced **`wasm-unsafe-eval`** in extension-page CSP plus Hugging Face **`host_permissions`**, and tied slow **`OFFSCREEN_RPC`** paths (**`CLASSIFY_VIDEO_BATCH`**, LRU score caches, bench shims) to a secondary semantic layer on top of **`metadata_exact`**.

**Mitigation.** Dropped Transformers/zero-shot (**`zeroShotClassifier.ts`**, **`keywordZeroShotClassifier.ts`**, **`testBenchZeroShot.ts`**, ONNX vend steps in **`build.ts`**, related **`OFFSCREEN_OP_*`**). **`finalizeProfileVideoResult`** (**`profileFilterScoring.ts`**) is **`metadata_exact` only** on **`videoKeywordsLower`**. **`offscreen.ts`** keeps **`OPENROUTER_COMPLETE`** and **`PROXY_REQUEST`**; **`CLEAR_WORK_CACHES`** is intentionally a **no-op** placeholder for future offscreen LRU work.

---

## 24. Legacy profile-filter haystack rows marked title-only vs unified `classifierText`

**Obstacle.** Older **`chrome.storage.local`** snapshots could persist **`classifierTitleOnly: true`** with title-only **`classifierText`**. Keeping those rows loaded would contradict a single production rule (**title + short description**, URLs stripped) and confuse test-bench parity.

**Mitigation.** **`profileFilterMetaStorage.ts`** rejects persisted rows where **`classifierTitleOnly === true`** so **`ensureHaystackCached`** refetches via **`getBasicInfo`**. **`LEGACY_STORAGE_KEY_PROFILE_FILTER_CLASSIFIER_TITLE_ONLY`** is removed from **`chrome.storage.sync`** on toolbar **Save** (**`SettingsPanel.tsx`**).

---

## 25. `#above-the-fold` first-child injection can render under YouTube’s player overlap

**Obstacle.** In **`scheduleInjectSummaryButton`** / **`mountSummaryButtonIntoFold`** (**`src/content/index.ts`**), injecting **`#zonemode-extension-container`** as the **first DOM child** of **`#above-the-fold`** coincides with **`ytd-watch-flexy`** / cinematic layouts where the **primary player** occupies the same stacking / grid region from the viewport’s perspective. Hit-testing hovers (**move from player to chrome**) can briefly reflow chromeless UI modes, making the summarize surface look like an icon that **only appears on mouse-over** rather than absent.

**Mitigation.** Prefer **`ytd-watch-metadata.insertAdjacentElement("afterend", container)`** when that element exists inside **`#above-the-fold`**; fallback to the legacy **first-child** insertion when metadata is absent; add **`position: relative; z-index: 2`** on **`#zonemode-extension-container`** in **`styles.css`** to win against incidental sibling overlays while staying below site-wide dialogs.

### Maintaining this file

When a fix is forced by a **platform / browser / extension / dependency** limitation, append the next section as **`## {N+1}. …`** (see **`.cursor/rules/hurdles-log.mdc`**) and keep **chronological** order — insert in-order by **discovery date** if known, or append at the end with a short **“Approx. era”** note in the **Obstacle** paragraph.
