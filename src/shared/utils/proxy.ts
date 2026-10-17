import { createLogger } from "../logger";

const log = createLogger("proxy");

function extractHttpErrorMessage(response: {
  ok?: boolean;
  error?: string;
  data?: unknown;
  status?: number;
  preview?: string;
}): string {
  if (typeof response.error === "string" && response.error) {
    return response.error;
  }
  const data = response.data as
    | { error?: { message?: string }; message?: string }
    | undefined;
  const fromBody =
    data?.error?.message ?? data?.message;
  if (typeof fromBody === "string" && fromBody) {
    return fromBody;
  }
  if (typeof response.status === "number") {
    return `Request failed with status ${response.status}`;
  }
  return "Request failed";
}

export async function proxyFetch(url: string, options: RequestInit = {}) {
  log.log("proxyFetch →", url);
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "PROXY_REQUEST", url, options },
      (response) => {
        if (chrome.runtime.lastError) {
          log.error("runtime error:", chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
          return;
        }
        if (!response.ok) {
          const msg = extractHttpErrorMessage(response);
          log.error("request failed:", msg);
          reject(new Error(msg));
          return;
        }
        log.log("proxyFetch response ok");
        resolve(response.data);
      }
    );
  });
}
