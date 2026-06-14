import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Lightweight structured logger
// ---------------------------------------------------------------------------

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  child(prefix: string): Logger;
}

function formatEntry(
  level: Level,
  message: string,
  prefix: string | undefined,
  context: Record<string, unknown> | undefined,
): string {
  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    ...(prefix ? { prefix } : {}),
    msg: message,
    ...(context ?? {}),
  };
  return JSON.stringify(entry);
}

function shouldLog(messageLevel: Level, threshold: Level): boolean {
  return LEVELS[messageLevel] >= LEVELS[threshold];
}

export function createLogger(level: Level, logFile?: string): Logger {
  function write(formatted: string): void {
    process.stdout.write(formatted + "\n");
    if (logFile) {
      try {
        mkdirSync(dirname(logFile), { recursive: true });
        appendFileSync(logFile, formatted + "\n", "utf-8");
      } catch {
        // best-effort file logging — don't crash the runner
      }
    }
  }

  function make(prefix?: string): Logger {
    return {
      debug(msg, ctx) {
        if (shouldLog("debug", level)) write(formatEntry("debug", msg, prefix, ctx));
      },
      info(msg, ctx) {
        if (shouldLog("info", level)) write(formatEntry("info", msg, prefix, ctx));
      },
      warn(msg, ctx) {
        if (shouldLog("warn", level)) write(formatEntry("warn", msg, prefix, ctx));
      },
      error(msg, ctx) {
        if (shouldLog("error", level)) write(formatEntry("error", msg, prefix, ctx));
      },
      child(childPrefix: string) {
        const combined = prefix ? `${prefix}:${childPrefix}` : childPrefix;
        return make(combined);
      },
    };
  }

  return make();
}
