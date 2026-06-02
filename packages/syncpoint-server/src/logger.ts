/**
 * Structured logger for SyncPoint server.
 *
 * Lightweight implementation that outputs JSON-structured logs
 * with trace correlation, log levels, and redaction support.
 * No external dependency required.
 */

import { getTraceId } from "./trace.js";

// ── Log levels ─────────────────────────────────────────

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug";

const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

function resolveLevel(): LogLevel {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LOG_LEVEL_RANK) return env as LogLevel;
  if (process.env.NODE_ENV === "production") return "info";
  if (process.env.NODE_ENV === "test") return "warn";
  return "debug";
}

const currentLevel = resolveLevel();

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[currentLevel];
}

// ── Redaction ──────────────────────────────────────────

const REDACT_KEYS = new Set([
  "authorization", "cookie", "set-cookie", "x-api-key",
  "token", "secret", "password", "credential",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = redact(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Core log function ──────────────────────────────────

export interface LogEntry {
  level: LogLevel;
  msg: string;
  traceId?: string;
  timestamp: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const entry: LogEntry = {
    level,
    msg,
    timestamp: new Date().toISOString(),
  };

  const tid = getTraceId();
  if (tid) entry.traceId = tid;

  if (extra) {
    const safe = redact(extra);
    Object.assign(entry, safe);
  }

  const output = JSON.stringify(entry);

  if (level === "error" || level === "fatal") {
    process.stderr.write(output + "\n");
  } else {
    process.stdout.write(output + "\n");
  }
}

// ── Public API ─────────────────────────────────────────

export const logger = {
  debug(msg: string, extra?: Record<string, unknown>) { emit("debug", msg, extra); },
  info(msg: string, extra?: Record<string, unknown>) { emit("info", msg, extra); },
  warn(msg: string, extra?: Record<string, unknown>) { emit("warn", msg, extra); },
  error(msg: string, extra?: Record<string, unknown>) { emit("error", msg, extra); },
  fatal(msg: string, extra?: Record<string, unknown>) { emit("fatal", msg, extra); },

  /** Create a child logger with pre-bound context fields. */
  child(bindings: Record<string, unknown>) {
    return {
      debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, { ...bindings, ...extra }),
      info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, { ...bindings, ...extra }),
      warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, { ...bindings, ...extra }),
      error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, { ...bindings, ...extra }),
      fatal: (msg: string, extra?: Record<string, unknown>) => emit("fatal", msg, { ...bindings, ...extra }),
    };
  },

  /** Current log level. */
  get level(): LogLevel { return currentLevel; },
};
