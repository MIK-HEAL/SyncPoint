/**
 * Request tracing via AsyncLocalStorage.
 *
 * Provides automatic trace ID propagation across async contexts
 * without explicit parameter threading. Each tRPC request gets a
 * unique traceId that flows through middleware → service → repository → DB.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

// ── Trace context ──────────────────────────────────────

export interface TraceContext {
  traceId: string;
  /** Optional: caller identity for audit trail */
  callerId?: string;
  /** Optional: operation label for metrics */
  operation?: string;
}

const storage = new AsyncLocalStorage<TraceContext>();

// ── Public API ─────────────────────────────────────────

/**
 * Run a function within a new trace context.
 * If no traceId is provided, generates a new one.
 */
export function withTrace<T>(
  fn: () => T,
  opts?: { traceId?: string; callerId?: string; operation?: string },
): T {
  const ctx: TraceContext = {
    traceId: opts?.traceId ?? randomUUID(),
    callerId: opts?.callerId,
    operation: opts?.operation,
  };
  return storage.run(ctx, fn);
}

/**
 * Get the current trace ID, if running within a trace context.
 */
export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

/**
 * Get the current trace context, if running within a trace context.
 */
export function getTraceContext(): TraceContext | undefined {
  return storage.getStore();
}

/**
 * Get the caller ID from the current trace context.
 */
export function getTraceCallerId(): string | undefined {
  return storage.getStore()?.callerId;
}
