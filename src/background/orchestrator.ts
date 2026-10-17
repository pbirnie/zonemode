/**
 * MV3: long-loaded work runs in the offscreen document. The service worker only
 * routes messages between tabs/popup and that document — no fetch/OpenRouter/ORT here.
 */

import { logPrdEvent } from "../shared/prdEventLog";
import {
  CONTENT_OFFSCREEN_RPC_PORT_NAME,
  OFFSCREEN_PORT_NAME,
  OFFSCREEN_RPC,
  type OffscreenRpcMessage,
} from "../shared/offscreenMessages";

const TAG = "[YT Summary][orchestrate]";
const OFFSCREEN_PATH = "offscreen/offscreen.html";

let offscreenPort: chrome.runtime.Port | null = null;
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();
let nextRpcId = 0;

type ContentOffscreenRpcPortMsg = {
  seq: number;
  op: string;
  payload?: unknown;
};

function wireContentToBackgroundOffscreenRpc(port: chrome.runtime.Port): void {
  port.onMessage.addListener((msg: unknown) => {
    const m = msg as Partial<ContentOffscreenRpcPortMsg>;
    if (typeof m.seq !== "number" || typeof m.op !== "string") {
      port.postMessage({
        seq: typeof m.seq === "number" ? m.seq : -1,
        ok: false,
        error: "invalid OFFSCREEN_RPC port envelope",
      });
      return;
    }

    logPrdEvent("background", "7", "OFFSCREEN_RPC_PORT", { op: m.op });
    void (async () => {
      try {
        const result = await forwardToOffscreen(m.op, m.payload);
        port.postMessage({ seq: m.seq, ok: true, result });
      } catch (e) {
        console.error(TAG, m.op, e);
        port.postMessage({
          seq: m.seq,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === CONTENT_OFFSCREEN_RPC_PORT_NAME) {
    wireContentToBackgroundOffscreenRpc(port);
    return;
  }

  if (port.name !== OFFSCREEN_PORT_NAME) return;
  offscreenPort = port;
  logPrdEvent("background", "7", "offscreen_port_connected", {});
  port.onMessage.addListener(
    (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? "offscreen error"));
    }
  );
  port.onDisconnect.addListener(() => {
    offscreenPort = null;
    logPrdEvent("background", "7", "offscreen_port_disconnect", {});
  });
});

async function waitForPort(totalMs: number): Promise<void> {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (offscreenPort) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("offscreen port did not connect in time");
}

async function ensureOffscreenDocument(): Promise<void> {
  const has = await chrome.offscreen.hasDocument();
  if (has && offscreenPort) return;

  if (has && !offscreenPort) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      // Race: hasDocument vs. teardown — close rejects "No current offscreen document."
      console.warn(TAG, "closeDocument:", e);
    }
  }

  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL(OFFSCREEN_PATH),
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification:
      "Run OpenRouter / proxy fetch without putting dynamic fetch or heavyweight clients in the MV3 service worker.",
  });
  await waitForPort(12000);
  if (!offscreenPort) {
    throw new Error("offscreen connected but port missing");
  }
}

export async function forwardToOffscreen<T>(
  op: string,
  payload?: unknown
): Promise<T> {
  await ensureOffscreenDocument();
  if (!offscreenPort) {
    throw new Error("offscreen port unavailable");
  }
  const id = ++nextRpcId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (v: unknown) => void,
      reject,
    });
    try {
      offscreenPort!.postMessage({ id, op, payload });
    } catch (e) {
      pending.delete(id);
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Handle `OFFSCREEN_RPC` from extension pages / content / popup: return structured `{ ok, result }`. */
export function handleOffscreenRpc(
  request: OffscreenRpcMessage,
  sendResponse: (r: unknown) => void
): boolean {
  logPrdEvent("background", "7", "OFFSCREEN_RPC", { op: request.op });
  void (async () => {
    try {
      const result = await forwardToOffscreen(request.op, request.payload);
      sendResponse({ ok: true, result });
    } catch (e) {
      console.error(TAG, request.op, e);
      sendResponse({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
  return true;
}

export function isOffscreenRpc(
  request: unknown
): request is OffscreenRpcMessage {
  return (
    typeof request === "object" &&
    request !== null &&
    (request as OffscreenRpcMessage).type === OFFSCREEN_RPC
  );
}
