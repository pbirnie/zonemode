# Architecture diagrams

These diagrams summarize **[PRD.md](../PRD.md)**. **GitHub renders them automatically** on the repo page (Mermaid in Markdown).

For local preview, use a Mermaid-capable editor, or paste into [mermaid.live](https://mermaid.live).

---

## Component overview

```mermaid
flowchart TB
  subgraph Browser["Browser — youtube.com"]
    YT[YouTube DOM / SPA]
    CS["Content script\n(content/index.ts)"]
    YT <-->|DOM e.g. yt-navigate-finish| CS
  end

  subgraph ExtensionUI["Extension UI"]
    POP["Popup\n(SettingsPanel)"]
  end

  subgraph SW["MV3 service worker\n(background/index.ts)"]
    RTR[onMessage orchestrator]
  end

  subgraph OS["Offscreen document\n(offscreen/offscreen.ts)"]
    HEAVY[OpenRouter +\nproxy fetch]
  end

  STOR[("chrome.storage.sync")]

  POP <-->|read; batch write on Save → close| STOR
  CS <-->|read / onChanged| STOR

  CS <-->|connect OFFSCREEN_RPC; sendMessage OPENROUTER_COMPLETE / PROXY_REQUEST| RTR
  POP <-->|sendMessage| RTR

  RTR <-->|Port yt-sum-offscreen| OS

  subgraph TabMeta["Tab — profile-filter metadata"]
    META[profileFilterMetaCache.ts\nyoutubei.js getBasicInfo]
  end
  CS <-->|same tab| META
```

---

## Data stores (logical ER)

Persistent settings live in **`chrome.storage.sync`**. **Profile-filter metadata** uses an in-tab `Map` (**L1**) plus **`chrome.storage.local`** (**L2**). **Hover** diagnostics cache is an in-memory `Map`. **Compact-tile** disposition is reflected on **DOM** attributes.

```mermaid
erDiagram
  CHROME_STORAGE_SYNC {
    string storage_area "chrome.storage.sync"
    string apiKey
    json selectedProvider
    string selectedModel
    string customBaseUrl
    string customModel
    string summaryPromptTemplate
    string chatSystemPromptTemplate
    int maxTokens "optional"
    json summaryUserProfiles "SummaryUserProfile array"
    string selectedSummaryProfileId "e.g. default"
    boolean metadataHoverEnabled
    boolean profileFilterHideNonMatchingCompact
  }

  USER_PROFILE {
    string id PK
    string name
    json keywords
  }

  PROFILE_FILTER_META_CACHE {
    string videoId PK
    string previewTitle
    string classifierText
    string haystackLower
    int fetchedAt
  }

  CHROME_STORAGE_LOCAL {
    string storage_area "chrome.storage.local"
    string ytSum_pfMeta_v1 "keys per videoId JSON"
  }

  HOVER_DIAGNOSTIC_CACHE {
    string videoId PK
    string jsonText
    int fetchedAt
  }

  DOM_TILE_STATE {
    string compactRenderer "ytd-* renderer element"
    string data_yt_sum_compact_outline
    string data_yt_sum_compact_meta
  }

  CHROME_STORAGE_SYNC ||--|{ USER_PROFILE : "summaryUserProfiles"
  CHROME_STORAGE_SYNC }o--o| USER_PROFILE : "selectedSummaryProfileId"
  CHROME_STORAGE_LOCAL ||--o{ PROFILE_FILTER_META_CACHE : "persist L1 rows"
  PROFILE_FILTER_META_CACHE ||--o{ HOVER_DIAGNOSTIC_CACHE : "warm hover slice"
  PROFILE_FILTER_META_CACHE ||--o{ DOM_TILE_STATE : "filter pass"
```

### Cache and retention (authoritative constants)

| Data store | Where it lives | How long data is kept | Example payload (one key / entry) |
| --- | --- | --- | --- |
| **Extension settings** | `chrome.storage.sync` | **Persistent** until changed. First **install** seeds **`summaryUserProfiles`** with **AiFocus** (`aifocus`), **News** (`news`), and **Finance** (`finance`), sets **`selectedSummaryProfileId`** to **`aifocus`**, and sets **`selectedProvider`** to **OpenRouter** with **`selectedModel`** **`xiaomi/mimo-v2.5`**. When those provider keys are unset, the UI uses the same defaults. Toolbar **Save** removes legacy **`profileFilterZeroShot*`** keys. | **Key** `selectedSummaryProfileId` → `"aifocus"` after install, or `"default"` when unset. |
| **Profile-filter metadata** | **L1:** in-tab `Map` in **`profileFilterMetaCache.ts`**. **L2:** **`chrome.storage.local`** `ytSum_pfMeta_v1::<videoId>`. | **12 minutes** per row (**`PROFILE_FILTER_META_TTL_MS`**); **~200** videos max locally. Cleared by **Clear Cache**. | JSON row with **`videoKeywordsLower`**, **`classifierText`**, etc. (**`ProfileFilterMetaHaystackPersisted`**). |
| **Metadata hover JSON** | **`videoLinkTooltips.ts`** Map | **7 days** (**`CACHE_TTL_MS`**). | `videoId` → `{ fetchedAt, jsonText }`. |
| **Transcript cache** | `youtube-transcript-plus` | **30 minutes** (**`cacheTTL`** in subtitles path). | Opaque library entry. |
| **Compact tile UI state** | DOM **`data-yt-sum-compact-*`** | **Ephemeral** per filter pass. | **`data-yt-sum-compact-meta`** may include legacy **`scores`** until tiles are re-painted after semantic classifier removal. |

**Manual reset:** **Clear Cache** clears L1 **`profileFilterMetaCache`**, all **`ytSum_pfMeta_v1::`** keys, compact tile **`data-yt-sum-compact-meta`**, and posts **`CLEAR_WORK_CACHES`** to offscreen (currently a reserved no-op).

---

## Sequence — messages and storage

```mermaid
sequenceDiagram
  autonumber
  participant CS as Content script
  participant SW as Service worker
  participant OS as Offscreen document
  participant Pop as Popup
  participant Sync as chrome.storage.sync

  CS->>SW: sendMessage CONTENT_SCRIPT_LOADED
  SW->>SW: log only

  CS->>Sync: storage.get

  Pop->>Sync: storage.set (e.g. selectedSummaryProfileId)
  Sync->>CS: onChanged
  CS->>CS: scheduleProfileFilterRun

  Note over CS: Profile-filter metadata: getBasicInfo in tab (computeProfileFilterMetadata)
  CS->>CS: finalizeProfileVideoResult (metadata_exact) + DOM outlines

  Pop->>SW: sendMessage OPEN_SETTINGS_UI

  CS->>SW: sendMessage OPENROUTER_COMPLETE
  SW->>OS: Port OPENROUTER_COMPLETE
  OS-->>SW: completion payload
  SW-->>CS: completion payload

  CS->>SW: sendMessage PROXY_REQUEST (when used by AI utils)

  Pop->>SW: sendMessage GET_SETTINGS
```

---

## Event flow (condensed pseudo-code)

```mermaid
flowchart LR
  A([content_script_injected]) --> B[bind fetch]
  B --> C[init tooltips + profile filter + schedule summarize UI ≤3s]
  C --> D[sendMessage CONTENT_SCRIPT_LOADED]

  H([yt-navigate-finish]) --> L

  I([Summarize]) --> J[subtitles → summary]
  J --> K[OPENROUTER_COMPLETE → SW → offscreen]

  L([runProfileVideoFilter]) --> M[storage: profile keywords + toggles]
  L --> N[computeProfileFilterMetadata — tab Innertube]
  L --> P[outlines + finalizeProfileVideoResult]
```
