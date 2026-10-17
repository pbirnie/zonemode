/** Shared types for profile-filter Innertube metadata + scoring (content replica + offscreen worker). */

export type ProfileFilterMetadataEntry = {
  haystackLower: string | null;
  /**
   * Legacy: title, author, description, category, Innertube `keywords`, `tags`, etc.
   * Not used for profile keyword **exact-match** (see `videoKeywordsLower`).
   */
  metadataTermsLower?: string[];
  /**
   * Tokens for **`metadata_exact`**: Innertube **`basic_info.keywords`** plus the
   * channel/uploader **`author`** label as one lowercased whole-term token when present (deduped).
   */
  videoKeywordsLower?: string[];
  previewTitle: string;
  classifierText: string;
  /** Uploader label from narrowed Innertube **`basic_info.author`** (`channel` objects are discarded). */
  author?: string;
  /** Raw view count from Innertube `basic_info.view_count` when available. */
  viewCount?: number;
};

export type ProfileFilterComputePayload = {
  /** Echoed back so the content script can ignore stale responses. */
  generation: number;
  videoIds: string[];
};

export type ProfileFilterVideoResult = {
  previewTitle: string;
  disposition: "no_keyword_match" | "kept_match" | "kept_no_metadata";
  matchedKeyword?: string;
  /** Legacy persisted tiles may still show `"substring"` / `"zero_shot"`; new runs use **`metadata_exact`**. */
  matchVia?: "zero_shot" | "metadata_exact" | "substring";
  /** Legacy semantic scores removed with MobileBERT. */
  scores?: Record<string, number>;
};

export type ProfileFilterComputeResponse = {
  generation: number;
  /** Innertube metadata only (`getBasicInfo` slice). */
  metadataByVideoId: Record<string, ProfileFilterMetadataEntry>;
  error?: string;
};
