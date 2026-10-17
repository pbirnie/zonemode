import "./fetchBindPatch";
import "./testBenchBridge";
import React from "react";
import { createRoot } from "react-dom/client";
import { SummaryButton } from "./components/SummaryButton";
import { createLogger } from "../shared/logger";
import { logPrdEvent } from "../shared/prdEventLog";
import {
  isExtensionContextInvalidatedError,
  isExtensionContextValid,
  safeRuntimeSendMessage,
} from "../shared/extensionContext";
import { initVideoLinkMetadataTooltips } from "./videoLinkTooltips";
import { initVideoProfileFilter } from "./videoProfileFilter";

const log = createLogger("content");
const BUTTON_CONTAINER_ID = "zonemode-extension-container";

/** Max wait per attempt for `#above-the-fold` + primary player readiness; then mount anyway (if fold exists). */
const INJECTION_READY_TIMEOUT_MS = 3000;

let injectAttemptGeneration = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitTwoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function findPrimaryWatchVideo(): HTMLVideoElement | null {
  const candidates = [
    document.querySelector("#movie_player video"),
    document.querySelector("ytd-player video"),
    document.querySelector("#above-the-fold video"),
  ];
  for (const el of candidates) {
    if (el instanceof HTMLVideoElement) return el;
  }
  return null;
}

/** Prefer first decoded frame / can-play; never exceed `deadlineMs`. */
async function waitForWatchPlayerPaintSignal(deadlineMs: number): Promise<void> {
  if (deadlineMs <= 0) return;
  const video = findPrimaryWatchVideo();
  if (!video) {
    await Promise.race([waitTwoAnimationFrames(), sleep(deadlineMs)]);
    return;
  }
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    await Promise.race([waitTwoAnimationFrames(), sleep(deadlineMs)]);
    return;
  }
  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => resolve();
      video.addEventListener("loadeddata", done, { once: true });
      video.addEventListener("canplay", done, { once: true });
    }),
    sleep(deadlineMs),
  ]);
  await waitTwoAnimationFrames();
}

/**
 * Prefer mounting **below** **`ytd-watch-metadata`** inside `#above-the-fold`.
 * Inserting as the fold’s **first child** sits under the cinematic player/grid overlap on some layouts,
 * so the summarize UI can look hidden until unrelated hover/layout reflow.
 */
function ensureSummaryContainerMounted(aboveTheFold: HTMLElement): HTMLDivElement {
  let container = document.getElementById(
    BUTTON_CONTAINER_ID
  ) as HTMLDivElement | null;
  const created = container == null;
  if (!container) {
    container = document.createElement("div");
    container.id = BUTTON_CONTAINER_ID;
  }

  const metadataEl = aboveTheFold.querySelector("ytd-watch-metadata");
  if (metadataEl instanceof HTMLElement) {
    const ok = container.previousElementSibling === metadataEl;
    if (!ok) {
      metadataEl.insertAdjacentElement("afterend", container);
      if (created) {
        log.log("injected container after ytd-watch-metadata");
        logPrdEvent("content", "2", "injectSummaryButton_container_created", {
          placement: "after_watch_metadata",
        });
      } else {
        log.log("repositioned extension container after ytd-watch-metadata");
        logPrdEvent("content", "2", "injectSummaryButton_container_repositioned", {
          placement: "after_watch_metadata",
        });
      }
    }
    return container;
  }

  if (aboveTheFold.firstChild !== container) {
    aboveTheFold.insertBefore(container, aboveTheFold.firstChild);
    if (created) {
      log.log(
        "injected container as first child of #above-the-fold (no ytd-watch-metadata)"
      );
      logPrdEvent("content", "2", "injectSummaryButton_container_created", {
        placement: "above_the_fold_first_child",
      });
    } else {
      log.log(
        "repositioned extension container as first child of #above-the-fold"
      );
      logPrdEvent("content", "2", "injectSummaryButton_container_repositioned", {
        placement: "above_the_fold_first_child",
      });
    }
  }

  return container;
}

function mountSummaryButtonIntoFold(aboveTheFold: HTMLElement): void {
  if (!isExtensionContextValid()) return;

  const container = ensureSummaryContainerMounted(aboveTheFold);

  if (!container.hasAttribute("data-root-initialized")) {
    const root = createRoot(container);
    container.setAttribute("data-root-initialized", "true");
    root.render(React.createElement(SummaryButton));
    log.log("React root mounted");
    logPrdEvent("content", "2", "injectSummaryButton_react_root_mounted", {});
  }
}

async function scheduleInjectSummaryButton(): Promise<void> {
  if (!isExtensionContextValid()) return;

  if (!window.location.pathname.includes("/watch")) {
    log.log("not a /watch page, skipping injection");
    logPrdEvent("content", "2", "injectSummaryButton_skip_not_watch", {
      path: window.location.pathname,
    });
    return;
  }

  const gen = ++injectAttemptGeneration;
  const deadline = Date.now() + INJECTION_READY_TIMEOUT_MS;

  logPrdEvent("content", "2", "injectSummaryButton_schedule", {
    timeoutMs: INJECTION_READY_TIMEOUT_MS,
  });

  while (gen === injectAttemptGeneration) {
    if (!window.location.pathname.includes("/watch")) {
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      const fold = document.getElementById("above-the-fold");
      if (fold) {
        mountSummaryButtonIntoFold(fold);
        logPrdEvent("content", "2", "injectSummaryButton_deadline_mount", {});
      } else {
        log.log("#above-the-fold not within injection deadline, retrying");
        logPrdEvent("content", "2", "injectSummaryButton_retry_above_the_fold", {});
        setTimeout(scheduleInjectSummaryButton, 1000);
      }
      return;
    }

    const aboveTheFold = document.getElementById("above-the-fold");
    if (!aboveTheFold) {
      await sleep(Math.min(100, remaining));
      continue;
    }

    await waitForWatchPlayerPaintSignal(remaining);

    if (gen !== injectAttemptGeneration) return;

    mountSummaryButtonIntoFold(aboveTheFold);
    logPrdEvent("content", "2", "injectSummaryButton_ready_mount", {});
    return;
  }
}

window.addEventListener("unhandledrejection", (ev) => {
  if (isExtensionContextInvalidatedError(ev.reason)) {
    ev.preventDefault();
  }
});

log.log("content script loaded", window.location.href);
logPrdEvent("content", "1", "content_script_injected", {
  href: window.location.href,
});
initVideoLinkMetadataTooltips();
initVideoProfileFilter();
void scheduleInjectSummaryButton();

safeRuntimeSendMessage({ type: "CONTENT_SCRIPT_LOADED" });

window.addEventListener("yt-navigate-finish", () => {
  log.log("yt-navigate-finish →", window.location.href);
  logPrdEvent("content", "1", "yt-navigate-finish", {
    href: window.location.href,
  });
  void scheduleInjectSummaryButton();
});
