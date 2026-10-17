export type LogLevel = "log" | "warn" | "error";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  args: unknown[];
}

type Listener = (entry: LogEntry) => void;

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
const listeners = new Set<Listener>();

function push(level: LogLevel, tag: string, args: unknown[]) {
  const entry: LogEntry = { ts: Date.now(), level, tag, args };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();

  const prefix = `[YT Summary][${tag}]`;
  switch (level) {
    case "error":
      console.error(prefix, ...args);
      break;
    case "warn":
      console.warn(prefix, ...args);
      break;
    default:
      console.log(prefix, ...args);
  }

  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      /* listener threw — ignore */
    }
  }
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getEntries(): readonly LogEntry[] {
  return entries;
}

export function createLogger(tag: string) {
  return {
    log: (...args: unknown[]) => push("log", tag, args),
    warn: (...args: unknown[]) => push("warn", tag, args),
    error: (...args: unknown[]) => push("error", tag, args),
  };
}
