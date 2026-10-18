/**
 * Highlights shown in the extension popup. Keep aligned with ENHANCEMENTS.md
 * (same bullets, plain text — no markdown links).
 */
export interface PopupChangelogSection {
  title: string;
  items: string[];
}

/** Newest sections first. */
export const POPUP_CHANGELOG: PopupChangelogSection[] = [
  {
    title: "Unreleased",
    items: [
      "Settings popup: one page scrollbar plus the keyword-box scrollbar. The extra window scrollbar is gone.",
      "Toolbar icon is the ZoneMode mark (16, 32, 48, and 128).",
      "Default chat prompt includes the summary, video title, and full transcript. Replies should open with a terse one-liner of the summary, then a longer answer. A saved chat prompt stays until you change it or reset prompts.",
      "API defaults to OpenRouter and model xiaomi/mimo-v2.5 when nothing is saved. Built-in summary prompt is a concise markdown Key Points summary of the transcript (no title placeholder). Saved prompts and providers stay until you change them or reset prompts.",
      "New installs start with AiFocus selected (keywords: AI, LLM, Artificial Intelligence, Anthropic, Claude code, Cursor, Fireship, Dwarkesh Patel, Matt Pocock), plus News (Sky News, Ed Conway) and Finance (finance, Patrick Boyle, Sasha Yanshin). Built-in All stays available. Updates do not replace saved profiles.",
      "Renamed to ZoneMode (toolbar and popup title). Formerly youtube-summarizer-oss / YouTube Summary.",
      "Watch page: summarize bar mounts below ytd-watch-metadata when present so it stays visible (was easy to hide under the player overlap). Container uses z-index: 2 vs stray overlays.",
      "Settings popup: Save writes to sync then closes the window; Close still exits without saving.",
      "Profiles / watch bar: Auto-mute renamed to Auto-hide (same black mask on no-match sidebar tiles).",
      "Metadata hover: if profile-filter meta is in the tab cache (L1), shows cache-only profile_filter_worker JSON immediately (no Loading row) while getBasicInfo runs.",
      "Metadata hover: ~300ms dwell on a link before the diagnostic panel (fewer accidental opens).",
      "Toolbar settings: sticky Save, Close, sync hint + tabs; profiles scroll in popup root only (no textarea max-height scrollbar).",
      "Prompt templates: summary uses {{TRANSCRIPT}}. Chat uses {{SUMMARY}}, {{TITLE}}, and {{TRANSCRIPT}}.",
      "Removed MobileBERT / zero-shot filter: sidebar match is metadata_exact tokens only (Innertube basic_info.keywords plus channel term). Toolbar Save clears legacy sync keys profileFilterZeroShotEnabled / profileFilterZeroShotThresholdPct. No ONNX/Transformers; dropped Hugging Face host_permissions and wasm-unsafe-eval CSP.",
      "Classifier test bench: 7 columns; Reclassify uses finalizeProfileVideoResult only (no offscreen ONNX). Removed wink-nlp Entities/Nouns.",
      "Settings Debug: removed zero-shot + threshold toggles and title-only classifier-text sync key (profileFilterClassifierTitleOnly cleared on Save).",
      "Offscreen stays for OpenRouter + proxy fetch only; youtubei getBasicInfo profile rows stay in the tab (profileFilterMetaCache).",
      "Clear Cache still clears replica + persisted profile-meta keys; CLEAR_WORK_CACHES sent to offscreen as a no-op hook.",
      "Profile filter reruns debounced after sidebar SPA growth / video-id set changes (HURDLES 22).",
      "Manifest tabs permission unchanged for bench snapshot messaging.",
      "Popup changelog entries below still describe earlier iterations; hover cache 7-day and multi-line keywords remain.",
    ],
  },
  {
    title: "1.0.8",
    items: [
      "Profiles tab: named profiles with comma keywords; built-in All has none. Summarize bar Profile dropdown; keywords steer the summary prompt.",
      "Non-default profile with keywords: red outline on tiles that do not match metadata (case-insensitive exact term per keyword/tag chunk); youtubei.js. Re-runs on load, navigate, storage, summarize bar—not on every DOM change.",
      "Hover watch/Shorts links: pinned diagnostic JSON panel with Close/Escape to dismiss so you can copy; ignores further hovers until closed.",
      "OpenRouter: with API key set, settings show account limits (credits, usage, free tier, reset when available).",
      "Max output tokens default None (omit max_tokens / maxOutputTokens); set a number to cap length.",
      "Better messages when a video has no usable transcript (tips + Show transcript retry).",
    ],
  },
  {
    title: "1.0.7",
    items: [
      "Video Summary header: model, ~input tokens sent, response time; default prompt drops TLDR.",
      "Settings: model field above max tokens; empty model until chosen; Close errors if no model; Summarize disabled without model.",
      "Ask Questions: per-reply metadata (model, ~input tokens, time, USD cost when API reports it). Video summary header shows cost when present.",
    ],
  },
  {
    title: "1.0.6",
    items: [
      "Subtitles: youtube-transcript-plus with 30-min cache; on-page transcript fallback if the library fails.",
      "Source maps: manifest web_accessible_resources for content-script .map files.",
      "Summarize button moved above the video title.",
      "Shared logger + on-page Log panel on the watch page.",
      "AI: non-streaming completions; OpenRouter uses AI SDK generateText; simpler background/proxy.",
      "Watch-page gear opens same settings as toolbar popup; Close in settings header; windows permission for fallback.",
      "Max output tokens setting (default 100); tokenx input estimate in its own log line (not API payload).",
    ],
  },
  {
    title: "1.0.5",
    items: [
      "Source hygiene: tracked core content-script components, stylesheet, and VS Code build task.",
    ],
  },
  {
    title: "1.0.4",
    items: [
      "Build: load unpacked from dist/; source maps (*.js.map) for debugging.",
      "Popup: API, Prompt, and Info tabs; scrollable; Info has tips, changelog, links, version.",
      "Settings: AI Provider dropdown first, then API key and model.",
      "Background: safer streaming proxy and SSE buffering across network chunks.",
      "Chat: full Q&A history on follow-up questions.",
      "Console: logs chat/completions URL and JSON body (not the API key) before each request.",
    ],
  },
  {
    title: "1.0.3",
    items: [
      "Configurable prompts: Prompt templates with {{TRANSCRIPT}} and {{SUMMARY}} placeholders and reset to defaults.",
    ],
  },
  {
    title: "1.0.2",
    items: [
      "Toolbar popup: full AI Provider Settings (same as the YouTube gear), not only placeholder text.",
    ],
  },
  {
    title: "1.0.1 baseline",
    items: [
      "YouTube watch page: Summarize, summary view, and chat about the video.",
      "Multiple AI providers (OpenAI, Google AI, Groq, OpenRouter, Ollama, LM Studio, custom OpenAI-compatible).",
      "Streaming responses via background proxy.",
    ],
  },
];
