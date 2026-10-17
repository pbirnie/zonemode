import React, { useState, useCallback, useEffect } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  extractSubtitles,
  transcriptUnavailableHelp,
} from "../utils/subtitles";
import { generateSummary } from "../utils/ai";
import { getWatchPageVideoTitle } from "../utils/watchPageTitle";
import type { AIProvider } from "../../shared/config";
import { providers } from "../../shared/config";
import { ChatPanel } from "../../shared/components/ChatPanel";
import { LogPanel } from "./LogPanel";
import { createLogger } from "../../shared/logger";
import { logPrdEvent } from "../../shared/prdEventLog";
import {
  DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME,
  DEFAULT_SUMMARY_PROFILE_ID,
  STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
  STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
  STORAGE_KEY_SUMMARY_USER_PROFILES,
  formatKeywordsCsv,
  normalizeUserProfiles,
  type SummaryUserProfile,
} from "../../shared/summaryProfiles";
import { requestProfileFilterRefresh, clearCompactVideoProfileMeta } from "../videoProfileFilter";
import { clearProfileFilterMetaCache } from "../profileFilterMetaCache";
import { OFFSCREEN_OP_CLEAR_WORK_CACHES } from "../../shared/offscreenOps";
import { callOffscreen } from "../offscreenClient";

const log = createLogger("SummaryButton");

type SummaryError = { title: string; bullets?: string[] };

export const SummaryButton: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<SummaryError | null>(null);
  const [streamedText, setStreamedText] = useState<string>("");
  const [summaryMeta, setSummaryMeta] = useState<{
    model: string;
    estimatedInputTokens: number;
    durationMs: number;
    estimatedCostUsd?: number;
  } | null>(null);
  /** Title captured when summarizing — forwarded for `{{TITLE}}` in Ask Questions chat prompt. */
  const [promptVideoTitle, setPromptVideoTitle] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(
    null
  );
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [userSummaryProfiles, setUserSummaryProfiles] = useState<
    SummaryUserProfile[]
  >([]);
  const [selectedSummaryProfileId, setSelectedSummaryProfileId] = useState(
    DEFAULT_SUMMARY_PROFILE_ID
  );
  const [cacheClearing, setCacheClearing] = useState(false);
  const [hideNonMatchingCompact, setHideNonMatchingCompact] = useState(false);
  useEffect(() => {
    chrome.storage.sync.get(
      [
        "apiKey",
        "selectedProvider",
        "selectedModel",
        STORAGE_KEY_SUMMARY_USER_PROFILES,
        STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
        STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
      ],
      (result) => {
        log.log("loaded settings", {
          hasApiKey: !!result.apiKey,
          provider: result.selectedProvider?.name ?? "(default)",
          model: result.selectedModel ?? "(default)",
        });
        logPrdEvent("SummaryButton", "3", "mount_storage_loaded", {
          hasApiKey: !!result.apiKey,
          provider: result.selectedProvider?.name ?? "(default)",
          model: result.selectedModel ?? "(default)",
        });
        setApiKey(result.apiKey || null);
        setSelectedProvider(result.selectedProvider || providers[0]);
        setSelectedModel(
          typeof result.selectedModel === "string"
            ? result.selectedModel
            : ""
        );
        const list = normalizeUserProfiles(
          result[STORAGE_KEY_SUMMARY_USER_PROFILES]
        );
        setUserSummaryProfiles(list);
        let sel =
          typeof result[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID] === "string"
            ? result[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID].trim()
            : DEFAULT_SUMMARY_PROFILE_ID;
        if (
          sel !== DEFAULT_SUMMARY_PROFILE_ID &&
          !list.some((p) => p.id === sel)
        ) {
          sel = DEFAULT_SUMMARY_PROFILE_ID;
          chrome.storage.sync.set({
            [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]: sel,
          });
        }
        setSelectedSummaryProfileId(sel);
        setHideNonMatchingCompact(
          result[STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT] === true
        );
      }
    );

    // Listen for changes to settings
    chrome.storage.onChanged.addListener((changes) => {
      logPrdEvent("SummaryButton", "3", "chrome.storage.onChanged", {
        keys: Object.keys(changes),
      });
      if (changes.apiKey) {
        setApiKey(changes.apiKey.newValue || null);
      }
      if (changes.selectedProvider) {
        setSelectedProvider(changes.selectedProvider.newValue || providers[0]);
      }
      if (changes.selectedModel) {
        const v = changes.selectedModel.newValue;
        setSelectedModel(typeof v === "string" ? v : "");
      }
      if (changes[STORAGE_KEY_SUMMARY_USER_PROFILES]) {
        const list = normalizeUserProfiles(
          changes[STORAGE_KEY_SUMMARY_USER_PROFILES].newValue
        );
        setUserSummaryProfiles(list);
        chrome.storage.sync.get(
          [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID],
          (r) => {
            const cur =
              typeof r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID] === "string"
                ? r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID].trim()
                : DEFAULT_SUMMARY_PROFILE_ID;
            if (
              cur !== DEFAULT_SUMMARY_PROFILE_ID &&
              !list.some((p) => p.id === cur)
            ) {
              chrome.storage.sync.set({
                [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]:
                  DEFAULT_SUMMARY_PROFILE_ID,
              });
            }
          }
        );
      }
      if (changes[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]) {
        const v = changes[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID].newValue;
        setSelectedSummaryProfileId(
          typeof v === "string" && v.trim() ? v.trim() : DEFAULT_SUMMARY_PROFILE_ID
        );
      }
      if (changes[STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT]) {
        const v =
          changes[STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT].newValue;
        setHideNonMatchingCompact(v === true);
      }
    });
  }, []);

  // Reset summary when URL changes
  useEffect(() => {
    const resetState = () => {
      setStreamedText("");
      setSummaryMeta(null);
      setPromptVideoTitle("");
      setError(null);
      setIsLoading(false);
    };

    // Listen for YouTube's navigation events
    const handleNavigation = (e: Event) => {
      if (e.type === "yt-navigate-finish") {
        resetState();
      }
    };

    // YouTube uses a custom event for navigation
    document.addEventListener("yt-navigate-finish", handleNavigation);

    return () => {
      document.removeEventListener("yt-navigate-finish", handleNavigation);
    };
  }, []);

  const renderMarkdown = useCallback((text: string) => {
    const rawHtml = marked(text) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
  }, []);

  const openSettingsPopup = useCallback(() => {
    logPrdEvent("SummaryButton", "3", "click_settings_gear", {
      messageType: "OPEN_SETTINGS_UI",
    });
    chrome.runtime.sendMessage({ type: "OPEN_SETTINGS_UI" }, (response) => {
      if (chrome.runtime.lastError) {
        log.error("OPEN_SETTINGS_UI:", chrome.runtime.lastError.message);
        return;
      }
      if (response && !response.ok) {
        log.error("OPEN_SETTINGS_UI failed:", response.error);
      }
    });
  }, []);

  const onWatchAutoHideChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.checked;
      const prev = !next;
      logPrdEvent("SummaryButton", "3", "change_watch_auto_hide", {
        profileFilterHideNonMatchingCompact: next,
      });
      setHideNonMatchingCompact(next);
      chrome.storage.sync.set(
        { [STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT]: next },
        () => {
          if (chrome.runtime.lastError) {
            log.error(
              "save profileFilterHideNonMatchingCompact:",
              chrome.runtime.lastError.message
            );
            setHideNonMatchingCompact(prev);
            return;
          }
          requestProfileFilterRefresh(true);
        }
      );
    },
    []
  );

  const handleSummarize = async () => {
    try {
      setIsLoading(true);
      setError(null);
      setStreamedText("");
      setSummaryMeta(null);

      log.log("handleSummarize started");
      logPrdEvent("SummaryButton", "3", "click_summarize", {});

      const videoTitle = getWatchPageVideoTitle();

      const subResult = await extractSubtitles();
      if (!subResult.ok) {
        setError(transcriptUnavailableHelp(subResult.code));
        return;
      }
      const subtitles = subResult.transcript;
      log.log("subtitles extracted", { length: subtitles.length });

      if (!selectedProvider) {
        throw new Error("Please select an AI provider in settings");
      }

      if (!selectedProvider.isLocal && !apiKey) {
        throw new Error("Please configure your API key in settings");
      }

      const chosenModel = (selectedModel ?? "").trim();
      if (!chosenModel) {
        throw new Error(
          "Please choose a model in the extension settings (toolbar icon) before summarizing."
        );
      }

      const providerWithModel = {
        ...selectedProvider,
        model: chosenModel,
        apiKey: apiKey || "",
      };
      const profileKeywords =
        selectedSummaryProfileId === DEFAULT_SUMMARY_PROFILE_ID
          ? []
          : userSummaryProfiles.find((p) => p.id === selectedSummaryProfileId)
              ?.keywords ?? [];

      log.log("sending to AI", {
        provider: providerWithModel.name,
        model: providerWithModel.model,
        baseUrl: providerWithModel.baseUrl,
        summaryProfileId: selectedSummaryProfileId,
        keywordCount: profileKeywords.length,
      });

      const result = await generateSummary(subtitles, providerWithModel, {
        profileKeywords,
        videoTitle,
      });
      setPromptVideoTitle(videoTitle);
      setStreamedText(result.text);
      setSummaryMeta({
        model: result.model,
        estimatedInputTokens: result.estimatedInputTokens,
        durationMs: result.durationMs,
        estimatedCostUsd: result.estimatedCostUsd,
      });
      log.log("summary complete", {
        chars: result.text.length,
        model: result.model,
        estimatedInputTokens: result.estimatedInputTokens,
        durationMs: result.durationMs,
        estimatedCostUsd: result.estimatedCostUsd,
      });
    } catch (error) {
      log.error("handleSummarize failed:", error);
      setError({
        title:
          error instanceof Error
            ? error.message
            : "An unknown error occurred",
      });
      setStreamedText("");
      setSummaryMeta(null);
      setPromptVideoTitle("");
    } finally {
      setIsLoading(false);
    }
  };

  if (streamedText) {
    return (
      <>
        <div className="zonemode-container">
          <div className="summary-header">
            <div className="summary-header-main">
              <h3>Video Summary</h3>
              {summaryMeta ? (
                <p className="summary-meta" title="Input token count is a client-side estimate (tokenx), not from the API.">
                  {summaryMeta.model}
                  <span className="summary-meta-sep"> · </span>~
                  {summaryMeta.estimatedInputTokens.toLocaleString()} tokens sent
                  <span className="summary-meta-sep"> · </span>
                  {summaryMeta.durationMs < 1000
                    ? `${summaryMeta.durationMs} ms`
                    : `${(summaryMeta.durationMs / 1000).toFixed(summaryMeta.durationMs >= 10000 ? 0 : 1)} s`}
                  {summaryMeta.estimatedCostUsd != null ? (
                    <>
                      <span className="summary-meta-sep"> · </span>
                      {new Intl.NumberFormat(undefined, {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 6,
                      }).format(summaryMeta.estimatedCostUsd)}
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className="summary-header-actions">
              <label
                htmlFor="zonemode-watch-auto-hide-header"
                className="watch-auto-hide-label"
                title="Black out whole sidebar recommendation cards in the red (no-match) state. Same Auto-hide option as Profiles in settings."
              >
                <input
                  id="zonemode-watch-auto-hide-header"
                  type="checkbox"
                  checked={hideNonMatchingCompact}
                  onChange={onWatchAutoHideChange}
                  aria-label="Auto-hide: cover whole sidebar recommendation cards that do not match the active profile"
                />
                Auto-hide
              </label>
              <button
                type="button"
                onClick={openSettingsPopup}
                className="settings-button"
                title="Open extension settings"
              >
                ⚙️
              </button>
              <button
                type="button"
                onClick={() => {
                  logPrdEvent("SummaryButton", "3", "click_close_summary", {});
                  setStreamedText("");
                  setSummaryMeta(null);
                  setPromptVideoTitle("");
                }}
                className="close-button"
              >
                ×
              </button>
            </div>
          </div>
          <div className="summary-content">
            {renderMarkdown(streamedText)}
            {selectedProvider && (
              <ChatPanel
                summary={streamedText}
                provider={selectedProvider}
                videoTitle={promptVideoTitle}
              />
            )}
          </div>
        </div>
        <LogPanel />
      </>
    );
  }

  return (
    <div className="zonemode-container">
      {error ? (
        <div className="error-message" role="alert">
          <div className="error-message-title">{error.title}</div>
          {error.bullets?.length ? (
            <ul className="error-message-list">
              {error.bullets.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="button-container">
        <div className="summary-bar-profile-wrap">
          <label htmlFor="zonemode-profile-select" className="summary-bar-profile-label">
            Profile
          </label>
          <select
            id="zonemode-profile-select"
            className="model-select summary-bar-profile-select"
            value={selectedSummaryProfileId}
            onChange={(e) => {
              const v = e.target.value;
              logPrdEvent("SummaryButton", "3", "change_profile_select", {
                profileId: v,
              });
              setSelectedSummaryProfileId(v);
              chrome.storage.sync.set(
                { [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]: v },
                () => {
                  if (chrome.runtime.lastError) {
                    log.error(
                      "save summary profile id:",
                      chrome.runtime.lastError.message
                    );
                    return;
                  }
                  const profileName =
                    v === DEFAULT_SUMMARY_PROFILE_ID
                      ? DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME
                      : userSummaryProfiles.find((x) => x.id === v)?.name?.trim() ||
                        "(unknown)";
                  const keywords =
                    v === DEFAULT_SUMMARY_PROFILE_ID
                      ? []
                      : userSummaryProfiles.find((x) => x.id === v)?.keywords ?? [];
                  log.log("summary profile selected", {
                    profileId: v,
                    profileName,
                    keywords,
                    keywordsCsv:
                      keywords.length > 0
                        ? formatKeywordsCsv(keywords)
                        : "(none)",
                  });
                  requestProfileFilterRefresh(true);
                }
              );
            }}
            disabled={isLoading}
            aria-label="Summary profile"
          >
            <option value={DEFAULT_SUMMARY_PROFILE_ID}>
              {DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME}
            </option>
            {userSummaryProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name.trim() || "Unnamed"}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={handleSummarize}
          disabled={
            isLoading ||
            !selectedProvider ||
            (!selectedProvider.isLocal && !apiKey) ||
            !(selectedModel ?? "").trim()
          }
          className="summarize-button"
        >
          {isLoading ? "Summarizing..." : "Summarize"}
        </button>
        <button
          type="button"
          disabled={cacheClearing}
          onClick={() => {
            logPrdEvent("SummaryButton", "3", "click_clear_cache", {});
            void (async () => {
              setCacheClearing(true);
              try {
                clearProfileFilterMetaCache();
                clearCompactVideoProfileMeta();
                await callOffscreen(OFFSCREEN_OP_CLEAR_WORK_CACHES);
                log.log(
                  "caches cleared (replica meta + offscreen work caches + compact video meta)"
                );
                requestProfileFilterRefresh(true);
              } catch (e) {
                log.error("clear caches failed:", e);
              } finally {
                setCacheClearing(false);
              }
            })();
          }}
          className={
            cacheClearing ? "clear-cache-button clearing" : "clear-cache-button"
          }
          title="Clear profile filter and zero-shot caches, then re-run filter"
        >
          Clear Cache
        </button>
        <label
          htmlFor="zonemode-watch-auto-hide-bar"
          className="watch-auto-hide-label"
          title="Black out whole sidebar recommendation cards in the red (no-match) state. Same Auto-hide option as Profiles in settings."
        >
          <input
            id="zonemode-watch-auto-hide-bar"
            type="checkbox"
            checked={hideNonMatchingCompact}
            onChange={onWatchAutoHideChange}
            aria-label="Auto-hide: cover whole sidebar recommendation cards that do not match the active profile"
          />
          Auto-hide
        </label>
        <button
          type="button"
          onClick={openSettingsPopup}
          className="settings-button"
          title="Open extension settings"
        >
          ⚙️
        </button>
      </div>
      <LogPanel />
    </div>
  );
};
