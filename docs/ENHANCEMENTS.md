# Enhancements

Human-readable log of **user-visible** and **noteworthy** changes to the ZoneMode Chrome extension.

Agents and contributors should add changelog sections here whenever they ship new behavior—see [.cursor/rules/enhancements-log.mdc](.cursor/rules/enhancements-log.mdc) (always-on Cursor rule). Under **Changelog**, keep **Unreleased** (when used) and version headings **newest first**; older baselines last.

## Changelog

### Unreleased

- **Settings popup**: The window no longer adds its own scrollbar on top of the page scroll. The popup scrolls once; a long keyword list still scrolls inside its box.
- **Toolbar icon**: The extension icon is the ZoneMode mark (`src/static/icons/`, sizes 16, 32, 48, and 128) instead of the generated red “S”.
- **Chat prompt**: Default system message includes the summary, video title, and full transcript from Summarize. Replies should start with a terse one-liner of the summary, then a longer answer. A saved chat prompt stays until you edit it or use **Reset prompts to defaults**.
- **Install defaults (API and summary prompt)**: Provider defaults to **OpenRouter** and the model to `xiaomi/mimo-v2.5` when nothing is saved. The built-in summary prompt is a concise markdown **Key Points** summary of `{{TRANSCRIPT}}` (formatting rules, no intro line, no `{{TITLE}}`). A saved prompt or provider is left as-is; **Reset prompts to defaults** applies the new summary text.
- **Install defaults**: A new install adds **AiFocus** (selected on the watch bar; keywords: AI, LLM, Artificial Intelligence, Anthropic, Claude code, Cursor, Fireship, Dwarkesh Patel, Matt Pocock), **News** (Sky News, Ed Conway). Updating an existing install does not replace saved profiles.
- **Name**: The extension shows as **ZoneMode** (toolbar, popup title, test bench tab). Package name and GitHub repo stay **zonemode**. 
- **Watch page**: Summarize bar attaches **below** `ytd-watch-metadata` when that node exists so it stays visible above YouTube’s player/grid layering (fallback: first child of `#above-the-fold` until metadata mounts). `#zonemode-extension-container` also gets `z-index: 2` for stray overlays.
- **Toolbar settings (popup)**: **Save** persists to sync storage and **closes** the popup (same validation as before). **Close** still exits without saving.
- **Profiles / watch bar**: Renamed **Auto-mute** to **Auto-hide** (same black mask on no-match compact recommendation tiles).
- **Metadata hover (Debug)**: When the tab’s **profile-filter meta cache** (L1) already holds the video, the pinned panel paints **cache-only** JSON (`profile_filter_worker`) immediately—no “Loading…” row—while `getBasicInfo` continues in parallel; cold L1 still shows loading until storage hydrates or Innertube returns.
- **Metadata hover (Debug)**: **~300 ms** dwell before the diagnostic panel opens (fewer accidental opens when skimming links; previously **~100 ms** after dropping the older **180 ms** + debounce stack).
- **Toolbar popup (settings)**: Sticky strip keeps **Save**, **Close**, sync hint, and **tab pills** visible while `#root` scrolls tab content; profile keyword lists no longer scroll inside capped textareas (`popup/styles.css`).
- **Profile filter + link-hover JSON**: Innertube `getBasicInfo` collapses `basic_info` to `id`, `title`, `keywords`, `short_description`, `view_count`, `author`, `is_family_safe`, `category`, and `tags` before scoring/classifier work and pinned hover diagnostics (`narrowYoutubeBasicInfo`); `basic_info.channel` and other blobs are discarded.
- **Prompt templates**: The summary template uses `{{TRANSCRIPT}}` (see the install-defaults bullet). The chat template uses `{{SUMMARY}}`, `{{TITLE}}`, and `{{TRANSCRIPT}}` (see the chat-prompt bullet).
- **Removed semantic profile filter (MobileBERT)**: Sidebar keyword matching uses **only** `metadata_exact` tokens from Innertube `basic_info.keywords` plus the channel label (`videoKeywordsLower`). **Toolbar Save** clears legacy `profileFilterZeroShotEnabled` / `profileFilterZeroShotThresholdPct` from `chrome.storage.sync`. Drops `@huggingface/transformers`, vendored `models/`, ORT WASM, extra Hugging Face `host_permissions`, and `wasm-unsafe-eval` in extension-page CSP (`CLEAR_WORK_CACHES` still runs during **Clear Cache** as a harmless offscreen ping).
- **Classifier test bench (dev)**: **Seven** columns (dropped zero-shot/threshold/WebGPU/**Duration**). **Removed** **wink-nlp** (**Entities** / **Nouns**). **Reclassify** mirrors production `finalizeProfileVideoResult` (no offscreen ONNX).
- **Settings (Debug)**: Removed zero-shot classifier + match-threshold controls and **title-only cached classifier text** (`profileFilterClassifierTitleOnly` cleared on **Save**).
- **Settings (API tab)**: Removed OpenRouter **account limits** (`GET /api/v1/key`) from the toolbar settings popup; dropped `https://openrouter.ai/`* from `host_permissions` (model list still loads via `PROXY_REQUEST` / offscreen `fetchModels`).
- **Watch page (profile filter / sidebar tiles)**: **Debounced (~1.5s)** metadata + `metadata_exact` pass **re-run** when sidebar renderers grow or resolved video IDs change (**HURDLES §22**); grey-outline-only mutation path stays lightweight.
- **Watch page**: Summarize UI mounts **after** `#above-the-fold` appears and the primary player `loadeddata` **/** `canplay` when possible; **3 second** cap per attempt then mount anyway (or retry if the fold is still missing).
- **Settings**: Opening settings from the watch-page gear **focuses** an existing `popup/index.html` window when present instead of stacking multiple fallback popups; handlers run **one at a time**.
- **Profiles / Auto-hide**: Turning **Auto-hide** off removes overlays — `stripMuteArtifactsEverywhere` walks shadow DOM before `runProfileVideoFilter` re-applies outlines.
- **Profile filter metadata**: Rows live in `chrome.storage.local` (`ytSum_pfMeta_v1::…`, ~12 min TTL, capped). **Clear Cache** wipes replica + persisted rows.
- **Settings (API tab, toolbar popup)**: **Update** loads the model list on demand only.
- **Toolbar settings popup**: Larger viewport (`popup/styles.css`); **Save** persists; profile keyword editors default taller rows (**8**) and rely on `#root` scroll (no textarea max-height scrollbar).
- **Watch page**: **Auto-hide** checkboxes bind to `profileFilterHideNonMatchingCompact`.
- **Settings popup**: Profiles default tab; Profiles → API → Prompt → Debug → Info.
- **Manifest**: `tabs` for `TEST_BENCH_GET_METADATA_SNAPSHOT` relay (**HURDLES §18**).
- **Classifier test bench (dev)**: **Sample JSON** or **Load from YouTube tab**; sample rows synthesize `classifierText` from title + short description like production cached rows.
- **Profiles**: Built-in **All** (id `default`).
- **Architecture (MV3)**: Offscreen `OPENROUTER_COMPLETE` / `PROXY_REQUEST` only; `getBasicInfo` stays in-tab (`profileFilterMetaCache.ts`).
- **Clear Cache (watch bar)**: Clears compact tile meta + tab `profileFilterMetaCache` (`CLEAR_WORK_CACHES` included in flow).
- **Profile filter triggers**: Loads + match on `yt-navigate-finish`, `selectedSummaryProfileId`, `summaryUserProfiles`, `profileFilterHideNonMatchingCompact`, **Clear Cache** / profile refresh, plus debounced DOM sidebar fingerprint drift.
- `classifierText`: URLs stripped from cached title/description strings (helps bench legibility).
- **Metadata hover cache**: offscreen `getBasicInfo` JSON cached **7 days**.
- **Settings popup**: Debug tab; pinned hover diagnostics are narrowed `basic_info` only (`narrowYoutubeBasicInfo`); `extension_profile_filter` when sidebar tile meta is meaningful (legacy `scores` may remain on older painted tiles until re-filtered).
- **Profiles (keywords)**: Multi-line textarea; storage unchanged.
- **On-page Log**: PRD tagging opt-in builds only.
- **Compact video outlines**: Broad tile discovery selector + `/watch` anchor climb; green/red disposition with keyword profiles.
- **Build**: `import.meta` shim for classic extension bundles (**content**, **background**, **offscreen**, **test-bench**).
