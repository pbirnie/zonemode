import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";

export type OpenRouterCompletePayload = {
  /** User and assistant turns only—system prompt uses the `system` field. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  /** Innertube-style system instructions (AI SDK top-level `system` option). */
  system?: string;
  model: string;
  apiKey: string;
  maxTokens?: number;
};

export async function runOpenRouterComplete(
  payload: OpenRouterCompletePayload
): Promise<{ text: string; costUsd?: number }> {
  const { messages, model, apiKey, maxTokens: maxTokensRaw, system } = payload;
  const maxOutputTokens =
    typeof maxTokensRaw === "number" &&
    Number.isFinite(maxTokensRaw) &&
    maxTokensRaw > 0
      ? Math.min(Math.floor(maxTokensRaw), 128000)
      : undefined;

  try {
    const openrouter = createOpenRouter({ apiKey });
    const genOpts: Parameters<typeof generateText>[0] = {
      model: openrouter(model),
      messages,
      ...(system !== undefined && system.length > 0 ? { system } : {}),
    };
    if (maxOutputTokens !== undefined) {
      genOpts.maxOutputTokens = maxOutputTokens;
    }
    const result = await generateText(genOpts);
    const text = result.text;
    const orUsage = (
      result.providerMetadata as {
        openrouter?: { usage?: { cost?: number } };
      }
    )?.openrouter?.usage;
    const costUsd =
      typeof orUsage?.cost === "number" && Number.isFinite(orUsage.cost)
        ? orUsage.cost
        : undefined;
    return { text, costUsd };
  } catch (error: unknown) {
    let detail: string;
    if (error instanceof Error) {
      const cause = (error as { cause?: unknown }).cause;
      const responseBody =
        (error as { responseBody?: unknown }).responseBody ??
        (error as { data?: unknown }).data;
      const statusCode =
        (error as { statusCode?: unknown }).statusCode ??
        (error as { status?: unknown }).status;

      detail = error.message;
      if (responseBody) {
        try {
          const parsed =
            typeof responseBody === "string"
              ? JSON.parse(responseBody)
              : responseBody;
          detail =
            (parsed as { error?: { message?: string } })?.error?.message ??
            (parsed as { message?: string })?.message ??
            detail;
        } catch {
          /* keep original */
        }
      }
      if (statusCode !== undefined && statusCode !== null) {
        detail = `[${statusCode}] ${detail}`;
      }
      if (cause instanceof Error && cause.message) {
        detail = `${detail} (${cause.message})`;
      }
    } else {
      detail = String(error);
    }
    throw new Error(detail);
  }
}
