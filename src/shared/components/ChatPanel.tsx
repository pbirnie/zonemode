import React, { useState, useRef, useEffect } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  askQuestion,
  type CompletionResult,
  type Message as AIMessage,
} from "../../content/utils/ai";
import type { AIProvider } from "../config";
import { createLogger } from "../logger";

const log = createLogger("chat");

type AssistantMeta = Pick<
  CompletionResult,
  "model" | "estimatedInputTokens" | "durationMs" | "estimatedCostUsd"
>;

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; meta?: AssistantMeta };

interface ChatPanelProps {
  summary: string;
  provider: AIProvider;
  /** Watch-page title captured when the summary ran (for `{{TITLE}}` in chat system prompt). */
  videoTitle?: string;
}

function formatDurationMs(ms: number): string {
  return ms < 1000
    ? `${ms} ms`
    : `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)} s`;
}

function formatUsd(cost: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(cost);
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
  summary,
  provider,
  videoTitle,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      const container = messagesEndRef.current.closest(".summary-content");
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  };

  useEffect(() => {
    if (messages.length > 0) {
      scrollToBottom();
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isLoading) return;

    const question = inputValue.trim();
    log.log("ask →", question.slice(0, 80), { historyLen: messages.length });
    setInputValue("");
    setTimeout(() => inputRef.current?.focus(), 0);

    /** Prior turns only — askQuestion adds `question` as the latest user message. */
    const historyForApi: AIMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setIsLoading(true);

    try {
      const result = await askQuestion(
        question,
        summary,
        provider,
        historyForApi,
        { videoTitle }
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.text,
          meta: {
            model: result.model,
            estimatedInputTokens: result.estimatedInputTokens,
            durationMs: result.durationMs,
            estimatedCostUsd: result.estimatedCostUsd,
          },
        },
      ]);
      log.log("answer complete", {
        len: result.text.length,
        durationMs: result.durationMs,
        estimatedCostUsd: result.estimatedCostUsd,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      log.error("ask failed:", detail);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, I encountered an error: ${detail}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const renderMarkdown = (text: string) => {
    const rawHtml = marked(text) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="chat-section">
      <h2>Ask Questions</h2>
      {messages.length > 0 && (
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`chat-message ${
                message.role === "user" ? "user-message" : "assistant-message"
              }`}
            >
              {renderMarkdown(message.content)}
              {message.role === "assistant" && message.meta ? (
                <p
                  className="chat-message-meta"
                  title="Input tokens are a client-side estimate (tokenx). Cost is from the API when the provider reports it."
                >
                  {message.meta.model}
                  <span className="summary-meta-sep"> · </span>~
                  {message.meta.estimatedInputTokens.toLocaleString()} tokens
                  sent
                  <span className="summary-meta-sep"> · </span>
                  {formatDurationMs(message.meta.durationMs)}
                  {message.meta.estimatedCostUsd != null ? (
                    <>
                      <span className="summary-meta-sep"> · </span>
                      {formatUsd(message.meta.estimatedCostUsd)}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}
      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder={
            isLoading
              ? "Waiting for response..."
              : "Ask a question about the video..."
          }
          className={`chat-input ${isLoading ? "loading" : ""}`}
          ref={inputRef}
        />
        <button
          type="submit"
          disabled={isLoading || !inputValue.trim()}
          className="chat-submit-button"
        >
          {isLoading ? "..." : "Ask"}
        </button>
      </form>
    </div>
  );
};
