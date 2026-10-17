import type {
  ProfileFilterMetadataEntry,
  ProfileFilterVideoResult,
} from "./profileFilterMessages";

/**
 * Innertube **`basic_info.keywords`** tokens (any casing) plus the channel/uploader
 * **`author`** string as one additional lowercased whole-term token, deduped.
 */
export function keywordMatchTermsFromVideoKeywordsAndAuthor(
  innertubeTokens: string[],
  authorDisplay: string | undefined
): string[] {
  const lowered = innertubeTokens
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!authorDisplay) return lowered;
  const term = authorDisplay.trim().toLowerCase();
  if (!term || lowered.some((existing) => existing === term)) return lowered;
  return [term, ...lowered];
}

/** Case-insensitive whole-term equality: profile `news` matches metadata term `news`, not `AI news`. */
export function profileKeywordMatchesMetadataTerm(
  termLower: string,
  profileKeyword: string
): boolean {
  const needle = profileKeyword.trim().toLowerCase();
  if (!needle) return false;
  return termLower.trim().toLowerCase() === needle;
}

function metadataTermsForMatch(
  metadataTermsLower: string[] | null | undefined,
  haystackLower: string | null
): string[] {
  if (metadataTermsLower && metadataTermsLower.length > 0) {
    return metadataTermsLower;
  }
  if (!haystackLower) return [];
  return haystackLower.split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * True when any profile keyword exactly matches (case-insensitive) one of the
 * given metadata terms (whole-token equality).
 * @deprecated Prefer `profileKeywordsMatchInnertubeKeywords` for profile-filter keyword matching.
 */
export function profileKeywordsMatchMetadata(
  metadataTermsLower: string[] | null | undefined,
  haystackLower: string | null,
  profileKeywords: string[]
): boolean {
  const terms = metadataTermsForMatch(metadataTermsLower, haystackLower);
  if (terms.length === 0) return false;
  return profileKeywords.some((kw) =>
    terms.some((term) => profileKeywordMatchesMetadataTerm(term, kw))
  );
}

/**
 * True when any profile keyword exactly matches (case-insensitive) one token in
 * {@link ProfileFilterMetadataEntry.videoKeywordsLower} — Innertube
 * **`basic_info.keywords`** plus **`basic_info.author`** as one optional token (not title,
 * tags, description, or category as separate pseudo-keywords beyond author).
 */
export function profileKeywordsMatchInnertubeKeywords(
  videoKeywordsLower: string[] | null | undefined,
  profileKeywords: string[]
): boolean {
  const terms = videoKeywordsLower?.filter((t) => t.trim()) ?? [];
  if (terms.length === 0) return false;
  return profileKeywords.some((kw) =>
    terms.some((term) => profileKeywordMatchesMetadataTerm(term, kw))
  );
}

/** @deprecated Prefer `profileKeywordsMatchMetadata` with `metadataTermsLower`. */
export function profileKeywordsMatchHaystack(
  haystackLower: string,
  profileKeywords: string[]
): boolean {
  return profileKeywordsMatchMetadata(undefined, haystackLower, profileKeywords);
}

function firstMatchingInnertubeKeyword(
  videoKeywordsLower: string[] | null | undefined,
  profileKeywords: string[]
): string | undefined {
  const terms = videoKeywordsLower?.filter((t) => t.trim()) ?? [];
  for (const kw of profileKeywords) {
    const needle = kw.trim().toLowerCase();
    if (!needle) continue;
    if (terms.some((term) => profileKeywordMatchesMetadataTerm(term, kw))) {
      return kw.trim();
    }
  }
  return undefined;
}

/**
 * Profile-keyword disposition from Innertube **metadata_exact** tokens only
 * (`videoKeywordsLower`: `basic_info.keywords` + optional author/channel term).
 */
export function finalizeProfileVideoResult(
  entry: ProfileFilterMetadataEntry | undefined,
  videoId: string,
  profileKeywords: string[]
): ProfileFilterVideoResult {
  if (!entry) {
    return { previewTitle: videoId, disposition: "kept_no_metadata" };
  }
  const title = entry.previewTitle ?? videoId;
  const hay = entry.haystackLower;

  if (hay == null) {
    return { previewTitle: title, disposition: "kept_no_metadata" };
  }

  const metadataExactMatch = profileKeywordsMatchInnertubeKeywords(
    entry.videoKeywordsLower,
    profileKeywords
  );

  if (metadataExactMatch) {
    const matchedKeyword = firstMatchingInnertubeKeyword(
      entry.videoKeywordsLower,
      profileKeywords
    );
    return {
      previewTitle: title,
      disposition: "kept_match",
      matchedKeyword,
      matchVia: "metadata_exact",
    };
  }

  return {
    previewTitle: title,
    disposition: "no_keyword_match",
  };
}
