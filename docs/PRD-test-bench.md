

# Classifier test bench — PRD appendix

Companion to the **[PRD.md](PRD.md)**. 
Describes requirements for the  `chrome-extension://…/test-bench/index.html` dev page bundled under `dist/test-bench/`.

## Purpose

Understand if the classifier is working correctly against either:

1. Bundled **sample JSON** fixtures, or
2. A live `/watch` tab’s `profileFilterMetaCache` snapshot (`TEST_BENCH_GET_METADATA_SNAPSHOT`).

There is **no** semantic / ONNX classifier: matching is `metadata_exact` only (Innertube `basic_info.keywords` tokens plus optional author/channel token in `videoKeywordsLower`).

## UI

| Area                  | Behavior                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Table rows**        | Sample mode: one row per fixture. YouTube-tab mode: one row per cache snapshot row (**Load from YouTube tab**). |
| **Keywords / labels** | Comma-separated; normalized with shared limits (`classifierConstants`).                                         |

Sample rows synthesize `classifierText` from **title + short description** (URLs stripped), matching production cache behavior; YouTube-tab rows use persisted `classifierText` from the tab cache.
| **Reclassify** | Recomputes the **Classification result** column using `finalizeProfileVideoResult` for every visible row. |
| `configEcho` **/** `#summary` | Echo run parameters (`dataSource`, matcher string, counts). |

## Messages

Uses `tabs` permission (see **PRD**) so the background `TEST_BENCH_GET_METADATA_SNAPSHOT` handler can read `chrome.storage.local` + in-memory cache from an active `youtube.com` tab.

## Build

Included in `build.ts` as an extra browser bundle (`test-bench/index.ts` → `dist/test-bench/index.js`).

## Related paths

| Path                                 | Role                                    |
| ------------------------------------ | --------------------------------------- |
| `src/test-bench/index.ts`            | Bench page logic                        |
| `src/test-bench/index.html`          | Static shell                            |
| `src/shared/profileFilterScoring.ts` | `finalizeProfileVideoResult`            |
| `src/shared/classifierConstants.ts`  | Keyword / label caps for bench textarea |
