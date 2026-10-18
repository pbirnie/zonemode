# ZoneMode — Product Requirements & Event Flow

see **[docs/GLOSSARY.md](GLOSSARY.md)** of terms which the developer will use to keep prompts unambiguous 

Chrome extension that injects a summarize UI on YouTube watch pages, provides AI-powered video summaries, and supports profile-based keyword filtering of sidebar videos. **Engineering tradeoffs** (MV3, Cache API, InnerTube, bundling) are summarized in **[HURDLES.md](HURDLES.md)** alongside this PRD. **Rendered diagrams** (sequence + flowcharts, Mermaid): **docs/ARCHITECTURE.md** — visible on the GitHub repo without extra tools.

**Manifest**: no extra `host_permissions`. `permissions` still includes `tabs` so the classifier test-bench can relay `TEST_BENCH_GET_METADATA_SNAPSHOT` into `youtube.com` tabs (see **HURDLES §18**). 

`content_security_policy.extension_pages` uses default `script-src 'self'` (no `wasm-unsafe-eval` needed after ONNX removal). 

**Innertube** `getBasicInfo` slices for profile-filter metadata run in the **watch tab** via `youtubei.js` (`profileFilterMetaCache.ts`; see **HURDLES §9**).

**Dev — classifier test bench**: `test-bench/index.html` + `test-bench/index.js`. Rows come from bundled **sample JSON** or `TEST_BENCH_GET_METADATA_SNAPSHOT` (`tabs`). **Reclassify** calls shared `finalizeProfileVideoResult` (production `metadata_exact` path — no ONNX). 

Open `chrome-extension://…/test-bench/index.html` after **Load unpacked** → `dist/`. 

Spec: `docs/PRD-test-bench.md`. 

Released UI details: **ENHANCEMENTS**.

```
┌─────────────────────────────────────────────────────┐
│  Toolbar Popup (popup/Popup.tsx)                     │
│  └── SettingsPanel (tabbed: Profiles, API, Prompt, Debug, Info)         │
└────────────────────┬────────────────────────────────┘
                     │ chrome.storage.sync
                     │ chrome.runtime.sendMessage
┌────────────────────▼────────────────────────────────┐
│  Background Service Worker (background/index.ts)     │
│  - Orchestrator: GET_SETTINGS, OPEN_SETTINGS_UI,    │
│    OPENROUTER_COMPLETE, PROXY_REQUEST, OFFSCREEN_RPC,│
│    CONTENT_SCRIPT_LOADED (ack only)                  │
│  - Ensures chrome.offscreen document + Port RPC       │
└────────────────────┬────────────────────────────────┘
                     │ chrome.runtime.connect / Port
                     │ (yt-sum-offscreen) + postMessage { id, op }
┌────────────────────▼────────────────────────────────┐
│  Offscreen document (offscreen/offscreen.ts)         │
│  - OPENROUTER_COMPLETE, PROXY_REQUEST fetch          │
│  - CLEAR_WORK_CACHES (reserved no-op hook)           │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Content Script (content/index.ts)                   │
│  ├── SummaryButton.tsx   (watch-page UI)             │
│  ├── videoLinkTooltips.ts (hover diagnostics)        │
│  ├── profileFilterMetaCache.ts (L1 Map +             │
│  │   chrome.storage.local; tab Innertube getBasicInfo)│
│  └── videoProfileFilter.ts (DOM outlines +           │
│      finalizeProfileVideoResult scoring)               │
└─────────────────────────────────────────────────────┘
```



## Event → Action pseudo-code

### 1. Content script loads

```
ON content_script_injected:
    bind globalThis.fetch (youtubei.js unbound fetch → Illegal invocation in extension scripts; see HURDLES.md §8)

    call initVideoLinkMetadataTooltips()
    call initVideoProfileFilter()
    call scheduleInjectSummaryButton()   // async; ≤3 s wait for #above-the-fold + primary <video> loadeddata/canplay (then mount anyway if fold exists)

    sendMessage("CONTENT_SCRIPT_LOADED") → background   // ack / logging only

    listen window "yt-navigate-finish":
        log new URL
        call scheduleInjectSummaryButton()
```

### 2. Inject summary button

```
CONST INJECTION_READY_TIMEOUT_MS = 3000

FUNCTION scheduleInjectSummaryButton():   // cancel stale attempts via generation counter on SPA navigation
    IF path does not contain "/watch":
        return

    deadline = now + INJECTION_READY_TIMEOUT_MS

    LOOP until cancelled OR mounted OR deadline exhausted:
        IF path does not contain "/watch":
            return

        remaining = deadline - now
        IF remaining ≤ 0:
            IF #above-the-fold exists:
                mountSummaryButtonIntoFold()
            ELSE:
                retry scheduleInjectSummaryButton after 1 second   // legacy: fold sometimes appears late
            return

        IF #above-the-fold not in DOM:
            sleep min(100 ms, remaining); CONTINUE

        await waitForWatchPlayerPaintSignal(remaining):
            IF primary player <video> missing OR readyState ≥ HAVE_CURRENT_DATA:
                race: two animation frames OR remaining ms
            ELSE:
                race: loadeddata OR canplay OR remaining ms
            then two animation frames when events win first

        mountSummaryButtonIntoFold():   // idempotent if React root already attached
            ensure #zonemode-extension-container exists and is positioned:
                prefer **`ytd-watch-metadata` → insert `#zonemode-extension-container` immediately after** (avoids cinematic player/grid overlap when the fold’s former first-child sat under opaque layers)
                else: insert as first child of #above-the-fold (legacy / missing metadata renderer)
            IF container not yet has React root:
                createRoot(container)
                render <SummaryButton />
```

### 3. SummaryButton component

```
ON mount:
    load from chrome.storage.sync:
        apiKey, selectedProvider, selectedModel,
        userProfiles, selectedProfileId, profileFilterHideNonMatchingCompact
    update local state

ON chrome.storage.onChanged (sync):
    update apiKey, provider, model, profiles, selectedProfileId, profileFilterHideNonMatchingCompact (Profiles **Auto-hide** + summarize bar/header checkboxes)
    IF selected profile id no longer exists:
        reset to "default"

ON document "yt-navigate-finish":
    clear summary text, meta, error, loading state

ON click "Summarize" button:
    validate provider, apiKey, model
    IF invalid: show error, return

    set loading = true
    subtitles = extractSubtitles(videoUrl)
    IF no subtitles: show transcript error, return

    title = watch-page title (`og:title` / document.title) for optional {{TITLE}} placeholders
    result = generateSummary(subtitles, profileKeywords, title)
    display summary text + metadata (model, tokens, time, cost)
    keep subtitles + title for Ask Questions
    set loading = false

ON submit Ask Questions:
    system = chat template with {{SUMMARY}} = displayed summary, {{TITLE}} = title from Summarize, {{TRANSCRIPT}} = subtitles from that Summarize
    askQuestion(question, history)

ON change profile <select>:
    update local selectedProfileId
    chrome.storage.sync.set({ selectedProfileId })
    requestProfileFilterRefresh(immediate = true)

ON click "Clear Cache" button:
    set button to clearing (grey, disabled)
    clearProfileFilterMetaCache()   // L1 Map + chrome.storage.local keys ytSum_pfMeta_v1::*
    clearCompactVideoProfileMeta()
    await sendMessage flow that posts **CLEAR_WORK_CACHES** to offscreen (no-op retained for compatibility)
    requestProfileFilterRefresh(immediate = true)
    restore button to red

    NOTE: offscreen authoritative caches are cleared via **`CLEAR_WORK_CACHES`** op (`offscreen/offscreen.ts`).

ON change "Auto-hide" checkbox (summarize bar or summary header, next to gear):
    set **`profileFilterHideNonMatchingCompact`** in chrome.storage.sync (same key as Profiles → **Auto-hide**)
    requestProfileFilterRefresh(immediate = true)   // writer context may not get storage.onChanged for own writes

ON click "Settings" gear:
    chrome.runtime.sendMessage({ type: "OPEN_SETTINGS_UI" })

ON click "×" close (summary visible):
    clear summary text and metadata
```

### 4. Video link metadata tooltips

```
FUNCTION initVideoLinkMetadataTooltips():
    IF not youtube.com: return

    load metadataHoverEnabled from chrome.storage.sync
    default = false

    ON chrome.storage.onChanged (sync, metadataHoverEnabled key):
        update metadataHoverEnabled flag
        IF now disabled:
            closeDiagnosticPanel()

    ON document "mouseover" (capture phase):
        IF metadataHoverEnabled is false: return
        IF panel already pinned: return

        anchor = event.target.closest("a[href]")
        IF not anchor or inside extension container: return

        videoId = extractVideoIdFromHref(anchor.href)
        IF no videoId: return

        set activeAnchor, activeVideoId
        after ~300ms hover delay:
                showMetadataForAnchor(anchor, videoId)

    ON document "mouseout" (capture phase):
        IF panel pinned: return
        IF leaving the active anchor:
            after 200ms:
                hideTooltip()

    ON document "keydown" (capture, Escape):
        IF panel pinned and visible:
            closeDiagnosticPanel()

    ON window/document "scroll", "wheel":
        requestAnimationFrame → reposition tooltip

    ON document "yt-navigate-finish":
        unpin, clear timers, hide tooltip

FUNCTION showMetadataForAnchor(anchor, videoId):
    IF cached and fresh (< 7 days):
            merge extension_profile_filter from live DOM when non-trivial (legacy scores / match / kept|excluded)
        render JSON panel from merged text
    ELSE:
        ytInfoPromise = sharedInnertube.getBasicInfo(videoId)   // start early; overlaps chrome.storage when L1 is cold

        syncSnap = getCachedFilterMetadataSnapshot(videoId)     // L1 tab replica only (fast path, no await)
        IF syncSnap hit:
            render interim JSON (`profile_filter_worker` cache slice from profile filter worker + merged DOM extension when meaningful; no Loading row)
        ELSE:
            show "Loading..." panel
            await getCachedFilterMetadataSnapshotAsync(videoId) // may hydrate L1 from chrome.storage.local
            IF async hit:
                same interim JSON as sync hit branch

        WHEN getBasicInfo resolves (same tab):
            youtubeiJson = serializeYoutubeiDiagnostics(...)  // narrowed **`basic_info`** only (**`narrowYoutubeBasicInfo`**: **`id`**, **`title`**, **`keywords`**, **`short_description`**, **`view_count`**, **`author`**, **`is_family_safe`**, **`category`**, **`tags`**)
            cache Map entry jsonText
            merge extension_profile_filter from DOM when meaningful; replace panel with full diagnostics

        WHEN getBasicInfo errors:
            show error JSON (+ merged extension_profile_filter when present)
```

### 5. Video profile filter & compact video outlines

```
FUNCTION initVideoProfileFilter():
    IF not youtube.com: return

    initCompactVideoOutlines()
    scheduleProfileFilterRun()       // debounced 500ms (initial page)

    ON chrome.storage.onChanged (sync, profile filter keys: selectedSummaryProfileId,
        summaryUserProfiles,
        profileFilterHideNonMatchingCompact):
        scheduleProfileFilterRun()
        // Other popup-only edits (e.g. provider) still do not schedule here unless listed above.

    ON document "yt-navigate-finish":
        applyDefaultOutlineToNewCompactRenderers()
        scheduleProfileFilterRun()

    NOTE: clearProfileFilterMetaCache() (L1 + chrome.storage.local profile-filter rows) and offscreen **CLEAR_WORK_CACHES** are
        invoked from the watch-page **Clear Cache** button (SummaryButton.tsx), plus compact DOM meta clear.

FUNCTION initCompactVideoOutlines():
    applyDefaultOutlineToNewCompactRenderers()
    requestAnimationFrame → applyDefaultOutlineToNewCompactRenderers()

    walkDocumentAndAttachShadowObservers()
        // MutationObserver on each discovered ShadowRoot — subtree mutations inside
        // shadow DOM do not reach a document-level observer; needed when related
        // videos load as you scroll.

    create MutationObserver(document.documentElement, childList + subtree):
        ON element additions:
            discoverShadowHostsInSubtree(addedElement)   // wire observers for new shadow roots
            scheduleCompactOutlineFlush()    // debounced 150ms → grey outlines on new tiles
            scheduleDomSidebarProfileFilterStaleCheck()   // debounced ~1.5s → full filter IF compact renderer / video-id set changed (YT often mounts related videos after yt-navigate-finish)

    FOR each ShadowRoot already attached above:
        same MutationObserver callback as document (element additions → grey-outline flush only)

FUNCTION applyDefaultOutlineToNewCompactRenderers():
    FOR each el in collectCompactVideoRenderers():
        IF el lacks .yt-sum-compact-thumb-outline:
            add class + data-yt-sum-compact-outline="default" (grey)

FUNCTION collectCompactVideoRenderers() → HTMLElement[]:
    found = empty Set

    // Strategy A — selector pass (light + every open shadow root)
    selectors = ytd-compact-*-renderer, ytd-rich-item-renderer,
                ytd-rich-grid-media, ytd-video-renderer,
                ytd-grid-video-renderer, ytd-playlist-panel-video-renderer,
                ytd-reel-item-renderer, yt-lockup-view-model
    add document.querySelectorAll(selectors) to found
    FOR each open shadow root in DFS:
        add shadowRoot.querySelectorAll(selectors) to found

    // Strategy B — anchor-up climb (catches tile types not in selectors)
    FOR each <a href*="/watch"> in light + shadow:
        IF !validVideoId(href): continue
        IF inside #zonemode-extension-container: continue
        cur = anchor; for up to 80 parent / shadow-host steps:
            IF cur.tagName ∈ TILE_TAG_LIST: add cur to found, break
            IF cur.tagName ∈ {YTD-WATCH-FLEXY, YTD-PLAYER, YTD-APP, BODY, HTML}: stop
            cur = parentElement OR (root is ShadowRoot ? root.host : break)

    log signature change with selectorHits / anchorClimbHits / climbMisses

FUNCTION runProfileVideoFilter():
    bump filterGeneration (cancels stale async work)
    clearFilterVisuals():
        strip mask nodes (`yt-sum-profile-filter-tile-mask` + legacy thumb mask) + `.yt-sum-profile-filter-tile-mask-host` (+ legacy host) markers + `.yt-sum-profile-filter-hide-non-match` (document + shadow walk)
        FOR each compact renderer from collectCompactVideoRenderers():
            set data-yt-sum-compact-outline="default" (grey) + yt-sum-compact-thumb-outline class

    state = load selectedProfileId, profiles,
          profileFilterHideNonMatchingCompact (default false) from chrome.storage.sync
    profileKws = keywords from selected profile (trimmed, non-empty)
    IF no profileKws (built-in "All" profile / id default, or empty):
        return                               // all tiles stay grey (default)

    log profile filter keyword labels (active profile keywords)

    renderers = collectCompactVideoRenderers()
    IF renderers.length > 80:
        await yieldToMain()                    // paint / input between heavy DOM walks
        IF generation stale: return

    rendererToVideoId = map each renderer → findFirstWatchAnchor → videoId

    uniqueIds = dedupe video ids from rendererToVideoId

    resp = await computeProfileFilterMetadata({
        generation,
        videoIds: missing uncached ids only (see code) })
        // profileFilterMetaCache.ts in tab: L1 Map + chrome.storage.local; Innertube getBasicInfo
    IF resp.error OR resp.generation ≠ filterGeneration:
        return (tiles unchanged except clearFilterVisuals already ran)

    merge resp.metadataByVideoId into metaById built from L1 cache hits

    FOR each unique videoId:
        results[videoId] = finalizeProfileVideoResult(metaById[videoId], videoId, profileKws)

    FOR each (renderer, videoId):
        row = results[videoId] (or treat missing as kept_no_metadata)
        set data-yt-sum-compact-meta on renderer to JSON { videoId, disposition, matchedKeyword?, matchVia?, scores? }
            // matchVia newest runs: "metadata_exact"; legacy persisted tiles may include "zero_shot" / "substring"
            // scores: legacy only (semantic classifier removed); usually omitted on fresh runs
        IF row.disposition is no_keyword_match:
            set data-yt-sum-compact-outline="nomatch" (red)
            IF profileFilterHideNonMatchingCompact: inject black full-card overlay (`.yt-sum-profile-filter-tile-mask` as direct child of the compact renderer); clicks blocked on the tile
        ELSE:
            remove Auto-hide artifacts from tile subtree (marker class + injected `.yt-sum-profile-filter-tile-mask` nodes + `.yt-sum-profile-filter-tile-mask-host`)
            set data-yt-sum-compact-outline="match" (green)

    log excluded / kept summary from rows

computeProfileFilterMetadata (profileFilterMetaCache.ts — runs in the **watch tab** content script):

    innertube = getSharedInnertube() (singleton in tab)
    FOR each batch of 4 unique videoIds from payload:
        ensureHaystackCached(videoId): use L1 Map if fresh; else load fresh row from chrome.storage.local if TTL ok (legacy rows marked title-only are rejected — refetch);
            else getBasicInfo(videoId); narrow **`basic_info`** (**`narrowYoutubeBasicInfo`**); build haystackLower, **`videoKeywordsLower`** (Innertube keywords + **`author`** term only), metadataTermsLower, classifierText, previewTitle (`author`, `viewCount`, etc. — see **`ProfileFilterMetadataEntry`**)
        persist row to L1 Map and chrome.storage.local (JSON per videoId; evict stale/excess keys — see profileFilterMetaStorage.ts)

    return metadataByVideoId to caller
        // InnerTube from the MV3 service worker often returned HTTP 403; tab uses the same extension client as the former offscreen-only path — verify against platform changes in HURDLES #9.

### 6. Settings panel (toolbar popup vs. non-tabbed embed)

**Tabbed toolbar popup (`SettingsPanel.tsx` `tabbed={true}`, `popup/Popup.tsx`):** edits stay in React state until the user presses **Save**, which persists to **`chrome.storage.sync`** and then **`window.close()`**. **Close** (`window.close()`) validates API/model prerequisites but **does not** write **`chrome.storage.sync`** and **drops** unpersisted drafts (including unstaged keyword textarea text). **`fetchModels`** fills the model picker from memory only until **Save**. The API tab does **not** show OpenRouter billing / quota. **`#root`** scrolls the tab body while **Save**, **Close**, the sync hint, and **tabs** stay in a **`position: sticky`** strip at the top; profile keyword fields use **`#root`** scroll only (no nested textarea scrollbar cap).

**Non-tabbed embed (if ever used):** persists each change to **`chrome.storage.sync`** immediately (legacy path).

```

ON mount (all modes):
    load all settings from chrome.storage.sync → local React state
    IF tabbed popup:
        do **not** auto-fetch model lists — API tab **Update** only
        reset “unsaved” / deferred flags (dirty bit off after load completes)
    ELSE:
        IF provider supports model list and has key (or local): fetchModels(provider, apiKey)

ON click Update (API tab, tabbed only):
    mark session dirty (enables Save)
    IF supports model list and has key (or local): fetchModels(provider, apiKey)   // UI only until Save

ON click Save (tabbed header, next to Close):
    run same API/model validation as Close (“before saving…” copy)
    merge keyword drafts into profile rows (**mergeKeywordDraftsIntoProfiles**) + **normalizeUserProfiles**
    chrome.storage.sync.get(selectedSummaryProfileId) → IF orphaned after profile edits, coerce to `"default"`
    chrome.storage.sync.set({ apiKey, selectedProvider, selectedModel, customBaseUrl, customModel,
        prompts (unless pending “reset prompts to defaults”), maxTokens?,
        summaryUserProfiles, profile filter + debug booleans, corrected selectedSummaryProfileId, … })
    chrome.storage.sync.remove([…]) for: max_tokens when None; legacy profileFilterZeroShot* keys on Save; summary+chat prompts when Reset was chosen
    on success: realign textarea drafts / clear dirty bit / notify optional **onProviderChange** / **onModelChange** / **onClose** → `window.close()`

ON click Close:
    IF non-tabbed: **flushProfileKeywordDrafts()** then close (immediate profile keyword sync retained)
    IF tabbed: validate API/model; discard all in-memory edits; close (no chrome writes)

TABBED POPUP ONLY — edits update React; **omit** chrome until Save:

ON change AI Provider / API Key / Base URL / model / prompts / max tokens / profiles / Auto-hide / Debug toggles:
    update React state (+ mark dirty); **omit** chrome.storage.sync

Legacy non-tabbed — ON each change …:
    chrome.storage.sync.set/remove as previously implemented per field.

ON blur keywords profile editor (all modes): parse draft → keywords on profile row (still **no** chrome in tabbed until Save).

ON click "Reset prompts to defaults":
    IF tabbed: set local prompts to defaults + flag removal of prompt keys **on Save**; mark dirty.
    ELSE: chrome.storage.sync.remove([summaryPrompt, chatPrompt]); apply defaults locally.

ON click "Add/Rename/Remove profile":
    IF tabbed: mutate local `summaryUserProfiles` (+ drafts) only; orphan **selectedSummaryProfileId** repaired on Save.
    ELSE: chrome.storage.sync.set/remove selected id as today.

Debug → "Open classifier test bench":
    chrome.tabs.create(test-bench/index.html); no automatic persistence side effect.

```

### 7. Background service worker

```

ON chrome.runtime.onInstalled:
    log install reason and version
    IF reason == "install":
        chrome.storage.sync.set({
            summaryUserProfiles: [
                { id: "aifocus", name: "AiFocus", keywords: [
                    "AI", "LLM", "Artificial Intelligence", "Anthropic", "Claude code",
                    "Cursor", "Fireship", "Dwarkesh Patel", "Matt Pocock"
                ] },
                { id: "news", name: "News", keywords: ["Sky News", "Ed Conway"] },
                { id: "finance", name: "Finance", keywords: [
                    "finance", "Patrick Boyle", "Sasha Yanshin"
                ] }
            ],
            selectedSummaryProfileId: "aifocus",
            selectedProvider: OpenRouter (baseUrl https://openrouter.ai/api/v1),
            selectedModel: "xiaomi/mimo-v2.5"
        })
        // updates do not rewrite these keys (keeps profiles the user already saved)

ON chrome.runtime.onMessage:
    MATCH message.type:

"GET_SETTINGS":
    result = chrome.storage.sync.get(apiKey, selectedProvider)
    sendResponse(result)

"OPEN_SETTINGS_UI":
    enqueue serialized handler (avoid overlapping opens creating duplicate fallback windows)
    IF extension window already open with popup/index.html (tracked chrome.windows id or getAll scan):
        chrome.windows.update(thatWindowId, focused)
        sendResponse({ ok: true, method: "focus_existing_window" })
    ELSE TRY chrome.action.openPopup({ windowId })
        sendResponse({ ok: true, method: "openPopup" })
    CATCH / openPopup unavailable:
        IF scan finds existing popup/index.html window again: focus it + sendResponse as above
        ELSE chrome.windows.create(popup URL, type: "popup"); remember window id; chrome.windows.onRemoved clears id when closed
        sendResponse({ ok: true, method: "windows.create" })

"OPENROUTER_COMPLETE":
    result = await forwardToOffscreen("OPENROUTER_COMPLETE", { messages, model, apiKey, maxTokens? })  // offscreen/openRouterComplete.ts
    sendResponse({ ok, text: result.text, costUsd: result.costUsd })

"CONTENT_SCRIPT_LOADED":
    log tab id (no heavy work in SW)

"PROXY_REQUEST":
    response = await forwardToOffscreen("PROXY_REQUEST", { url, options })   // offscreen fetch + JSON parse
    sendResponse(response)

"OFFSCREEN_RPC":
    PRIMARY (watch `callOffscreen` via `chrome.runtime.connect` named `yt-sum-content-offscreen-rpc`):
        ON Port message { seq, op, payload }:
            result = await forwardToOffscreen(op, payload)
            port.postMessage({ seq, ok: true, result })   // Port survives slower forwardToOffscreen work (summaries proxy, etc.)
    LEGACY sendMessage `{ type: OFFSCREEN_RPC, op, payload }`:
        result = await forwardToOffscreen(op, payload)
        sendResponse({ ok: true, result })

```
default:
    return false (no async response)
```

```

### 8. Observability (Log panel)

The extension uses **`createLogger`** for normal logs. **PRD-tagged** lines (`prd: true`, `prdSection`, `event`) are **disabled** in shipped builds (`PRD_LOGGING_ENABLED = false` in `prdEventLog.ts`); flip that flag locally when tracing flows against this document.

## CSS outline states

| State | Class / Attribute | Visual |
|-------|-------------------|--------|
| Compact renderer discovered (no filter / pending) | `.yt-sum-compact-thumb-outline` + `data-yt-sum-compact-outline="default"` | 2px grey outline |
| Profile filter: keyword match (or kept with metadata) | `data-yt-sum-compact-outline="match"` | 2px green outline |
| Profile filter: no keyword match | `data-yt-sum-compact-outline="nomatch"`; optional **Auto-hide** adds `.yt-sum-profile-filter-hide-non-match` marker + **`yt-sum-profile-filter-tile-mask`** over the entire compact sidebar card (Profiles tab or watch bar) | 2px red outline; **Auto-hide** adds opaque black full-card cover + `cursor: not-allowed` instead of collapsing the tile |
| Compact tile profile diagnostics | `[data-yt-sum-compact-meta]` | JSON string: `videoId`, `disposition`, optional `matchedKeyword` / `matchVia`, optional **`scores`** (legacy semantic classifier only — usually absent after fresh **`metadata_exact`** runs) |
| Filter run start / All (built-in) profile | `data-yt-sum-compact-meta` cleared; all tiles `data-yt-sum-compact-outline="default"` | Grey outlines |

## Storage keys

| Key | Type | Default | Used by |
|-----|------|---------|---------|
| `apiKey` | string | `""` | SettingsPanel, SummaryButton, Background |
| `selectedProvider` | AIProvider object | **OpenRouter** when unset; install writes that provider | SettingsPanel, SummaryButton, Background |
| `selectedModel` | string | **`xiaomi/mimo-v2.5`** when unset (OpenRouter’s model); install writes that id | SettingsPanel, SummaryButton |
| `customBaseUrl` | string | `""` | SettingsPanel |
| `customModel` | string | `""` | SettingsPanel |
| `summaryPromptTemplate` | string | built-in default: concise markdown summary of `{{TRANSCRIPT}}` with a **Key Points** section, formatting rules, and no intro phrase; no `{{TITLE}}` in this template | SettingsPanel, AI utils |
| `chatSystemPromptTemplate` | string | built-in default: friendly assistant with `{{SUMMARY}}`, `video title: {{TITLE}}`, and full `{{TRANSCRIPT}}` when the summary is not enough; reply starts with a terse one-liner of the summary | SettingsPanel, AI utils |
| `maxTokens` | number \| absent | absent (None) | SettingsPanel, AI utils |
| `summaryUserProfiles` | SummaryUserProfile[] | on **install**: **AiFocus** (`aifocus`), **News** (`news`: Sky News, Ed Conway), and **Finance** (`finance`: finance, Patrick Boyle, Sasha Yanshin); if the key is absent, readers treat it as `[]` | SettingsPanel, SummaryButton, ProfileFilter |
| `selectedSummaryProfileId` | string | on **install**: `"aifocus"`; if unset, `"default"` (**All**) | SummaryButton, ProfileFilter |
| `metadataHoverEnabled` | boolean | `false` | SettingsPanel (Debug tab), videoLinkTooltips |
| `profileFilterHideNonMatchingCompact` | boolean | `false` | SettingsPanel (Profiles tab Auto-hide), SummaryButton watch **Auto-hide** checkboxes, videoProfileFilter |

**Legacy keys removed on toolbar Save:** `profileFilterZeroShotEnabled`, `profileFilterZeroShotThresholdPct`, `profileFilterClassifierTitleOnly`.

**`chrome.storage.local` (not sync):** dynamic keys **`ytSum_pfMeta_v1::<videoId>`** — JSON string of profile-filter metadata row (12 min freshness, ~200 videos max; see **`profileFilterMetaStorage.ts`**). Cleared by **Clear Cache**. Not listed in the sync table above.

```

