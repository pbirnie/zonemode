/** Chrome throws this after the extension is reloaded while a tab keeps the old content script. */
export const EXTENSION_CONTEXT_INVALIDATED = "Extension context invalidated";

export function isExtensionContextInvalidatedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes(EXTENSION_CONTEXT_INVALIDATED);
}

/** `chrome.runtime.id` is cleared when the extension context is invalidated. */
export function isExtensionContextValid(): boolean {
  try {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

export function getExtensionUrl(path: string): string | null {
  if (!isExtensionContextValid()) return null;
  try {
    return chrome.runtime.getURL(path);
  } catch (e) {
    if (isExtensionContextInvalidatedError(e)) return null;
    throw e;
  }
}

/**
 * MV3 `sendMessage` without a callback returns a Promise that rejects when the
 * context is invalidated — always attach a callback or `.catch()`.
 */
export function safeRuntimeSendMessage(
  message: unknown,
  responseCallback?: (response: unknown) => void
): void {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? "";
        if (msg.includes(EXTENSION_CONTEXT_INVALIDATED)) return;
      }
      responseCallback?.(response);
    });
  } catch (e) {
    if (!isExtensionContextInvalidatedError(e)) throw e;
  }
}

export function safeStorageSyncGet(
  keys: string[] | string | null,
  onResult: (result: Record<string, unknown>) => void
): void {
  if (!isExtensionContextValid()) return;
  try {
    chrome.storage.sync.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        const msg = chrome.runtime.lastError.message ?? "";
        if (msg.includes(EXTENSION_CONTEXT_INVALIDATED)) return;
      }
      onResult(result);
    });
  } catch (e) {
    if (!isExtensionContextInvalidatedError(e)) throw e;
  }
}
