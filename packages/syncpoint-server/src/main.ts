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
const MAX_SSE_CONNECTIONS = 200;
const activeSseConnections = new Set<http.ServerResponse>();

function broadcastSse(data: SyncPointEventData): void {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of activeSseConnections) {
    try {
      res.write(payload);
    } catch {
      activeSseConnections.delete(res);
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

  const bus = SyncPointEventBus.getInstance();

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

      // Send current sequence number so client knows where it starts
      const currentSeq = bus.currentSeq;
      res.write(`data: {"type":"connected","seq":${currentSeq}}\n\n`);

      activeSseConnections.add(res);
      logger.info("SSE client connected", { activeConnections: activeSseConnections.size, currentSeq });

      // Heartbeat: send keepalive comment every 30s to detect dead connections
      const heartbeat = setInterval(() => {
        try {
          res.write(": heartbeat\n\n");
        } catch {
          clearInterval(heartbeat);
          activeSseConnections.delete(res);
        }
      }, SSE_HEARTBEAT_MS);

      // Cleanup on disconnect
      const cleanup = () => {
        clearInterval(heartbeat);
        activeSseConnections.delete(res);
        logger.info("SSE client disconnected", { activeConnections: activeSseConnections.size });
      };
      req.on("close", cleanup);
      res.on("close", cleanup);
      res.on("finish", cleanup);
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
    console.log(`  Wake Engine: active`);
  });

  // ── Graceful shutdown ─────────────────────────────────

  const shutdown = () => {
    logger.info("Shutting down SyncPoint server...");
    stopMessageTimeoutChecker();
    wakeEngineStop();
    // Close all SSE connections
    for (const res of activeSseConnections) {
      try { res.end(); } catch { /* ignore */ }
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
