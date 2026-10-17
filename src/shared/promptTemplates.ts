/** Placeholder replaced with the video transcript (summary request user message). */
export const TRANSCRIPT_PLACEHOLDER = "{{TRANSCRIPT}}";

/** Placeholder replaced with the watch-page video title when summarizing / chatting (may be empty). */
export const TITLE_PLACEHOLDER = "{{TITLE}}";

/** Placeholder replaced with the generated summary markdown (chat system message). */
export const SUMMARY_PLACEHOLDER = "{{SUMMARY}}";

export const STORAGE_KEY_SUMMARY_PROMPT = "summaryPromptTemplate";
export const STORAGE_KEY_CHAT_SYSTEM_PROMPT = "chatSystemPromptTemplate";

/** Optional max completion tokens (`max_tokens` / `maxOutputTokens`). Unset = omit (provider default). */
export const STORAGE_KEY_MAX_TOKENS = "maxTokens";
/** Legacy default mentioned in help text as an example cap only; stored default is None (omit). */
export const DEFAULT_MAX_TOKENS = 100;

export const DEFAULT_SUMMARY_PROMPT_TEMPLATE = `Provide a concise summary of this YouTube video transcript using markdown formatting.

Video title: ${TITLE_PLACEHOLDER}

${TRANSCRIPT_PLACEHOLDER}

Required format:
# Key Points
[Main content summary formatted as markdown]

Formatting rules:
- Use bullet points for key points
- Use **bold** for important terms
- Use *italic* for emphasis
- Use > for notable quotes
- Use --- for section breaks
- Use \`code\` for technical terms
- Use [text](link) for any references

Be direct and concise. Do not use introductory phrases like "Here's a summary" or "Let me summarize".`;

export const DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE = `You are a friendly and helpful AI assistant discussing a YouTube video.

Video title: ${TITLE_PLACEHOLDER}

Summary for context:

${SUMMARY_PLACEHOLDER}

If the user asks something that isn't covered in the summary, you can say so while still trying to be helpful based on the context you have. Be direct and concise in your responses.`;

function substituteAll(haystack: string, needle: string, value: string): string {
  if (!needle) return haystack;
  return haystack.split(needle).join(value);
}

function applyVideoTitle(template: string, videoTitle: string | undefined): string {
  if (!template.includes(TITLE_PLACEHOLDER)) return template;
  return substituteAll(template, TITLE_PLACEHOLDER, videoTitle ?? "");
}

import { createLogger } from "./logger";

const log = createLogger("prompt");

/** Builds the user message sent for summarization. */
export function resolveSummaryUserPrompt(
  transcript: string,
  stored: string | undefined | null,
  videoTitle?: string
): string {
  const usingCustom = typeof stored === "string" && stored.trim() !== "";
  const template = usingCustom ? stored! : DEFAULT_SUMMARY_PROMPT_TEMPLATE;

  log.log("resolveSummaryUserPrompt", {
    customTemplate: usingCustom,
    transcriptLen: transcript.length,
    hasTranscriptPlaceholder: template.includes(TRANSCRIPT_PLACEHOLDER),
    hasTitlePlaceholder: template.includes(TITLE_PLACEHOLDER),
    titleLen: (videoTitle ?? "").length,
  });

  const withTitle = applyVideoTitle(template, videoTitle);

  if (withTitle.includes(TRANSCRIPT_PLACEHOLDER)) {
    return substituteAll(withTitle, TRANSCRIPT_PLACEHOLDER, transcript);
  }

  return `${withTitle}\n\n--- Transcript ---\n\n${transcript}`;
}

/** Builds the system message for post-summary chat. */
export function resolveChatSystemPrompt(
  summary: string,
  stored: string | undefined | null,
  videoTitle?: string
): string {
  const usingCustom = typeof stored === "string" && stored.trim() !== "";
  const template = usingCustom ? stored! : DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE;

  log.log("resolveChatSystemPrompt", {
    customTemplate: usingCustom,
    summaryLen: summary.length,
    hasSummaryPlaceholder: template.includes(SUMMARY_PLACEHOLDER),
    hasTitlePlaceholder: template.includes(TITLE_PLACEHOLDER),
    titleLen: (videoTitle ?? "").length,
  });

  const withTitle = applyVideoTitle(template, videoTitle);

  if (withTitle.includes(SUMMARY_PLACEHOLDER)) {
    return substituteAll(withTitle, SUMMARY_PLACEHOLDER, summary);
  }

  return `${withTitle}\n\n--- Summary ---\n\n${summary}`;
}
