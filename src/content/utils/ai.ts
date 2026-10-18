import { estimateTokenCount } from "tokenx";
import type { AIProvider } from "../../shared/config";
import {
  resolveChatSystemPrompt,
  resolveSummaryUserPrompt,
  STORAGE_KEY_CHAT_SYSTEM_PROMPT,
  STORAGE_KEY_MAX_TOKENS,
  STORAGE_KEY_SUMMARY_PROMPT,
} from "../../shared/promptTemplates";
import { buildProfileFocusInstruction } from "../../shared/summaryProfiles";
import { proxyFetch } from "../../shared/utils/proxy";
import { fetchGoogleAIModels } from "../../shared/utils/googleAI";
import { createLogger } from "../../shared/logger";

const log = createLogger("ai");

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

function estimatePayloadTokens(messages: Message[]): number {
  const payload = messages
    .map((m) => `${m.role}\n${m.content}`)
    .join("\n\n---\n\n");
  return estimateTokenCount(payload);
}

/** Positive integer cap when set; `undefined` = omit limit (provider default). */
async function readOptionalMaxTokens(): Promise<number | undefined> {
  return new Promise((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY_MAX_TOKENS], (r) => {
      const v = r[STORAGE_KEY_MAX_TOKENS];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        resolve(Math.min(Math.floor(v), 128000));
        return;
      }
      if (typeof v === "string") {
        const n = Number.parseInt(v.trim(), 10);
        if (Number.isFinite(n) && n > 0) {
          resolve(Math.min(n, 128000));
          return;
        }
      }
      resolve(undefined);
    });
  });
}

export interface AIModel {
  id: string;
  name?: string;
}

/** Result of a single completion (summary or chat). */
export interface CompletionResult {
  text: string;
  model: string;
  estimatedInputTokens: number;
  durationMs: number;
  /** Present when the provider reports it (e.g. OpenRouter `usage.cost`). */
  estimatedCostUsd?: number;
}

interface ModelsResponse {
  data?: any[];
  models?: any[];
}

function parseChatCompletionContent(data: unknown): string {
  const obj = data as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = obj?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("No assistant message content in API response");
  }
  return content.trim();
}

/** OpenRouter (and compatible APIs) may include `usage.cost` in USD. */
function pickUsageCostUsd(data: unknown): number | undefined {
  const cost = (data as { usage?: { cost?: unknown } })?.usage?.cost;
  if (typeof cost === "number" && Number.isFinite(cost)) return cost;
  if (typeof cost === "string") {
    const n = Number.parseFloat(cost);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function partitionMessagesForOpenRouter(messages: Message[]): {
  system?: string;
  core: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const core: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else if (m.role === "user" || m.role === "assistant") {
      core.push({ role: m.role, content: m.content });
    }
  }
  const system =
    systemParts.length > 0 ? systemParts.join("\n\n") : undefined;
  return { system, core };
}

async function completeOpenRouter(
  messages: Message[],
  model: string,
  apiKey: string,
  maxTokens?: number
): Promise<CompletionResult> {
  const { system, core } = partitionMessagesForOpenRouter(messages);
  const estimatedInputTokens = estimatePayloadTokens(messages);
  log.log("Input token estimate (tokenx, client-only — not sent to API)", {
    estimatedInputTokens,
  });
  log.log("OpenRouter AI SDK request →", {
    provider: "OpenRouter",
    model,
    messageCount: core.length,
    hasSystemPrompt: system !== undefined && system.length > 0,
    hasApiKey: !!apiKey,
    maxOutputTokens: maxTokens ?? "(omit)",
  });

  const started = performance.now();
  const outbound = {
    type: "OPENROUTER_COMPLETE" as const,
    messages: core,
    ...(system !== undefined && system.length > 0 ? { system } : {}),
    model,
    apiKey,
    ...(maxTokens !== undefined ? { maxTokens } : {}),
  };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      outbound,
      (response) => {
        const durationMs = Math.round(performance.now() - started);
        if (chrome.runtime.lastError) {
          log.error("OpenRouter runtime error:", chrome.runtime.lastError);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok) {
          log.error("OpenRouter API error:", response?.error);
          reject(new Error(response?.error || "OpenRouter request failed"));
          return;
        }
        const text = response.text as string;
        if (typeof text !== "string" || !text.trim()) {
          reject(new Error("Empty response from OpenRouter"));
          return;
        }
        const costRaw = response.costUsd as unknown;
        const estimatedCostUsd =
          typeof costRaw === "number" && Number.isFinite(costRaw)
            ? costRaw
            : undefined;
        log.log("OpenRouter response ok", {
          chars: text.length,
          durationMs,
          estimatedCostUsd,
        });
        resolve({
          text: text.trim(),
          model,
          estimatedInputTokens,
          durationMs,
          estimatedCostUsd,
        });
      }
    );
  });
}

async function completeCompletion(
  provider: AIProvider,
  messages: Message[]
): Promise<CompletionResult> {
  const { apiKey, selectedModel, customBaseUrl } =
    await chrome.storage.sync.get(["apiKey", "selectedModel", "customBaseUrl"]);
  const maxTokens = await readOptionalMaxTokens();
  const estimatedInputTokens = estimatePayloadTokens(messages);

  if (!apiKey && !provider.isLocal) {
    throw new Error(
      "API key not found. Please set your API key in the extension settings."
    );
  }

  const rawModel =
    typeof selectedModel === "string" ? selectedModel.trim() : "";
  if (!rawModel) {
    throw new Error(
      "No model selected. Open the extension settings and choose a model."
    );
  }
  const model = rawModel;

  if (provider.name === "OpenRouter") {
    return completeOpenRouter(messages, model, apiKey, maxTokens);
  }

  const requestBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (maxTokens !== undefined) {
    requestBody.max_tokens = maxTokens;
  }

  const baseUrl = provider.isLocal
    ? customBaseUrl || provider.defaultBaseUrl || provider.baseUrl
    : provider.baseUrl;
  const completionsUrl = `${baseUrl}/chat/completions`;

  log.log("Input token estimate (tokenx, client-only — not sent to API)", {
    estimatedInputTokens,
  });
  log.log("AI request", completionsUrl, {
    model: requestBody.model,
    max_tokens: maxTokens ?? "(omit)",
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const started = performance.now();
  try {
    const data = await proxyFetch(completionsUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });
    const text = parseChatCompletionContent(data);
    const durationMs = Math.round(performance.now() - started);
    const estimatedCostUsd = pickUsageCostUsd(data);
    log.log("AI response ok", {
      chars: text.length,
      durationMs,
      estimatedCostUsd,
    });
    return {
      text,
      model,
      estimatedInputTokens,
      durationMs,
      estimatedCostUsd,
    };
  } catch (error) {
    log.error("completeCompletion failed:", error);
    throw error;
  }
}

export async function generateSummary(
  transcript: string,
  provider: AIProvider,
  options?: { profileKeywords?: string[]; videoTitle?: string }
): Promise<CompletionResult> {
  const storedSummaryPrompt = await new Promise<string | undefined>(
    (resolve) => {
      chrome.storage.sync.get([STORAGE_KEY_SUMMARY_PROMPT], (r) => {
        resolve(r[STORAGE_KEY_SUMMARY_PROMPT] as string | undefined);
      });
    }
  );
  let prompt = resolveSummaryUserPrompt(
    transcript,
    storedSummaryPrompt,
    options?.videoTitle
  );
  const focus = buildProfileFocusInstruction(options?.profileKeywords ?? []);
  if (focus) {
    prompt = `${prompt}\n\n${focus}`;
  }

  try {
    return await completeCompletion(provider, [{ role: "user", content: prompt }]);
  } catch (error) {
    log.error("generateSummary failed:", error);
    throw error;
  }
}

export async function askQuestion(
  question: string,
  summary: string,
  provider: AIProvider,
  chatHistory: Message[] = [],
  options?: { videoTitle?: string; transcript?: string }
): Promise<CompletionResult> {
  const storedChatPrompt = await new Promise<string | undefined>((resolve) => {
    chrome.storage.sync.get([STORAGE_KEY_CHAT_SYSTEM_PROMPT], (r) => {
      resolve(r[STORAGE_KEY_CHAT_SYSTEM_PROMPT] as string | undefined);
    });
  });
  const systemMessage: Message = {
    role: "system",
    content: resolveChatSystemPrompt(
      summary,
      storedChatPrompt,
      options?.videoTitle,
      options?.transcript
    ),
  };

  const userMessage: Message = { role: "user", content: question };
  const messages = [systemMessage, ...chatHistory, userMessage];

  try {
    return await completeCompletion(provider, messages);
  } catch (error) {
    log.error("askQuestion failed:", error);
    throw error;
  }
}

export async function fetchModels(
  provider: AIProvider,
  apiKey: string | null,
  customBaseUrl?: string
): Promise<AIModel[]> {
  if (!provider.supportsModelList) {
    return [];
  }

  if (provider.name === "Google AI") {
    return fetchGoogleAIModels(apiKey || "");
  }

  const baseUrl = provider.isLocal
    ? customBaseUrl || provider.defaultBaseUrl || provider.baseUrl
    : provider.baseUrl;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  try {
    const response = (await proxyFetch(`${baseUrl}/models`, {
      headers,
    })) as ModelsResponse;
    const models = response.data || response.models || [];
    return models.map((m: any) => ({
      id: m.id,
      name: m.name || m.id,
    }));
  } catch (error) {
    log.error("fetchModels failed:", error);
    throw error;
  }
}
