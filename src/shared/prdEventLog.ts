import { createLogger } from "./logger";

/** Set to `true` only while debugging against PRD.md event flows. */
const PRD_LOGGING_ENABLED = false;

/**
 * Logs one line per product event (see PRD.md). Filter the Log panel by `prd`.
 * Disabled by default (`PRD_LOGGING_ENABLED`).
 */
export function logPrdEvent(
  tag: string,
  prdSection: string,
  event: string,
  detail?: Record<string, unknown>
): void {
  if (!PRD_LOGGING_ENABLED) return;
  const log = createLogger(tag);
  const payload: Record<string, unknown> = { prd: true, prdSection, event };
  if (detail) Object.assign(payload, detail);
  log.log("prd", payload);
}
