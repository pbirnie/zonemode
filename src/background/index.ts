import {
  forwardToOffscreen,
  handleOffscreenRpc,
  isOffscreenRpc,
} from "./orchestrator";
import { defaultAiProvider } from "../shared/config";
import { logPrdEvent } from "../shared/prdEventLog";
import {
  INSTALL_DEFAULT_SUMMARY_PROFILE_ID,
  INSTALL_DEFAULT_SUMMARY_PROFILES,
  STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID,
  STORAGE_KEY_SUMMARY_USER_PROFILES,
} from "../shared/summaryProfiles";
import {
  TEST_BENCH_GET_METADATA_SNAPSHOT,
  type TestBenchGetMetadataSnapshotBgResponse,
  type TestBenchGetMetadataSnapshotContentResponse,
} from "../shared/testBenchMessages";

const TAG = "[YT Summary][bg]";

/** Fallback settings UI (`chrome.windows.create`); toolbar popup uses `chrome.action.openPopup`. */
const SETTINGS_POPUP_PAGE = "popup/index.html";

let trackedSettingsPopupWindowId: number | undefined;

let openSettingsUiChain: Promise<void> = Promise.resolve();

function settingsPopupDocumentUrl(): string {
  return chrome.runtime.getURL(SETTINGS_POPUP_PAGE);
}

function tabLoadsSettingsPopup(url: string | undefined): boolean {
  if (!url) return false;
  const expected = settingsPopupDocumentUrl();
  return (
    url === expected ||
    url.startsWith(`${expected}#`) ||
    url.startsWith(`${expected}?`)
  );
}

async function focusExistingSettingsPopupWindow(): Promise<boolean> {
  try {
    if (trackedSettingsPopupWindowId != null) {
      try {
        await chrome.windows.get(trackedSettingsPopupWindowId);
        await chrome.windows.update(trackedSettingsPopupWindowId, {
          focused: true,
        });
        return true;
      } catch {
        trackedSettingsPopupWindowId = undefined;
      }
    }

    const wins = await chrome.windows.getAll({ populate: true });
    for (const win of wins) {
      const tab = win.tabs?.[0];
      const url = tab?.url ?? tab?.pendingUrl;
      if (!tabLoadsSettingsPopup(url)) continue;
      const wid = win.id;
      if (wid == null) continue;
      trackedSettingsPopupWindowId = wid;
      await chrome.windows.update(wid, { focused: true });
      return true;
    }
  } catch (e) {
    console.warn(TAG, "focusExistingSettingsPopupWindow:", e);
  }
  return false;
}

function enqueueOpenSettingsUi(task: () => Promise<void>): void {
  openSettingsUiChain = openSettingsUiChain.then(task).catch((e) => {
    console.error(TAG, "OPEN_SETTINGS_UI queued handler:", e);
  });
}

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === trackedSettingsPopupWindowId) {
    trackedSettingsPopupWindowId = undefined;
  }
});

async function handleOpenSettingsUi(
  sender: chrome.runtime.MessageSender,
  sendResponse: (r: unknown) => void
): Promise<void> {
  const browserWindowId = sender.tab?.windowId;
  try {
    if (await focusExistingSettingsPopupWindow()) {
      sendResponse({ ok: true, method: "focus_existing_window" });
      return;
    }

    try {
      if (typeof chrome.action?.openPopup === "function") {
        await chrome.action.openPopup(
          browserWindowId !== undefined ? { windowId: browserWindowId } : undefined
        );
        sendResponse({ ok: true, method: "openPopup" });
        return;
      }
    } catch (e) {
      console.warn(TAG, "openPopup failed, falling back to window:", e);
    }

    if (await focusExistingSettingsPopupWindow()) {
      sendResponse({ ok: true, method: "focus_existing_window" });
      return;
    }

    const created = await chrome.windows.create({
      url: settingsPopupDocumentUrl(),
      type: "popup",
      width: 500,
      height: 720,
      focused: true,
    });
    if (created.id != null) {
      trackedSettingsPopupWindowId = created.id;
    }
    sendResponse({ ok: true, method: "windows.create" });
  } catch (e2) {
    console.error(TAG, "OPEN_SETTINGS_UI failed:", e2);
    sendResponse({
      ok: false,
      error: e2 instanceof Error ? e2.message : String(e2),
    });
  }
}

async function relayTestBenchMetadataSnapshot(): Promise<TestBenchGetMetadataSnapshotBgResponse> {
  const youtubeTabs = await chrome.tabs.query({
    url: ["*://*.youtube.com/*", "*://youtube.com/*"],
  });
  if (youtubeTabs.length === 0) {
    return {
      ok: false,
      error:
        "No open YouTube tab found. Open youtube.com in a normal tab and try again.",
    };
  }

  const active = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  const activeTab = active[0];
  let chosen = youtubeTabs.find((t) => t.id === activeTab?.id);
  if (!chosen) {
    chosen =
      youtubeTabs.find((t) => (t.url ?? "").includes("/watch")) ?? youtubeTabs[0];
  }
  const tabId = chosen?.id;
  if (tabId == null) {
    return { ok: false, error: "Could not resolve a YouTube tab id." };
  }

  try {
    const raw = await chrome.tabs.sendMessage(tabId, {
      type: TEST_BENCH_GET_METADATA_SNAPSHOT,
    });
    const res = raw as TestBenchGetMetadataSnapshotContentResponse;
    if (!res || typeof res !== "object") {
      return {
        ok: false,
        error:
          "Invalid response from content script — try refreshing the YouTube tab.",
      };
    }
    if (!res.ok) {
      return { ok: false, error: res.error ?? "Content script error" };
    }
    return {
      ok: true,
      rows: res.rows,
      tabId,
      tabUrl: chosen.url,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Could not read the metadata cache on that tab (${detail}). Refresh the YouTube page so the extension content script loads.`,
    };
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  const version = chrome.runtime.getManifest().version;
  console.log(TAG, "installed", { reason: details.reason, version });
  logPrdEvent("background", "7", "chrome.runtime.onInstalled", {
    reason: details.reason,
    version,
  });
  if (details.reason !== "install") return;
  const provider = defaultAiProvider();
  chrome.storage.sync.set(
    {
      [STORAGE_KEY_SUMMARY_USER_PROFILES]: INSTALL_DEFAULT_SUMMARY_PROFILES,
      [STORAGE_KEY_SELECTED_SUMMARY_PROFILE_ID]:
        INSTALL_DEFAULT_SUMMARY_PROFILE_ID,
      selectedProvider: provider,
      selectedModel: provider.model,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error(
          TAG,
          "install default profile failed:",
          chrome.runtime.lastError.message
        );
        return;
      }
      console.log(TAG, "install default profiles", {
        selectedId: INSTALL_DEFAULT_SUMMARY_PROFILE_ID,
        names: INSTALL_DEFAULT_SUMMARY_PROFILES.map((p) => p.name),
      });
    }
  );
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (isOffscreenRpc(request)) {
    return handleOffscreenRpc(request, sendResponse);
  }

  if (request.type === "GET_SETTINGS") {
    console.log(TAG, "GET_SETTINGS");
    logPrdEvent("background", "7", "onMessage_GET_SETTINGS", {});
    chrome.storage.sync.get(["apiKey", "selectedProvider"], (result) => {
      if (chrome.runtime.lastError) {
        console.error(
          TAG,
          "GET_SETTINGS error:",
          chrome.runtime.lastError.message
        );
        sendResponse({
          error: chrome.runtime.lastError.message,
        });
        return;
      }
      console.log(TAG, "GET_SETTINGS →", {
        hasApiKey: !!result.apiKey,
        provider: result.selectedProvider?.name,
      });
      sendResponse(result);
    });
    return true;
  }

  if (request.type === "OPEN_SETTINGS_UI") {
    logPrdEvent("background", "7", "onMessage_OPEN_SETTINGS_UI", {
      tabId: sender.tab?.id,
    });
    enqueueOpenSettingsUi(async () => {
      await handleOpenSettingsUi(sender, sendResponse);
    });
    return true;
  }

  if (request.type === "OPENROUTER_COMPLETE") {
    const { messages, model, apiKey, system, maxTokens: maxTokensRaw } =
      request;
    logPrdEvent("background", "7", "onMessage_OPENROUTER_COMPLETE", {
      model,
      messageCount: messages?.length,
      hasApiKey: !!apiKey,
    });
    console.log(TAG, "OpenRouter complete → forwarding to offscreen", {
      model,
      messageCount: messages?.length,
      hasApiKey: !!apiKey,
    });
    void (async () => {
      try {
        const result = await forwardToOffscreen<{
          text: string;
          costUsd?: number;
        }>("OPENROUTER_COMPLETE", {
          messages,
          ...(typeof system === "string" && system.length > 0
            ? { system }
            : {}),
          model,
          apiKey,
          ...(typeof maxTokensRaw === "number"
            ? { maxTokens: maxTokensRaw }
            : {}),
        });
        console.log(TAG, "OpenRouter complete ok (offscreen)", {
          chars: result?.text?.length ?? 0,
          costUsd: result?.costUsd,
        });
        sendResponse({
          ok: true,
          text: result.text,
          costUsd: result.costUsd,
        });
      } catch (error: unknown) {
        const detail =
          error instanceof Error ? error.message : String(error);
        console.error(TAG, "OpenRouter complete failed:", detail);
        sendResponse({ ok: false, error: detail });
      }
    })();
    return true;
  }

  if (request.type === "CONTENT_SCRIPT_LOADED") {
    logPrdEvent("background", "7", "onMessage_CONTENT_SCRIPT_LOADED", {
      tabId: sender.tab?.id,
    });
    return false;
  }

  if (request.type === TEST_BENCH_GET_METADATA_SNAPSHOT) {
    void (async () => {
      const out = await relayTestBenchMetadataSnapshot();
      sendResponse(out);
    })();
    return true;
  }

  if (request.type === "PROXY_REQUEST") {
    const { url, options } = request;
    logPrdEvent("background", "7", "onMessage_PROXY_REQUEST", {
      url: typeof url === "string" ? url.slice(0, 200) : "(non-string)",
      method: options?.method ?? "GET",
    });
    console.log(TAG, "PROXY_REQUEST → offscreen", url);

    void (async () => {
      try {
        const response = await forwardToOffscreen<{
          ok?: boolean;
          data?: unknown;
          error?: string;
          status?: number;
          preview?: string;
        }>("PROXY_REQUEST", { url, options });
        sendResponse(response);
      } catch (error) {
        console.error(TAG, "proxy via offscreen failed:", error);
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return true;
  }

  return false;
});
