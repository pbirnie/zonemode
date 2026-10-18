## Agreed terms (Glossary)

Short definitions used throughout this PRD and **[ARCHITECTURE.md](docs/ARCHITECTURE.md)**. Extension / Chrome terms follow **MV3** (Manifest V3).

| Term                   | Meaning                                                                                                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MV3**                | **Manifest V3** — Chrome’s current extension platform. This project sets `"manifest_version": 3` in `src/static/manifest/manifest.json`. The background is a short-lived **service worker** (not a persistent background page). Chrome limits what that worker may do, so this extension keeps it as an orchestrator and runs `fetch` and other heavy clients in an **offscreen document**. |
| **SPA**                | **Single-Page Application** — one loaded document; the client swaps content and updates the URL without full round-trip HTML page loads. YouTube’s watch experience behaves this way.                                                                                                                 |
| **SW**                 | **Service Worker** — the extension’s **background** script (`ServiceWorkerGlobalScope` in Chrome). In this project it is an **orchestrator only** (message routing, offscreen lifecycle); it does **not** run ORT, OpenRouter, or youtubei.js (see **HURDLES.md**).                                   |
| **DOM**                | **Document Object Model** — the browser’s tree of elements and text nodes for the page. Content scripts read and mutate it (e.g. outlines, injected UI).                                                                                                                                              |
| **Shadow DOM**         | An **encapsulated** subtree attached to an element (`element.shadowRoot`). Nodes inside may **not** bubble events or mutations to the outer document; observers on `document` alone can miss sidebar tiles that live under shadow roots.                                                              |
| **Offscreen document** | `chrome.offscreen` page running `OPENROUTER_COMPLETE` and `PROXY_REQUEST` `fetch`; MV3 forbids `fetch` **/ heavyweight clients in the service worker.**                                                                                                                                               |
| `yt-navigate-finish`   | **YouTube-defined** `CustomEvent` fired on `document` when the client finishes an in-app navigation (e.g. moving between watch URLs in the SPA). **Not a web standard** — name and behavior can change with YouTube updates. This extension listens for it to reset UI and re-run the profile filter. |
| **Content script**     | JavaScript injected into `youtube.com` pages (`content/index.ts`), sharing the page DOM with YouTube but isolated JS scope unless bridged via `chrome.`* APIs.                                                                                                                                        |

**Note:** Other `yt-`* custom events may exist in the page at any time; they are **internal to YouTube**, **unstable**, and **not** part of this PRD’s contract unless we explicitly rely on them in code.

# YouTube page components

```
CompactVideos - the small videos components in the side pannel 
SummarizeButton - the button we inject into the page
VideoMetadataTooltips - the metadata extracted about each video
ClassifierTestBench - the diagnostic page used to help verify classification logic
```

