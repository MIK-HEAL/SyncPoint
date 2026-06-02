/**
 * SyncPoint local server — Node http + tRPC + SSE.
 *
 * Default: http://127.0.0.1:8765
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.js";
import { createContext } from "./routers/_trpc.js";
import { getDb, closeDb, getDbPath, isWalEnabled } from "./db.js";
import { SyncPointEventBus } from "./event-bus.js";
import type { SyncPointEventData } from "./event-bus.js";
import { ensureApplicationBootstrap } from "./application/bootstrap.js";
import { recoverEventBusSeq } from "./repositories/_shared.js";
import { syncDeclaredAgents } from "./application/agent-registry-service.js";
import { wakeEngineStart, wakeEngineStop } from "./application/wake-engine-service.js";
import { startMessageTimeoutChecker, stopMessageTimeoutChecker } from "./application/agent-message-timeout.js";
import { healthCheckHandler } from "./health.js";
import { logger } from "./logger.js";

const DEFAULT_PORT = 8765;

// ── CORS configuration ──────────────────────────────────

const ALLOWED_ORIGINS = (process.env.SYNCPOINT_CORS_ORIGINS ?? "http://localhost:*").split(",").map(s => s.trim());

function getAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  for (const allowed of ALLOWED_ORIGINS) {
    if (allowed === origin) return origin;
    // Wildcard prefix match: "http://localhost:*" matches "http://localhost:3000"
    if (allowed.endsWith(":*")) {
      const prefix = allowed.slice(0, -2);
      if (origin.startsWith(prefix)) return origin;
    }
  }
  return null;
}

// ── Security headers ────────────────────────────────────

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "0"); // Deprecated but still used by some scanners
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  // Only set HSTS if running with HTTPS (not the default localhost case)
  if (process.env.SYNCPOINT_HTTPS === "true") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}

// ── SSE management ──────────────────────────────────────

const SSE_HEARTBEAT_MS = 30_000;
/** Number of consecutive heartbeat failures before connection is evicted. */
const SSE_MAX_MISSED_BEATS = 2;
const MAX_SSE_CONNECTIONS = 200;

interface SseConnectionState {
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
const bus = SyncPointEventBus.getInstance();

/** Maximum time (ms) without a successful write before eviction. */
const SSE_EVICTION_TTL_MS = SSE_MAX_MISSED_BEATS * SSE_HEARTBEAT_MS;

/**
 * Attempt a write to an SSE connection. Returns true if successful.
 * Updates the connection's failure counter on error.
 */
function sseWrite(state: SseConnectionState, data: string): boolean {
  try {
    const ok = state.res.write(data);
    if (ok) {
      state.lastSuccessfulWrite = Date.now();
      state.consecutiveFailures = 0;
      state.awaitingDrain = false;
    } else {
      // Kernel buffer full — client not consuming fast enough.
      // Mark as awaiting drain; if drain doesn't fire within the
      // heartbeat window the next heartbeat tick will count it as a miss.
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
function evictSseConnection(state: SseConnectionState, reason: string): void {
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

function broadcastSse(data: SyncPointEventData): void {
  const payload = `id: ${data.seq}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const state of activeSseConnections.values()) {
    if (!sseWrite(state, payload)) {
      evictSseConnection(state, "broadcast_write_error");
    }
  }
}

// ── Request body size limit ─────────────────────────────

const MAX_BODY_SIZE = parseInt(process.env.SYNCPOINT_MAX_BODY_SIZE ?? String(5 * 1024 * 1024), 10); // 5MB default

// ── Server ──────────────────────────────────────────────

export function startServer(port = DEFAULT_PORT): http.Server {
  ensureApplicationBootstrap();
  // Ensure DB is initialized
  getDb();
  syncDeclaredAgents();

  // Recover event bus sequence from persisted events (server restart continuity)
  recoverEventBusSeq();

  // Subscribe event bus to SSE broadcast
  const sseForward = (data: SyncPointEventData) => broadcastSse(data);
  bus.on("event", sseForward);

  // tRPC handler
  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: ({ req }) => createContext(req),
    // Limit request body size
    maxBodySize: MAX_BODY_SIZE,
  });

  const server = http.createServer((req, res) => {
    // ── Security headers (all responses) ──
    setSecurityHeaders(res);

    // ── CORS ──
    const requestOrigin = req.headers.origin;
    const allowedOrigin = getAllowedOrigin(requestOrigin);
    if (allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    } else if (requestOrigin) {
      // Explicit origin that we don't allow — deny
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin ?? "");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-caller-id, x-agent-role, x-agent-token");
    res.setHeader("Access-Control-Max-Age", "86400");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Health check endpoint ──
    if ((req.url === "/health" || req.url === "/status") && req.method === "GET") {
      healthCheckHandler(req, res);
      return;
    }

    // ── SSE endpoint for real-time events ──
    if (req.url === "/events" && req.method === "GET") {
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
        "X-Accel-Buffering": "no", // Disable nginx buffering
      });

      // Reconnect support: client sends Last-Event-Seq header
      const lastEventSeq = parseInt(req.headers["last-event-seq"] as string ?? "", 10);
      const isReconnect = !isNaN(lastEventSeq) && lastEventSeq > 0;

      // Send current sequence number so client knows where it starts
      const currentSeq = bus.currentSeq;
      const now = Date.now();

      // Per-connection state with TTL tracking
      const connState: SseConnectionState = {
        res,
        heartbeat: null as unknown as NodeJS.Timeout, // set below
        consecutiveFailures: 0,
        lastSuccessfulWrite: now,
        awaitingDrain: false,
        createdAt: now,
      };

      // Initial write
      sseWrite(connState, `id: ${currentSeq}\ndata: {"type":"connected","seq":${currentSeq}}\n\n`);

      activeSseConnections.set(res, connState);
      bus.connectionOpened();
      if (isReconnect) bus.reconnectDetected();
      logger.info("SSE client connected", { activeConnections: activeSseConnections.size, currentSeq, isReconnect, lastEventSeq });

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

      // Heartbeat: send keepalive every 30s.
      // Tracks consecutive failures: if 2 heartbeats fail (via write error
      // or persistent backpressure), the connection is evicted.
      const heartbeat = setInterval(() => {
        // Check TTL: if no successful write within the eviction window, evict
        const timeSinceLastWrite = Date.now() - connState.lastSuccessfulWrite;
        if (timeSinceLastWrite > SSE_EVICTION_TTL_MS) {
          evictSseConnection(connState, "heartbeat_ttl_expired");
          return;
        }

        // If still awaiting drain from the previous write, count as a miss
        if (connState.awaitingDrain) {
          connState.consecutiveFailures++;
        }

        // Attempt heartbeat write
        if (!sseWrite(connState, ": heartbeat\n\n")) {
          connState.consecutiveFailures++;
        }

        // After the attempt: check if we've hit the eviction threshold
        if (connState.consecutiveFailures >= SSE_MAX_MISSED_BEATS) {
          evictSseConnection(connState, "heartbeat_missed");
          return;
        }

        // Also check socket health directly
        const sock = (connState.res as any).socket;
        if (sock && sock.destroyed) {
          evictSseConnection(connState, "socket_destroyed");
        }
      }, SSE_HEARTBEAT_MS);
      connState.heartbeat = heartbeat;

      // Listen for drain event: when the kernel buffer drains after backpressure,
      // reset the backpressure flag so the next heartbeat doesn't count a miss.
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
      return;
    }

    // ── Metrics endpoint (Prometheus-compatible) ──
    if (req.url === "/metrics" && req.method === "GET") {
      const m = bus.getMetrics();
      const body = [
        `# HELP syncpoint_sse_active_connections Number of active SSE connections`,
        `# TYPE syncpoint_sse_active_connections gauge`,
        `syncpoint_sse_active_connections ${m.activeConnections}`,
        `# HELP syncpoint_sse_total_connections Total SSE connections since server start`,
        `# TYPE syncpoint_sse_total_connections counter`,
        `syncpoint_sse_total_connections ${m.totalConnections}`,
        `# HELP syncpoint_sse_events_pushed Total events pushed to SSE clients`,
        `# TYPE syncpoint_sse_events_pushed counter`,
        `syncpoint_sse_events_pushed ${m.eventsPushed}`,
        `# HELP syncpoint_sse_reconnects Total SSE reconnections detected`,
        `# TYPE syncpoint_sse_reconnects counter`,
        `syncpoint_sse_reconnects ${m.reconnects}`,
        `# HELP syncpoint_sse_reconnect_replays Total events replayed on reconnect`,
        `# TYPE syncpoint_sse_reconnect_replays counter`,
        `syncpoint_sse_reconnect_replays ${m.reconnectReplays}`,
      ].join("\n") + "\n";
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      res.end(body);
      return;
    }

    // ── tRPC handler ──
    // Strip /trpc prefix if present
    if (req.url?.startsWith("/trpc")) {
      req.url = req.url.slice(5) || "/";
    }
    trpcHandler(req, res);
  });

  // ── Global error handling ─────────────────────────────

  server.on("error", (err) => {
    logger.fatal("Server error", { error: err.message });
  });

  // ── Start ─────────────────────────────────────────────

  // Start Wake Engine (auto-wake orchestration)
  wakeEngineStart();

  // Start message timeout checker
  startMessageTimeoutChecker();

  server.listen(port, () => {
    const walStatus = isWalEnabled() ? "WAL" : "DELETE";
    logger.info("SyncPoint server started", {
      port,
      dbPath: getDbPath(),
      journalMode: walStatus,
      logLevel: logger.level,
    });
    console.log(`SyncPoint server running at http://127.0.0.1:${port}`);
    console.log(`  Database:    ${getDbPath()} (${walStatus})`);
    console.log(`  tRPC API:   http://127.0.0.1:${port}/trpc/...`);
    console.log(`  SSE events:  http://127.0.0.1:${port}/events`);
    console.log(`  Health:      http://127.0.0.1:${port}/health`);
    console.log(`  Metrics:     http://127.0.0.1:${port}/metrics`);
    console.log(`  Wake Engine: active`);
  });

  // ── Graceful shutdown ─────────────────────────────────

  const shutdown = () => {
    logger.info("Shutting down SyncPoint server...");
    stopMessageTimeoutChecker();
    wakeEngineStop();
    // Close all SSE connections (now a Map of res → state)
    for (const state of activeSseConnections.values()) {
      clearInterval(state.heartbeat);
      try { state.res.end(); } catch { /* ignore */ }
    }
    activeSseConnections.clear();
    bus.off("event", sseForward);
    closeDb();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Global unhandled rejection handler
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  return server;
}

// Run directly when executed as main entry
const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) {
  const port = parseInt(process.env.SYNCPOINT_PORT ?? String(DEFAULT_PORT), 10);
  startServer(port);
}
