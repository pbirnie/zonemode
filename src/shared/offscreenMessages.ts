/** Content/popup → background → offscreen RPC envelope. */
export const OFFSCREEN_RPC = "OFFSCREEN_RPC" as const;

export type OffscreenRpcMessage = {
  type: typeof OFFSCREEN_RPC;
  op: string;
  payload?: unknown;
};

/** Background `chrome.runtime.Port` name for the offscreen document. */
export const OFFSCREEN_PORT_NAME = "yt-sum-offscreen";

/**
 * Watch-page / extension-page → background RPC for **`forwardToOffscreen`**.
 * Uses **`chrome.runtime.connect`** so slow ops (Transformers batch classify) do not hit MV3
 * **`sendMessage`** channel timeouts (“message channel closed before a response was received”).
 */
export const CONTENT_OFFSCREEN_RPC_PORT_NAME = "yt-sum-content-offscreen-rpc";
