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
import { setSecurityHeaders, setCorsHeaders } from "./transport/cors-headers.js";
import {
  broadcastSse,
  getActiveSseCount,
  getMaxSseConnections,
  setupSseConnection,
  closeAllSseConnections,
} from "./transport/sse-manager.js";

const DEFAULT_PORT = 8765;

// ── Request body size limit ─────────────────────────────

const MAX_BODY_SIZE = parseInt(process.env.SYNCPOINT_MAX_BODY_SIZE ?? String(5 * 1024 * 1024), 10); // 5MB default

// ── Server ──────────────────────────────────────────────

export function startServer(port = DEFAULT_PORT): http.Server {
  ensureApplicationBootstrap();
  getDb();
  syncDeclaredAgents();
  recoverEventBusSeq();

  // Subscribe event bus to SSE broadcast
  const bus = SyncPointEventBus.getInstance();
  const sseForward = (data: SyncPointEventData) => broadcastSse(data);
  bus.on("event", sseForward);

  // tRPC handler
  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: ({ req }) => createContext(req),
    maxBodySize: MAX_BODY_SIZE,
  });

  const server = http.createServer((req, res) => {
    // ── Security headers (all responses) ──
    setSecurityHeaders(res);

    // ── CORS ──
    setCorsHeaders(res, req.headers.origin);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // ── Health check ──
    if ((req.url === "/health" || req.url === "/status") && req.method === "GET") {
      healthCheckHandler(req, res);
      return;
    }

    // ── SSE endpoint ──
    if (req.url === "/events" && req.method === "GET") {
      setupSseConnection(req, res);
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
    if (req.url?.startsWith("/trpc")) {
      req.url = req.url.slice(5) || "/";
    }
    trpcHandler(req, res);
  });

  // ── Global error handling ─────────────────────────────

  server.on("error", (err) => {
    logger.fatal("Server error", { error: err.message });
  });

  // ── Start services ────────────────────────────────────

  wakeEngineStart();
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
    closeAllSseConnections();
    bus.off("event", sseForward);
    closeDb();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
