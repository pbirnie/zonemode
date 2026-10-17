import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  subscribe,
  getEntries,
  type LogEntry,
  type LogLevel,
} from "../../shared/logger";

const LEVEL_COLORS: Record<LogLevel, string> = {
  log: "#9ca3af",
  warn: "#facc15",
  error: "#ef4444",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-GB", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function stringify(val: unknown): string {
  if (val instanceof Error) return val.message;
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, null, 0);
  } catch {
    return String(val);
  }
}

function isNearBottom(el: HTMLDivElement, thresholdPx = 80): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < thresholdPx;
}

export const LogPanel: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>(() => [...getEntries()]);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    return subscribe((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(-500) : next;
      });
    });
  }, []);

  /** Opening the panel: jump to latest once (do not use scrollIntoView — it scrolls the page). */
  useEffect(() => {
    if (open && !wasOpenRef.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
    wasOpenRef.current = open;
  }, [open]);

  /** New log lines: only auto-scroll the panel if the user was already near the bottom. */
  useEffect(() => {
    if (!open || !bodyRef.current) return;
    const el = bodyRef.current;
    if (isNearBottom(el)) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, open]);

  const clearLogs = useCallback(() => setLogs([]), []);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="log-panel-toggle"
        title="Show debug log"
      >
        Log ({logs.length})
      </button>
    );
  }

  return (
    <div className="log-panel">
      <div className="log-panel-header">
        <span className="log-panel-title">Debug Log</span>
        <div className="log-panel-actions">
          <button onClick={clearLogs} className="log-panel-btn">
            Clear
          </button>
          <button onClick={() => setOpen(false)} className="log-panel-btn">
            ×
          </button>
        </div>
      </div>
      <div className="log-panel-body" ref={bodyRef}>
        {logs.length === 0 && (
          <div className="log-panel-empty">No log entries yet.</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="log-panel-line">
            <span className="log-panel-time">{formatTime(entry.ts)}</span>
            <span
              className="log-panel-level"
              style={{ color: LEVEL_COLORS[entry.level] }}
            >
              {entry.level.toUpperCase().padEnd(5)}
            </span>
            <span className="log-panel-tag">[{entry.tag}]</span>
            <span className="log-panel-msg">
              {entry.args.map(stringify).join(" ")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
