import "../content/fetchBindPatch";
import { OFFSCREEN_PORT_NAME } from "../shared/offscreenMessages";
import {
  OFFSCREEN_OP_CLEAR_WORK_CACHES,
  OFFSCREEN_OP_OPENROUTER_COMPLETE,
  OFFSCREEN_OP_PROXY_REQUEST,
} from "../shared/offscreenOps";
import { runOpenRouterComplete } from "./openRouterComplete";

const TAG = "[YT Summary][offscreen]";

type PortMsg = { id: number; op: string; payload?: unknown };

async function dispatch(op: string, payload: unknown): Promise<unknown> {
  switch (op) {
    case OFFSCREEN_OP_CLEAR_WORK_CACHES:
      return null;
    case OFFSCREEN_OP_OPENROUTER_COMPLETE:
      return await runOpenRouterComplete(
        payload as Parameters<typeof runOpenRouterComplete>[0]
      );
    case OFFSCREEN_OP_PROXY_REQUEST: {
      const { url, options } = payload as {
        url: string;
        options?: RequestInit;
      };
      const response = await fetch(url, options);
      const text = await response.text();
      try {
        const data = text.length ? JSON.parse(text) : null;
        return { ok: response.ok, data };
      } catch {
        return {
          ok: false,
          error: "Response was not valid JSON",
          status: response.status,
          preview: text.slice(0, 240),
        };
      }
    }
    default:
      throw new Error(`unknown offscreen op: ${op}`);
  }
}

const port = chrome.runtime.connect({ name: OFFSCREEN_PORT_NAME });

port.onMessage.addListener((msg: PortMsg) => {
  void (async () => {
    try {
      const result = await dispatch(msg.op, msg.payload);
      port.postMessage({ id: msg.id, ok: true, result });
    } catch (e) {
      console.error(TAG, msg.op, e);
      port.postMessage({
        id: msg.id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();
});

console.log(TAG, "offscreen document ready");
