/** Built-in profile id in storage (`default`); shown as **All** in the UI. */
export const DEFAULT_SUMMARY_PROFILE_ID = "default";

/** Label for the built-in profile ({@link DEFAULT_SUMMARY_PROFILE_ID}): no keywords; show all videos. */
export const DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME = "All";

/** User-defined profiles (excludes built-in id {@link DEFAULT_SUMMARY_PROFILE_ID}). */
export const STORAGE_KEY_SUMMARY_USER_PROFILES = "summaryUserProfiles";

/**
 * Seeded into `chrome.storage.sync` on first install only (`onInstalled` reason `install`).
 * Stable ids so the watch bar can select one without generated UUIDs.
 * The selected profile on install is {@link INSTALL_DEFAULT_SUMMARY_PROFILE_ID}.
 */
export const INSTALL_DEFAULT_SUMMARY_PROFILE_ID = "aifocus";

export const INSTALL_DEFAULT_SUMMARY_PROFILES: SummaryUserProfile[] = [
  {
    id: INSTALL_DEFAULT_SUMMARY_PROFILE_ID,
    name: "AiFocus",
    keywords: [
      "AI",
      "LLM",
      "Artificial Intelligence",
      "Anthropic",
      "Claude code",
      "Cursor",
      "Fireship",
      "Dwarkesh Patel",
      "Matt Pocock",
    ],
  },
  {
    id: "news",
    name: "News",
    keywords: ["Sky News", "Ed Conway"],
  },
  {
    id: "finance",
    name: "Finance",
    keywords: ["finance", "Patrick Boyle", "Sasha Yanshin"],
  },
];

/** Last profile chosen on the watch-page summarize bar. */
export const STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID =
  "selectedSummaryProfileId";

/** Whether the metadata hover-over diagnostic popup is enabled (default false). */
export const STORAGE_KEY_METADATA_HOVER_ENABLED = "metadataHoverEnabled";

/**
 * Auto-hide: when true, compact sidebar tiles that fail profile keyword matching
 * (red / no-match state) show a solid black cover over the **whole sidebar card**
 * and block pointer events on it. Tile layout stays in the DOM. Default off when unset.
 */
export const STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT =
  "profileFilterHideNonMatchingCompact";

/** Deprecated storage keys removed on popup Save (`SettingsPanel` migrate). */
export const LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_ENABLED =
  "profileFilterZeroShotEnabled";
export const LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_THRESHOLD_PCT =
  "profileFilterZeroShotThresholdPct";

/** Removed setting — stripped from **`chrome.storage.sync`** on toolbar Save. */
export const LEGACY_STORAGE_KEY_PROFILE_FILTER_CLASSIFIER_TITLE_ONLY =
  "profileFilterClassifierTitleOnly";

export interface SummaryUserProfile {
  id: string;
  name: string;
  /** Normalized keywords (trimmed, non-empty). */
  keywords: string[];
}

/** Split on newlines first, then commas within each line (trim, drop empties). */
export function parseKeywordsCsv(csv: string): string[] {
  const out: string[] = [];
  for (const line of csv.split(/\r?\n/)) {
    for (const part of line.split(",")) {
      const s = part.trim();
      if (s) out.push(s);
    }
  }
  return out;
}

/** One keyword per line for long lists; still readable when re-opened in the textarea. */
export function formatKeywordsCsv(keywords: string[]): string {
  return keywords.join("\n");
}

export function normalizeUserProfiles(raw: unknown): SummaryUserProfile[] {
  if (!Array.isArray(raw)) return [];
  const out: SummaryUserProfile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : "";
    const name =
      typeof o.name === "string" && o.name.trim() ? o.name.trim() : "Unnamed";
    let keywords: string[] = [];
    if (Array.isArray(o.keywords)) {
      keywords = o.keywords
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter(Boolean);
    } else if (typeof o.keywordsCsv === "string") {
      keywords = parseKeywordsCsv(o.keywordsCsv);
    }
    if (!id) continue;
    if (id === DEFAULT_SUMMARY_PROFILE_ID) continue;
    out.push({ id, name, keywords });
  }
  return out;
}

export function newUserProfileId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * All unique keywords across every custom profile (case-insensitive dedupe;
 * keeps first-seen casing).
 */
export function collectDistinctProfileKeywords(
  profiles: SummaryUserProfile[]
): string[] {
  const seenLower = new Set<string>();
  const out: string[] = [];
  for (const p of profiles) {
    for (const raw of p.keywords) {
      const k = raw.trim();
      if (!k) continue;
      const low = k.toLowerCase();
      if (seenLower.has(low)) continue;
      seenLower.add(low);
      out.push(k);
    }
  }
  return out;
}

/** Appended to the summary user message when the profile has keywords. */
export function buildProfileFocusInstruction(keywords: string[]): string | null {
  const cleaned = keywords.map((k) => k.trim()).filter(Boolean);
  if (!cleaned.length) return null;
  return `Profile focus — when summarizing, give extra weight to passages related to these terms (mention them if they appear in the transcript): ${cleaned.join(", ")}.`;
}
