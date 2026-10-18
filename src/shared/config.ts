export interface AIProvider {
  name: string;
  baseUrl: string;
  model: string;
  isLocal?: boolean;
  defaultBaseUrl?: string;
  customBaseUrl?: string;
  supportsModelList?: boolean;
  requiresModelInput?: boolean;
}

/** OpenRouter model used when the user has not chosen one. */
export const DEFAULT_MODEL_ID = "xiaomi/mimo-v2.5";

export const providers: AIProvider[] = [
  {
    name: "ChatGPT",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4",
    supportsModelList: true,
  },
  {
    name: "Google AI",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash-exp",
    supportsModelList: true,
  },
  {
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
    supportsModelList: true,
  },
  {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: DEFAULT_MODEL_ID,
    supportsModelList: true,
  },
  {
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    model: "llama2",
    isLocal: true,
    supportsModelList: true,
  },
  {
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    defaultBaseUrl: "http://127.0.0.1:1234/v1",
    model: "default",
    isLocal: true,
    supportsModelList: true,
  },
  {
    name: "Other OpenAI Compatible",
    baseUrl: "",
    model: "",
    isLocal: true,
    requiresModelInput: true,
  },
];

/** Provider shown when `selectedProvider` is unset. */
export function defaultAiProvider(): AIProvider {
  return providers.find((p) => p.name === "OpenRouter") ?? providers[0];
}
