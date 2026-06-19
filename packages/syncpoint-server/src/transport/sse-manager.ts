/**
 * SSE (Server-Sent Events) connection management.
 * Extracted from main.ts — handles connection lifecycle, heartbeat, replay, and broadcast.
 */

import http from "node:http";
import { _getBus } from "../repositories/_shared.js";
import type { SyncPointEventData } from "../event-bus.js";
import { logger } from "../logger.js";

// ── Constants ─────────────────────────────────────────

export const SSE_HEARTBEAT_MS = 30_000;
/** Number of consecutive heartbeat failures before connection is evicted. */
const SSE_MAX_MISSED_BEATS = 2;
const MAX_SSE_CONNECTIONS = 200;
/** Maximum time (ms) without a successful write before eviction. */
export const SSE_EVICTION_TTL_MS = SSE_MAX_MISSED_BEATS * SSE_HEARTBEAT_MS;

// ── Connection state ──────────────────────────────────

export interface SseConnectionState {
  res: http.ServerResponse;
  heartbeat: NodeJS.Timeout;
  /** Consecutive heartbeat write or drain failures. */
  consecutiveFailures: number;
  /** Timestamp (ms) of the last successful write to this connection. */
  lastSuccessfulWrite: number;
  /** True when the last res.write() returned false and we are waiting for drain. */
  awaitingDrain: boolean;
  /** Timestamp (ms) when this connection was established. */
  createdAt: number;
}

const activeSseConnections = new Map<http.ServerResponse, SseConnectionState>();
const bus = _getBus();

// ── Write / Evict ─────────────────────────────────────

/**
 * Attempt a write to an SSE connection. Returns true if successful.
 * Updates the connection's failure counter on error.
 */
export function sseWrite(state: SseConnectionState, data: string): boolean {
  try {
    const ok = state.res.write(data);
    if (ok) {
      state.lastSuccessfulWrite = Date.now();
      state.consecutiveFailures = 0;
      state.awaitingDrain = false;
    } else {
      state.awaitingDrain = true;
    }
    return true;
  } catch {
    state.consecutiveFailures++;
    return false;
  }
}

/**
 * Evict a dead SSE connection: clear heartbeat, remove from tracking,
 * update metrics, and end the response.
 */
export function evictSseConnection(state: SseConnectionState, reason: string): void {
  clearInterval(state.heartbeat);
  activeSseConnections.delete(state.res);
  bus.connectionClosed();
  logger.info("SSE connection evicted", {
    reason,
    activeConnections: activeSseConnections.size,
    connectionAgeMs: Date.now() - state.createdAt,
    consecutiveFailures: state.consecutiveFailures,
  });
  try { state.res.end(); } catch { /* ignore */ }
}

// ── Broadcast ─────────────────────────────────────────

export function broadcastSse(data: SyncPointEventData): void {
  const payload = `id: ${data.seq}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const state of activeSseConnections.values()) {
    if (!sseWrite(state, payload)) {
      evictSseConnection(state, "broadcast_write_error");
    }
  }
}

// ── Connection management ─────────────────────────────

export function getActiveSseCount(): number {
  return activeSseConnections.size;
}

export function getActiveSseConnections(): Map<http.ServerResponse, SseConnectionState> {
  return activeSseConnections;
}

export function getMaxSseConnections(): number {
  return MAX_SSE_CONNECTIONS;
}

/**
 * Set up an SSE connection — headers, heartbeat, replay, drain, cleanup.
 * Call this from the request handler for GET /events.
 */
export function setupSseConnection(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  // Connection limit
  if (activeSseConnections.size >= MAX_SSE_CONNECTIONS) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Too many SSE connections", max: MAX_SSE_CONNECTIONS }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const lastEventSeq = parseInt(req.headers["last-event-seq"] as string ?? "", 10);
  const isReconnect = !isNaN(lastEventSeq) && lastEventSeq > 0;
  const currentSeq = bus.currentSeq;
  const now = Date.now();

  const connState: SseConnectionState = {
    res,
    heartbeat: null as unknown as NodeJS.Timeout,
    consecutiveFailures: 0,
    lastSuccessfulWrite: now,
    awaitingDrain: false,
    createdAt: now,
  };

  sseWrite(connState, `id: ${currentSeq}\ndata: {"type":"connected","seq":${currentSeq}}\n\n`);

  activeSseConnections.set(res, connState);
  bus.connectionOpened();
  if (isReconnect) bus.reconnectDetected();
  logger.info("SSE client connected", {
    activeConnections: activeSseConnections.size,
    currentSeq,
    isReconnect,
    lastEventSeq,
  });

  // Replay missed events on reconnect
  if (isReconnect) {
    const missed = bus.replayAfter(lastEventSeq);
    for (const event of missed) {
      if (!sseWrite(connState, `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) {
        evictSseConnection(connState, "replay_write_error");
        return;
      }
    }
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    const timeSinceLastWrite = Date.now() - connState.lastSuccessfulWrite;
    if (timeSinceLastWrite > SSE_EVICTION_TTL_MS) {
      evictSseConnection(connState, "heartbeat_ttl_expired");
      return;
    }
    if (connState.awaitingDrain) {
      connState.consecutiveFailures++;
    }
    if (!sseWrite(connState, ": heartbeat\n\n")) {
      connState.consecutiveFailures++;
    }
    if (connState.consecutiveFailures >= SSE_MAX_MISSED_BEATS) {
      evictSseConnection(connState, "heartbeat_missed");
      return;
    }
    const sock = (connState.res as import("node:http").ServerResponse).socket;
    if (sock && sock.destroyed) {
      evictSseConnection(connState, "socket_destroyed");
    }
  }, SSE_HEARTBEAT_MS);
  connState.heartbeat = heartbeat;

  // Drain event
  res.on("drain", () => {
    connState.awaitingDrain = false;
    connState.lastSuccessfulWrite = Date.now();
    connState.consecutiveFailures = 0;
  });

  // Cleanup on disconnect
  const cleanup = () => {
    const state = activeSseConnections.get(res);
    if (state) {
      clearInterval(state.heartbeat);
      activeSseConnections.delete(res);
      bus.connectionClosed();
      logger.info("SSE client disconnected", { activeConnections: activeSseConnections.size });
    }
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("finish", cleanup);
}

/**
 * Close all active SSE connections. Called during graceful shutdown.
 */
export function closeAllSseConnections(): void {
  for (const state of activeSseConnections.values()) {
    clearInterval(state.heartbeat);
    try { state.res.end(); } catch { /* ignore */ }
  }
  activeSseConnections.clear();
}
