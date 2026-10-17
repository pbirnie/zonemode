import {
  isExtensionContextInvalidatedError,
  isExtensionContextValid,
} from "./extensionContext";
import { CONTENT_OFFSCREEN_RPC_PORT_NAME } from "./offscreenMessages";

/** Extension page / content / popup → background → offscreen (`orchestrator.ts`). */
let rpcSeq = 0;

export async function extensionCallOffscreen<T>(
  op: string,
  payload?: unknown
): Promise<T> {
  if (!isExtensionContextValid()) {
    throw new Error("Extension context invalidated");
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const seq = ++rpcSeq;
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: CONTENT_OFFSCREEN_RPC_PORT_NAME });
    } catch (e) {
      if (isExtensionContextInvalidatedError(e)) {
        reject(new Error("Extension context invalidated"));
        return;
      }
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const settleOk = (result: unknown) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      resolve(result as T);
    };

    const settleErr = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        port.disconnect();
      } catch {
        /* ignore */
      }
      reject(err);
    };

    port.onMessage.addListener(
      (response: {
        seq?: number;
        ok?: boolean;
        result?: unknown;
        error?: string;
      }) => {
        if (response.seq !== seq) return;
        if (!response.ok) {
          settleErr(new Error(response.error || "offscreen RPC failed"));
        } else {
          settleOk(response.result);
        }
      }
    );

    port.onDisconnect.addListener(() => {
      settleErr(
        new Error(
          chrome.runtime.lastError?.message ??
            "Extension message port disconnected before offscreen RPC completed"
        )
      );
    });

    try {
      port.postMessage({ seq, op, payload });
    } catch (e) {
      settleErr(
        isExtensionContextInvalidatedError(e)
          ? new Error("Extension context invalidated")
          : e instanceof Error
            ? e
            : new Error(String(e))
      );
    }
  });
}

export function extensionFireAndForgetOffscreen(
  op: string,
  payload?: unknown
): void {
  void extensionCallOffscreen(op, payload).catch(() => {});
}
