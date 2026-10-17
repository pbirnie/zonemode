import React, { useState, useCallback, useEffect, useRef } from "react";
import type { AIProvider } from "../config";
import { providers } from "../config";
import {
  DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_MAX_TOKENS,
  DEFAULT_SUMMARY_PROMPT_TEMPLATE,
  STORAGE_KEY_CHAT_SYSTEM_PROMPT,
  STORAGE_KEY_MAX_TOKENS,
  STORAGE_KEY_SUMMARY_PROMPT,
  SUMMARY_PLACEHOLDER,
  TITLE_PLACEHOLDER,
  TRANSCRIPT_PLACEHOLDER,
} from "../promptTemplates";
import { ChangelogPanel } from "./ChangelogPanel";
import { ModelSelect } from "./ModelSelect";
import { fetchModels } from "../../content/utils/ai";
import { createLogger } from "../logger";
import { logPrdEvent } from "../prdEventLog";
import {
  DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME,
  DEFAULT_SUMMARY_PROFILE_ID,
  LEGACY_STORAGE_KEY_PROFILE_FILTER_CLASSIFIER_TITLE_ONLY,
  LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_ENABLED,
  LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_THRESHOLD_PCT,
  STORAGE_KEY_METADATA_HOVER_ENABLED,
  STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
  STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
  STORAGE_KEY_SUMMARY_USER_PROFILES,
  formatKeywordsCsv,
  newUserProfileId,
  normalizeUserProfiles,
  parseKeywordsCsv,
  type SummaryUserProfile,
} from "../summaryProfiles";

const log = createLogger("settings");

/** Throttle PRD logs for high-frequency field edits (PRD §6 prompt/profile inputs). */
let lastSettingsPrdFieldLogAt = 0;
const SETTINGS_PRD_FIELD_LOG_MS = 4000;

function logPrdSettingsField(event: string, detail?: Record<string, unknown>) {
  const now = Date.now();
  if (now - lastSettingsPrdFieldLogAt < SETTINGS_PRD_FIELD_LOG_MS) return;
  lastSettingsPrdFieldLogAt = now;
  logPrdEvent("settings", "6", event, detail);
}

/** Merge textarea keyword drafts into profile rows for save/reload drafts. */
function mergeKeywordDraftsIntoProfiles(
  profiles: SummaryUserProfile[],
  drafts: Record<string, string>
): SummaryUserProfile[] {
  return profiles.map((p) => {
    const raw =
      p.id in drafts ? drafts[p.id]! : formatKeywordsCsv(p.keywords);
    const parsed = parseKeywordsCsv(raw);
    return { ...p, keywords: parsed };
  });
}

interface AIModel {
  id: string;
  name?: string;
}

export type SettingsTabId = "api" | "prompt" | "profiles" | "debug" | "info";

interface SettingsPanelProps {
  onClose?: () => void;
  showHeader?: boolean;
  /** When true (toolbar popup), use API / Prompt / Info tabs. */
  tabbed?: boolean;
  className?: string;
  onProviderChange?: (provider: AIProvider) => void;
  onModelChange?: (model: string) => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  onClose,
  showHeader = true,
  tabbed = false,
  className = "",
  onProviderChange,
  onModelChange,
}) => {
  /** Toolbar popup (`tabbed`): edits stay in-memory until Save. */
  const deferPersistenceWrites = tabbed;

  const [activeTab, setActiveTab] = useState<SettingsTabId>("profiles");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AIProvider | null>(
    null
  );
  const [availableModels, setAvailableModels] = useState<AIModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [customBaseUrl, setCustomBaseUrl] = useState<string>("");
  const [customModel, setCustomModel] = useState<string>("");
  const [summaryPromptTemplate, setSummaryPromptTemplate] = useState(
    DEFAULT_SUMMARY_PROMPT_TEMPLATE
  );
  const [chatSystemPromptTemplate, setChatSystemPromptTemplate] = useState(
    DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE
  );
  /** `null` = None (omit max_tokens / maxOutputTokens). */
  const [maxTokens, setMaxTokens] = useState<number | null>(null);
  const [closeBlockedMessage, setCloseBlockedMessage] = useState<string | null>(
    null
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [promptKeysRemoveOnSave, setPromptKeysRemoveOnSave] = useState(false);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const [apiTabRefreshBusy, setApiTabRefreshBusy] = useState(false);
  const [userSummaryProfiles, setUserSummaryProfiles] = useState<
    SummaryUserProfile[]
  >([]);
  /** Raw textarea text per profile; avoids parse-on-type stripping trailing commas. */
  const [keywordsDraftByProfileId, setKeywordsDraftByProfileId] = useState<
    Record<string, string>
  >({});
  const userSummaryProfilesRef = useRef(userSummaryProfiles);
  const keywordsDraftRef = useRef(keywordsDraftByProfileId);
  /** Latest base URL for model-list fetches without re-binding `handleFetchModels` (avoids re-running the mount `storage.sync.get` effect). */
  const customBaseUrlRef = useRef("");

  useEffect(() => {
    userSummaryProfilesRef.current = userSummaryProfiles;
  }, [userSummaryProfiles]);
  useEffect(() => {
    keywordsDraftRef.current = keywordsDraftByProfileId;
  }, [keywordsDraftByProfileId]);
  useEffect(() => {
    customBaseUrlRef.current = customBaseUrl;
  }, [customBaseUrl]);

  const markDraftDirty = useCallback(() => {
    if (deferPersistenceWrites) setHasUnsavedChanges(true);
  }, [deferPersistenceWrites]);

  /** Non-tabbed: apply keyword drafts to profiles + chrome. Tabbed deferred: callers use Save instead. */
  const flushProfileKeywordDrafts = useCallback(() => {
    const profiles = userSummaryProfilesRef.current;
    const draft = keywordsDraftRef.current;
    const next = profiles.map((p) => {
      const raw =
        p.id in draft ? draft[p.id]! : formatKeywordsCsv(p.keywords);
      const parsed = parseKeywordsCsv(raw);
      return { ...p, keywords: parsed };
    });

    let changed = false;
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i]!;
      const n = next[i]!;
      if (p.keywords.length !== n.keywords.length) {
        changed = true;
        break;
      }
      for (let j = 0; j < p.keywords.length; j++) {
        if (p.keywords[j] !== n.keywords[j]) {
          changed = true;
          break;
        }
      }
      if (changed) break;
    }

    const newDraft: Record<string, string> = {};
    for (const p of next) {
      newDraft[p.id] = formatKeywordsCsv(p.keywords);
    }

    if (changed) {
      setUserSummaryProfiles(next);
      if (!deferPersistenceWrites) {
        chrome.storage.sync.set({ [STORAGE_KEY_SUMMARY_USER_PROFILES]: next });
      }
    }
    keywordsDraftRef.current = newDraft;
    setKeywordsDraftByProfileId(newDraft);
  }, [deferPersistenceWrites]);

  const [metadataHoverEnabled, setMetadataHoverEnabled] = useState(false);
  const [profileFilterHideNonMatchingCompact, setProfileFilterHideNonMatchingCompact] =
    useState(false);

  const handleFetchModels = useCallback(
    async (provider: AIProvider, key: string) => {
      if (!provider.supportsModelList) return;

      setIsLoadingModels(true);
      setModelError(null);
      try {
        log.log("fetchModels", { provider: provider.name });
        logPrdEvent("settings", "6", "handleFetchModels", {
          provider: provider.name,
        });
        const models = await fetchModels(provider, key, customBaseUrlRef.current);
        log.log("fetchModels result", { count: models.length, first: models[0]?.id });
        setAvailableModels(models);
        if (models.length > 0) {
          if (!tabbed) {
            setSelectedModel(models[0].id);
            chrome.storage.sync.set({ selectedModel: models[0].id });
            onModelChange?.(models[0].id);
          } else {
            setSelectedModel((prev) => {
              const cur = (prev ?? "").trim();
              const valid = cur && models.some((m) => m.id === cur);
              return valid ? cur : "";
            });
          }
        } else {
          const fallback = tabbed ? "" : provider.model;
          setSelectedModel(fallback);
          if (!tabbed) {
            chrome.storage.sync.set({ selectedModel: fallback });
          }
          onModelChange?.(fallback);
        }
      } catch (error) {
        log.error("fetchModels failed:", error);
        setModelError("Failed to fetch available models");
        setAvailableModels([]);
        if (!tabbed) {
          setSelectedModel(provider.model);
          chrome.storage.sync.set({ selectedModel: provider.model });
          onModelChange?.(provider.model);
        } else {
          setSelectedModel("");
        }
      } finally {
        setIsLoadingModels(false);
      }
    },
    [onModelChange, tabbed]
  );

  const refreshApiTabData = useCallback(async () => {
    if (!tabbed || !selectedProvider) return;
    const key = (apiKey ?? "").trim();
    setApiTabRefreshBusy(true);
    try {
      if (
        selectedProvider.supportsModelList &&
        (selectedProvider.isLocal || key)
      ) {
        await handleFetchModels(selectedProvider, key);
      }
    } finally {
      setApiTabRefreshBusy(false);
    }
  }, [tabbed, selectedProvider, apiKey, handleFetchModels]);

  // Load saved settings
  useEffect(() => {
    chrome.storage.sync.get(
      [
        "apiKey",
        "selectedProvider",
        "selectedModel",
        "customBaseUrl",
        "customModel",
        STORAGE_KEY_SUMMARY_PROMPT,
        STORAGE_KEY_CHAT_SYSTEM_PROMPT,
        STORAGE_KEY_MAX_TOKENS,
        STORAGE_KEY_SUMMARY_USER_PROFILES,
        STORAGE_KEY_METADATA_HOVER_ENABLED,
        STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT,
      ],
      (result) => {
        const provider = result.selectedProvider || providers[0];
        const savedCustomBaseUrl = result.customBaseUrl || "";
        customBaseUrlRef.current = savedCustomBaseUrl;
        const savedCustomModel =
          typeof result.customModel === "string" ? result.customModel : "";
        const savedSummary = result[STORAGE_KEY_SUMMARY_PROMPT];
        const savedChat = result[STORAGE_KEY_CHAT_SYSTEM_PROMPT];
        const savedMax = result[STORAGE_KEY_MAX_TOKENS];
        let loadedMax: number | null = null;
        if (typeof savedMax === "number" && Number.isFinite(savedMax) && savedMax > 0) {
          loadedMax = Math.min(Math.floor(savedMax), 128000);
        } else if (typeof savedMax === "string") {
          const n = Number.parseInt(savedMax.trim(), 10);
          if (Number.isFinite(n) && n > 0) loadedMax = Math.min(n, 128000);
        }

        if (provider.requiresModelInput) {
          const cm =
            savedCustomModel ||
            (typeof result.selectedModel === "string"
              ? result.selectedModel
              : "");
          setCustomModel(cm);
          setSelectedModel(cm);
        } else {
          const model =
            tabbed
              ? typeof result.selectedModel === "string"
                ? result.selectedModel
                : ""
              : (result.selectedModel as string | undefined) || provider.model;
          setSelectedModel(model);
          setCustomModel(savedCustomModel);
        }

        log.log("loaded storage", {
          provider: provider.name,
          hasApiKey: !!result.apiKey,
          customBaseUrl: savedCustomBaseUrl || "(none)",
          maxTokens: loadedMax ?? "(none)",
        });
        logPrdEvent("settings", "6", "mount_storage_loaded", {
          tabbed,
          provider: provider.name,
          hasApiKey: !!result.apiKey,
        });
        setSelectedProvider(provider);
        setApiKey(result.apiKey || null);
        setCustomBaseUrl(savedCustomBaseUrl);
        setSummaryPromptTemplate(
          typeof savedSummary === "string" && savedSummary.trim() !== ""
            ? savedSummary
            : DEFAULT_SUMMARY_PROMPT_TEMPLATE
        );
        setChatSystemPromptTemplate(
          typeof savedChat === "string" && savedChat.trim() !== ""
            ? savedChat
            : DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE
        );
        setMaxTokens(loadedMax);
        setUserSummaryProfiles(
          normalizeUserProfiles(result[STORAGE_KEY_SUMMARY_USER_PROFILES])
        );
        setMetadataHoverEnabled(
          result[STORAGE_KEY_METADATA_HOVER_ENABLED] === true
        );
        setProfileFilterHideNonMatchingCompact(
          result[STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT] === true
        );

        // Notify parent components
        onProviderChange?.(provider);
        onModelChange?.(
          provider.requiresModelInput
            ? savedCustomModel ||
                (typeof result.selectedModel === "string"
                  ? result.selectedModel
                  : "")
            : tabbed
              ? typeof result.selectedModel === "string"
                ? result.selectedModel
                : ""
              : (result.selectedModel as string | undefined) || provider.model
        );

        // Only show API key error for non-local providers
        if (!result.apiKey && !provider.isLocal) {
          setApiKeyError("Please set your API key in the extension settings");
        }

        if (
          !tabbed &&
          provider.supportsModelList &&
          (provider.isLocal || result.apiKey)
        ) {
          handleFetchModels(provider, result.apiKey || "");
        }

        if (tabbed) {
          setHasUnsavedChanges(false);
          setPromptKeysRemoveOnSave(false);
        }
      }
    );
  }, [onProviderChange, onModelChange, handleFetchModels, tabbed]);

  const handleProviderChange = (provider: AIProvider) => {
    log.log("provider changed →", provider.name);
    logPrdEvent("settings", "6", "change_ai_provider", { provider: provider.name });
    setSelectedProvider(provider);
    setCloseBlockedMessage(null);

    setAvailableModels([]);
    setModelError(null);

    if (tabbed) {
      setSelectedModel("");
      setCustomModel("");
      markDraftDirty();
      onProviderChange?.(provider);
      onModelChange?.("");
    } else {
      setSelectedModel(provider.model);
      chrome.storage.sync.set({
        selectedProvider: provider,
        selectedModel: provider.model,
      });
      onProviderChange?.(provider);
      onModelChange?.(provider.model);
    }

    // Clear API key error if switching to a local provider
    if (provider.isLocal) {
      setApiKeyError(null);
    } else if (!apiKey) {
      setApiKeyError("Please set your API key in the extension settings");
    }

    // If the provider supports model listing, fetch models (popup API tab uses Update instead)
    if (
      !tabbed &&
      provider.supportsModelList &&
      (provider.isLocal || apiKey)
    ) {
      handleFetchModels(provider, apiKey || "");
    }
  };

  const handleBaseUrlChange = (url: string) => {
    logPrdEvent("settings", "6", "change_base_url", { length: url.length });
    setCustomBaseUrl(url);
    if (deferPersistenceWrites) {
      markDraftDirty();
    } else {
      chrome.storage.sync.set({ customBaseUrl: url });
    }
    setCloseBlockedMessage(null);

    if (tabbed) {
      setAvailableModels([]);
      setModelError(null);
    }

    if (
      !tabbed &&
      selectedProvider?.supportsModelList &&
      (selectedProvider.isLocal || apiKey)
    ) {
      handleFetchModels(selectedProvider, apiKey || "");
    }
  };

  const handleCustomModelChange = (model: string) => {
    logPrdEvent("settings", "6", "change_custom_model", { length: model.length });
    setCloseBlockedMessage(null);
    setCustomModel(model);
    setSelectedModel(model);
    if (deferPersistenceWrites) {
      markDraftDirty();
    } else {
      chrome.storage.sync.set({
        customModel: model,
        selectedModel: model,
      });
    }
    onModelChange?.(model);
  };

  const validateTabbedSettingsReady = useCallback(
    (kind: "close" | "save"): boolean => {
      if (!deferPersistenceWrites) return true;

      setCloseBlockedMessage(null);

      if (!selectedProvider) {
        return true;
      }

      const tail = kind === "close" ? "before closing." : "before saving.";

      if (isLoadingModels && selectedProvider.supportsModelList) {
        setCloseBlockedMessage(
          `Please wait for models to finish loading, then choose a model ${tail}`
        );
        setActiveTab("api");
        return false;
      }

      if (selectedProvider.requiresModelInput) {
        if (!customModel.trim()) {
          setCloseBlockedMessage(`Please enter a model name ${tail}`);
          setActiveTab("api");
          return false;
        }
      } else if (selectedProvider.supportsModelList) {
        if (!(selectedModel ?? "").trim()) {
          if (availableModels.length > 0) {
            setCloseBlockedMessage(`Please choose a model ${tail}`);
            setActiveTab("api");
            return false;
          }
          if (selectedProvider.isLocal || apiKey) {
            setCloseBlockedMessage(
              `Press Update on the API tab to load the model list, then choose a model ${tail}`
            );
            setActiveTab("api");
            return false;
          }
        }
      }

      return true;
    },
    [
      deferPersistenceWrites,
      selectedProvider,
      isLoadingModels,
      customModel,
      selectedModel,
      availableModels,
      apiKey,
    ]
  );

  const handleSaveClick = useCallback(() => {
    if (!deferPersistenceWrites) {
      return;
    }
    if (!validateTabbedSettingsReady("save")) return;
    if (!selectedProvider) {
      setCloseBlockedMessage("Choose an AI provider before saving.");
      setActiveTab("api");
      return;
    }

    const mergedProfiles = normalizeUserProfiles(
      mergeKeywordDraftsIntoProfiles(
        userSummaryProfiles,
        keywordsDraftByProfileId
      )
    );

    setSaveInProgress(true);
    setCloseBlockedMessage(null);

    chrome.storage.sync.get([STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID], (r) => {
      if (chrome.runtime.lastError) {
        log.error("save settings get:", chrome.runtime.lastError.message);
        setCloseBlockedMessage(
          `Could not read current profile selection: ${chrome.runtime.lastError.message}`
        );
        setSaveInProgress(false);
        return;
      }

      const validIds = new Set([
        DEFAULT_SUMMARY_PROFILE_ID,
        ...mergedProfiles.map((p) => p.id),
      ]);
      let selId =
        typeof r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID] === "string"
          ? r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID].trim()
          : DEFAULT_SUMMARY_PROFILE_ID;
      if (!selId) selId = DEFAULT_SUMMARY_PROFILE_ID;
      if (
        selId !== DEFAULT_SUMMARY_PROFILE_ID &&
        !validIds.has(selId)
      ) {
        selId = DEFAULT_SUMMARY_PROFILE_ID;
      }

      const toRemove: string[] = [
        LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_ENABLED,
        LEGACY_STORAGE_KEY_PROFILE_FILTER_ZERO_SHOT_THRESHOLD_PCT,
        LEGACY_STORAGE_KEY_PROFILE_FILTER_CLASSIFIER_TITLE_ONLY,
      ];
      if (maxTokens === null) {
        toRemove.push(STORAGE_KEY_MAX_TOKENS);
      }

      const customModelTrim = customModel.trim();
      const selectedModelForSync = selectedProvider.requiresModelInput
        ? customModelTrim
        : (selectedModel ?? "").trim();

      const toSet: Record<string, unknown> = {
        apiKey: (apiKey ?? "").trim(),
        selectedProvider,
        customBaseUrl,
        customModel: customModelTrim,
        selectedModel: selectedModelForSync,
        [STORAGE_KEY_SUMMARY_USER_PROFILES]: mergedProfiles,
        [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]: selId,
        [STORAGE_KEY_METADATA_HOVER_ENABLED]: metadataHoverEnabled,
        [STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT]:
          profileFilterHideNonMatchingCompact,
      };

      if (maxTokens !== null) {
        toSet[STORAGE_KEY_MAX_TOKENS] = Math.min(
          Math.floor(maxTokens),
          128000
        );
      }

      if (promptKeysRemoveOnSave) {
        toRemove.push(
          STORAGE_KEY_SUMMARY_PROMPT,
          STORAGE_KEY_CHAT_SYSTEM_PROMPT
        );
      } else {
        toSet[STORAGE_KEY_SUMMARY_PROMPT] = summaryPromptTemplate;
        toSet[STORAGE_KEY_CHAT_SYSTEM_PROMPT] = chatSystemPromptTemplate;
      }

      const applyAfterSuccess = () => {
        setUserSummaryProfiles(mergedProfiles);
        userSummaryProfilesRef.current = mergedProfiles;
        const newDraft: Record<string, string> = {};
        for (const p of mergedProfiles) {
          newDraft[p.id] = formatKeywordsCsv(p.keywords);
        }
        keywordsDraftRef.current = newDraft;
        setKeywordsDraftByProfileId(newDraft);
        setHasUnsavedChanges(false);
        setPromptKeysRemoveOnSave(false);
        setSaveInProgress(false);
        logPrdEvent("settings", "6", "click_save_settings", {});
        log.log("saved settings via Save");
        onProviderChange?.(selectedProvider);
        onModelChange?.(selectedModelForSync);
        onClose?.();
      };

      chrome.storage.sync.set(toSet, () => {
        if (chrome.runtime.lastError) {
          log.error("save settings set:", chrome.runtime.lastError.message);
          setCloseBlockedMessage(
            `Could not save settings: ${chrome.runtime.lastError.message}`
          );
          setSaveInProgress(false);
          return;
        }
        if (toRemove.length > 0) {
          chrome.storage.sync.remove(toRemove, () => {
            if (chrome.runtime.lastError) {
              log.error(
                "save settings remove:",
                chrome.runtime.lastError.message
              );
              setCloseBlockedMessage(
                `Saved partially; could not remove old keys: ${chrome.runtime.lastError.message}`
              );
              setSaveInProgress(false);
              return;
            }
            applyAfterSuccess();
          });
        } else {
          applyAfterSuccess();
        }
      });
    });
  }, [
    deferPersistenceWrites,
    selectedProvider,
    validateTabbedSettingsReady,
    userSummaryProfiles,
    keywordsDraftByProfileId,
    maxTokens,
    apiKey,
    customBaseUrl,
    customModel,
    selectedModel,
    metadataHoverEnabled,
    profileFilterHideNonMatchingCompact,
    promptKeysRemoveOnSave,
    summaryPromptTemplate,
    chatSystemPromptTemplate,
    onProviderChange,
    onModelChange,
    onClose,
  ]);

  const handleCloseClick = useCallback(() => {
    if (!onClose) return;
    if (!tabbed) {
      logPrdEvent("settings", "6", "click_close", { tabbed, path: "non_tabbed" });
      flushProfileKeywordDrafts();
      onClose();
      return;
    }

    if (!validateTabbedSettingsReady("close")) {
      return;
    }

    setCloseBlockedMessage(null);
    logPrdEvent("settings", "6", "click_close", {
      tabbed,
      path: "discard_unsaved",
    });
    onClose();
  }, [
    onClose,
    tabbed,
    validateTabbedSettingsReady,
    flushProfileKeywordDrafts,
  ]);

  const handleResetPromptTemplates = () => {
    logPrdEvent("settings", "6", "click_reset_prompt_templates", {});
    const applyDefaults = () => {
      setSummaryPromptTemplate(DEFAULT_SUMMARY_PROMPT_TEMPLATE);
      setChatSystemPromptTemplate(DEFAULT_CHAT_SYSTEM_PROMPT_TEMPLATE);
    };
    if (deferPersistenceWrites) {
      setPromptKeysRemoveOnSave(true);
      applyDefaults();
      markDraftDirty();
    } else {
      chrome.storage.sync.remove(
        [STORAGE_KEY_SUMMARY_PROMPT, STORAGE_KEY_CHAT_SYSTEM_PROMPT],
        () => {
          applyDefaults();
        }
      );
    }
  };

  const extensionVersion = chrome.runtime.getManifest().version;

  const apiFields = (
    <>
      {closeBlockedMessage ? (
        <div className="error-message" role="alert">
          {closeBlockedMessage}
        </div>
      ) : null}

      <div className="settings-section">
        <label htmlFor="ai-provider">AI Provider</label>
        <div className="select-wrapper">
          <select
            id="ai-provider"
            className="model-select"
            value={selectedProvider?.name ?? ""}
            onChange={(e) => {
              const next = providers.find((p) => p.name === e.target.value);
              if (next) handleProviderChange(next);
            }}
          >
            {providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-section">
        <label htmlFor="apiKey">API Key</label>
        <input
          type="password"
          id="apiKey"
          placeholder="Enter your API key"
          className="api-key-input"
          value={apiKey || ""}
          onChange={(e) => {
            const newKey = e.target.value.trim();
            logPrdEvent("settings", "6", "change_api_key", {
              hasValue: newKey.length > 0,
            });
            setCloseBlockedMessage(null);
            if (deferPersistenceWrites) {
              markDraftDirty();
            } else {
              chrome.storage.sync.set({ apiKey: newKey });
            }
            setApiKey(newKey);
            if (tabbed) {
              setAvailableModels([]);
              setModelError(null);
            }
            if (!newKey) {
              setApiKeyError("Please set your API key");
            } else {
              setApiKeyError(null);
              if (!tabbed && selectedProvider?.supportsModelList) {
                handleFetchModels(selectedProvider, newKey);
              }
            }
          }}
        />
      </div>

      {selectedProvider?.isLocal && (
        <div className="settings-section">
          <label htmlFor="baseUrl">Base URL</label>
          <input
            type="text"
            id="baseUrl"
            placeholder={selectedProvider.defaultBaseUrl || "Enter base URL"}
            className="base-url-input"
            value={customBaseUrl}
            onChange={(e) => handleBaseUrlChange(e.target.value.trim())}
          />
          <div className="help-text">
            Default: {selectedProvider.defaultBaseUrl || "None"}
          </div>
        </div>
      )}

      {tabbed ? (
        <div className="settings-section api-tab-update-row">
          <button
            type="button"
            className="api-tab-update-button"
            disabled={
              apiTabRefreshBusy ||
              !selectedProvider ||
              !(
                selectedProvider.supportsModelList &&
                (selectedProvider.isLocal || (apiKey ?? "").trim())
              )
            }
            onClick={() => {
              logPrdEvent("settings", "6", "click_api_tab_update", {});
              markDraftDirty();
              void refreshApiTabData();
            }}
          >
            {apiTabRefreshBusy || isLoadingModels ? "Updating…" : "Update"}
          </button>
          <div className="help-text">
            Loads the provider model list when supported. The API tab does not
            fetch automatically.
          </div>
        </div>
      ) : null}

      {selectedProvider?.requiresModelInput ? (
        <div className="settings-section">
          <label htmlFor="customModel">Model Name</label>
          <input
            type="text"
            id="customModel"
            placeholder="Enter model name"
            className="model-input"
            value={customModel}
            onChange={(e) => handleCustomModelChange(e.target.value.trim())}
          />
        </div>
      ) : (
        selectedProvider?.supportsModelList &&
        (availableModels.length > 0 ? (
          <ModelSelect
            provider={selectedProvider}
            models={availableModels}
            selectedModel={selectedModel}
            isLoading={isLoadingModels}
            allowEmptyOption={tabbed}
            onChange={(modelId) => {
              setCloseBlockedMessage(null);
              setSelectedModel(modelId);
              if (deferPersistenceWrites) {
                markDraftDirty();
              } else {
                chrome.storage.sync.set({ selectedModel: modelId });
              }
              onModelChange?.(modelId);
              logPrdEvent("settings", "6", "change_model_select", {
                modelId: modelId || "(empty)",
              });
            }}
          />
        ) : tabbed ? (
          <div className="settings-section">
            <label className="settings-label" htmlFor="yt-api-model-current">
              AI Model
            </label>
            {(selectedModel ?? "").trim() ? (
              <>
                <input
                  id="yt-api-model-current"
                  readOnly
                  className="api-key-input yt-api-model-saved-display"
                  value={(selectedModel ?? "").trim()}
                  aria-describedby="yt-api-model-pending-hint"
                  title="Saved model — Update refreshes the provider list"
                />
                <p id="yt-api-model-pending-hint" className="help-text">
                  Press <strong>Update</strong> to load models from the provider;
                  your saved selection stays until you pick another after the list loads.
                </p>
              </>
            ) : (
              <p id="yt-api-model-pending-hint" className="help-text">
                Press <strong>Update</strong> to load models from the provider.
              </p>
            )}
          </div>
        ) : null)
      )}

      <div className="settings-section">
        <label htmlFor="maxTokens">Max output tokens</label>
        <input
          type="number"
          id="maxTokens"
          min={1}
          max={128000}
          className="api-key-input"
          placeholder="None"
          value={maxTokens === null ? "" : maxTokens}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              logPrdEvent("settings", "6", "change_max_tokens", { value: "removed" });
              setMaxTokens(null);
              if (deferPersistenceWrites) {
                markDraftDirty();
              } else {
                chrome.storage.sync.remove([STORAGE_KEY_MAX_TOKENS]);
              }
              return;
            }
            const n = Number.parseInt(raw, 10);
            if (!Number.isFinite(n) || n <= 0) return;
            const next = Math.min(n, 128000);
            logPrdEvent("settings", "6", "change_max_tokens", { value: next });
            setMaxTokens(next);
            if (deferPersistenceWrites) {
              markDraftDirty();
            } else {
              chrome.storage.sync.set({ [STORAGE_KEY_MAX_TOKENS]: next });
            }
          }}
        />
        <div className="help-text">
          Leave empty for <strong>None</strong>: omit <code>max_tokens</code> /{" "}
          <code>maxOutputTokens</code> (OpenRouter and others use the provider
          default). Or enter a positive integer (e.g. {DEFAULT_MAX_TOKENS}) to cap
          completion length.
        </div>
      </div>

      {apiKeyError && <div className="error-message">{apiKeyError}</div>}
      {modelError && <div className="warning-message">{modelError}</div>}
    </>
  );

  const promptFields = (
    <>
      <div className="settings-section">
        <label htmlFor="summaryPromptTemplate">Summary (user message)</label>
        <div className="help-text">
          Include <code>{TRANSCRIPT_PLACEHOLDER}</code> where the subtitle
          transcript should be inserted. If it is missing, the transcript is
          appended after your text. Optional <code>{TITLE_PLACEHOLDER}</code>{" "}
          expands to the watch-page video title when you summarize (empty string
          if the title cannot be read).
        </div>
        <textarea
          id="summaryPromptTemplate"
          className="prompt-template-input"
          spellCheck={false}
          value={summaryPromptTemplate}
          onChange={(e) => {
            const v = e.target.value;
            setSummaryPromptTemplate(v);
            setPromptKeysRemoveOnSave(false);
            if (deferPersistenceWrites) {
              markDraftDirty();
            } else {
              chrome.storage.sync.set({ [STORAGE_KEY_SUMMARY_PROMPT]: v });
            }
            logPrdSettingsField("change_summary_prompt", { length: v.length });
          }}
        />
      </div>
      <div className="settings-section">
        <label htmlFor="chatSystemPromptTemplate">Chat (system message)</label>
        <div className="help-text">
          Include <code>{SUMMARY_PLACEHOLDER}</code> where the generated summary
          should appear. If it is missing, the summary is appended after your
          text. Optional <code>{TITLE_PLACEHOLDER}</code> uses the same title as
          when you clicked **Summarize** for **Ask Questions**.
        </div>
        <textarea
          id="chatSystemPromptTemplate"
          className="prompt-template-input"
          spellCheck={false}
          value={chatSystemPromptTemplate}
          onChange={(e) => {
            const v = e.target.value;
            setChatSystemPromptTemplate(v);
            setPromptKeysRemoveOnSave(false);
            if (deferPersistenceWrites) {
              markDraftDirty();
            } else {
              chrome.storage.sync.set({
                [STORAGE_KEY_CHAT_SYSTEM_PROMPT]: v,
              });
            }
            logPrdSettingsField("change_chat_system_prompt", { length: v.length });
          }}
        />
      </div>
      <div className="prompt-reset-row">
        <button
          type="button"
          className="prompt-reset-button"
          onClick={handleResetPromptTemplates}
        >
          Reset prompts to defaults
        </button>
      </div>
    </>
  );

  const addUserProfile = () => {
    logPrdEvent("settings", "6", "click_add_profile", {});
    const newProfile: SummaryUserProfile = {
      id: newUserProfileId(),
      name: "New profile",
      keywords: [],
    };
    setUserSummaryProfiles((prev) => {
      const next = [...prev, newProfile];
      if (!deferPersistenceWrites) {
        chrome.storage.sync.set({ [STORAGE_KEY_SUMMARY_USER_PROFILES]: next });
      }
      return next;
    });
    if (deferPersistenceWrites) {
      markDraftDirty();
      setKeywordsDraftByProfileId((d) => {
        const next = { ...d, [newProfile.id]: "" };
        keywordsDraftRef.current = next;
        return next;
      });
    }
  };

  const deleteUserProfile = (id: string) => {
    logPrdEvent("settings", "6", "click_remove_profile", { profileId: id });
    setUserSummaryProfiles((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (!deferPersistenceWrites) {
        chrome.storage.sync.set({ [STORAGE_KEY_SUMMARY_USER_PROFILES]: next });
      }
      return next;
    });
    if (deferPersistenceWrites) {
      markDraftDirty();
    } else {
      chrome.storage.sync.get(
        [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID],
        (r) => {
          if (r[STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID] === id) {
            chrome.storage.sync.set({
              [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]:
                DEFAULT_SUMMARY_PROFILE_ID,
            });
          }
        }
      );
    }
    setKeywordsDraftByProfileId((d) => {
      const next = { ...d };
      delete next[id];
      keywordsDraftRef.current = next;
      return next;
    });
  };

  const updateUserProfile = (
    id: string,
    patch: Partial<Pick<SummaryUserProfile, "name" | "keywords">>
  ) => {
    logPrdSettingsField("change_profile_field", {
      profileId: id,
      fields: Object.keys(patch),
    });
    setUserSummaryProfiles((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      if (!deferPersistenceWrites) {
        chrome.storage.sync.set({ [STORAGE_KEY_SUMMARY_USER_PROFILES]: next });
      }
      return next;
    });
    if (deferPersistenceWrites) {
      markDraftDirty();
    }
  };

  const profilesFields = tabbed ? (
    <>
      <div className="settings-section">
        <label className="settings-toggle-label">
          <input
            type="checkbox"
            checked={profileFilterHideNonMatchingCompact}
            onChange={(e) => {
              const next = e.target.checked;
              logPrdEvent(
                "settings",
                "6",
                "change_profile_filter_hide_non_matching_compact",
                { profileFilterHideNonMatchingCompact: next }
              );
              setProfileFilterHideNonMatchingCompact(next);
              if (deferPersistenceWrites) {
                markDraftDirty();
              } else {
                chrome.storage.sync.set({
                  [STORAGE_KEY_PROFILE_FILTER_HIDE_NON_MATCHING_COMPACT]: next,
                });
              }
            }}
          />
          <span>Auto-hide</span>
        </label>
        <div className="help-text">
          When a profile with keywords is active, sidebar tiles in the red (no-match) state get a{" "}
          <strong>solid black overlay over the whole recommendation row</strong> (thumbnail + titles,
          metadata, etc.—the compact card stays laid out underneath). Same option appears as{" "}
          <strong>Auto-hide</strong> on the watch-page summarize bar. Off by default.
        </div>
      </div>
      <div className="settings-section">
        <p className="help-text summary-profiles-lead">
          The built-in <strong>{DEFAULT_SUMMARY_PROFILE_DISPLAY_NAME}</strong> profile has no keywords. Add
          profiles with comma- or line-separated keywords; the watch-page{" "}
          <strong>Summarize</strong> bar can pick a profile so those terms get
          extra weight in the summary request.
        </p>
      </div>
      {userSummaryProfiles.map((p) => (
        <div key={p.id} className="settings-section summary-profile-editor">
          <div className="summary-profile-editor-head">
            <span className="summary-profile-editor-title">Custom profile</span>
            <button
              type="button"
              className="summary-profile-remove"
              onClick={() => deleteUserProfile(p.id)}
            >
              Remove
            </button>
          </div>
          <label htmlFor={`profile-name-${p.id}`}>Profile name</label>
          <input
            id={`profile-name-${p.id}`}
            type="text"
            className="api-key-input"
            value={p.name}
            onChange={(e) => updateUserProfile(p.id, { name: e.target.value })}
          />
          <label htmlFor={`profile-kw-${p.id}`}>
            Keywords (comma or line separated)
          </label>
          <textarea
            id={`profile-kw-${p.id}`}
            className="api-key-input summary-profile-keywords"
            rows={8}
            spellCheck={false}
            placeholder={
              "e.g. one term per line, or: rust, wasm, performance tuning"
            }
            value={
              p.id in keywordsDraftByProfileId
                ? keywordsDraftByProfileId[p.id]!
                : formatKeywordsCsv(p.keywords)
            }
            onChange={(e) => {
              const v = e.target.value;
              keywordsDraftRef.current = {
                ...keywordsDraftRef.current,
                [p.id]: v,
              };
              setKeywordsDraftByProfileId((d) => ({ ...d, [p.id]: v }));
              if (deferPersistenceWrites) {
                markDraftDirty();
              }
            }}
            onBlur={(e) => {
              const parsed = parseKeywordsCsv(e.target.value);
              const prev = p.keywords;
              const same =
                parsed.length === prev.length &&
                parsed.every((k, i) => k === prev[i]);
              if (!same) {
                updateUserProfile(p.id, { keywords: parsed });
              }
              const canon = formatKeywordsCsv(parsed);
              setKeywordsDraftByProfileId((d) => {
                const next = { ...d, [p.id]: canon };
                keywordsDraftRef.current = next;
                return next;
              });
            }}
          />
          <div className="help-text">
            Commas and line breaks are kept while you type; keywords commit when you leave
            this field or when you click <strong>Save</strong> (whichever happens first).
          </div>
        </div>
      ))}
      <div className="settings-section">
        <button type="button" className="prompt-reset-button" onClick={addUserProfile}>
          Add profile
        </button>
      </div>
    </>
  ) : null;

  const debugFields = tabbed ? (
    <div className="settings-section">
      <p className="help-text">
        Optional diagnostics and experimental toggles. Leave off unless you
        are debugging link metadata on YouTube.
      </p>
      <label className="settings-toggle-label">
        <input
          type="checkbox"
          checked={metadataHoverEnabled}
          onChange={(e) => {
            const next = e.target.checked;
            logPrdEvent("settings", "6", "change_metadata_hover_enabled", {
              metadataHoverEnabled: next,
            });
            setMetadataHoverEnabled(next);
            if (deferPersistenceWrites) {
              markDraftDirty();
            } else {
              chrome.storage.sync.set({
                [STORAGE_KEY_METADATA_HOVER_ENABLED]: next,
              });
            }
          }}
        />
        <span>Enable metadata hover popup</span>
      </label>
      <div className="help-text">
        When enabled, hovering a video link opens a diagnostic JSON panel. If
        the profile filter already fetched Innertube metadata for that video in
        this tab,
        <code>profile_filter_worker</code> appears first while{" "}
        <code>getBasicInfo</code> resolves into a narrowed <code>basic_info</code> JSON (
        title, keywords, tags, …). Meaningful sidebar tile state appears as{" "}
        <code>extension_profile_filter</code> when disposition / matchVia / matched keywords are meaningful;
        bare <code>kept_no_metadata</code> stubs are omitted.
        Disabled by default.
      </div>
      <div className="settings-section">
        <button
          type="button"
          className="prompt-reset-button"
          onClick={() => {
            logPrdEvent("settings", "6", "open_classifier_test_bench", {});
            void chrome.tabs.create({
              url: chrome.runtime.getURL("test-bench/index.html"),
            });
          }}
        >
          Open classifier test bench
        </button>
      </div>
      <div className="help-text">
        Opens the extension&apos;s classifier test bench (<code>docs/PRD-test-bench.md</code>):
        sample JSON or <strong>Load from YouTube tab</strong> (metadata cache), <strong>Reclassify</strong> against
        <code>finalizeProfileVideoResult</code> (Innertube <code>metadata_exact</code> only). Requires a build with <code>test-bench/</code> under the unpacked folder.
      </div>
    </div>
  ) : null;

  const infoFields = (
    <div className="settings-info-tab">
      <p className="settings-info-lead">
        Open any YouTube video and use <strong>Summarize</strong> (and the
        gear) below the player.
      </p>
      <ChangelogPanel />
      <p className="settings-info-links">
        <a
          href="https://github.com/pbirnie/zonemode"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        {" · "}
        <a
          href="https://github.com/pbirnie/zonemode"
          target="_blank"
          rel="noopener noreferrer"
        >
          Star
        </a>
      </p>
      <p className="settings-info-version" aria-label="Extension version">
        v{extensionVersion}
      </p>
    </div>
  );

  return (
    <div
      className={[
        "zonemode-container",
        tabbed ? "settings-popup-shell" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {tabbed && deferPersistenceWrites ? (
        <>
          <div className="settings-popup-sticky">
            {showHeader && (
              <div className="settings-header">
                <h3>Settings</h3>
                {onClose && (
                  <div className="settings-header-actions">
                    <button
                      type="button"
                      className="settings-popup-save-button"
                      disabled={saveInProgress || !hasUnsavedChanges}
                      onClick={handleSaveClick}
                      aria-label="Save settings"
                    >
                      {saveInProgress ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={handleCloseClick}
                      className="settings-popup-close-button"
                      aria-label="Close settings"
                    >
                      Close
                    </button>
                  </div>
                )}
              </div>
            )}
            <p className="settings-sync-hint">
              <strong>Save</strong> writes settings and closes this popup.{" "}
              <strong>Close</strong> discards edits without saving.
            </p>
            <div
              className="settings-tabs"
              role="tablist"
              aria-label="Settings sections"
            >
              {(
                [
                  ["profiles", "Profiles"],
                  ["api", "API"],
                  ["prompt", "Prompt"],
                  ["debug", "Debug"],
                  ["info", "Info"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  id={`settings-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  aria-controls="settings-tabpanel-main"
                  className={`settings-tab ${
                    activeTab === id ? "settings-tab-active" : ""
                  }`}
                  onClick={() => {
                    logPrdEvent("settings", "6", "click_settings_tab", { tab: id });
                    setActiveTab(id);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-content">
            <div
              id="settings-tabpanel-main"
              className="settings-tab-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeTab}`}
            >
              {activeTab === "api" && apiFields}
              {activeTab === "prompt" && promptFields}
              {activeTab === "profiles" && profilesFields}
              {activeTab === "debug" && debugFields}
              {activeTab === "info" && infoFields}
            </div>
          </div>
        </>
      ) : (
        <>
          {showHeader && (
            <div className="settings-header">
              <h3>AI Provider Settings</h3>
              {onClose && (
                <button
                  type="button"
                  onClick={handleCloseClick}
                  className="close-button"
                  aria-label="Close"
                >
                  ×
                </button>
              )}
            </div>
          )}
          <div className="settings-content">
            {apiFields}
            <details className="prompt-templates-details">
              <summary>Prompt templates</summary>
              {promptFields}
            </details>
          </div>
        </>
      )}
    </div>
  );
};
