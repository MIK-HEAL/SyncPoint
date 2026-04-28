/**
 * SyncPoint local server — Node http + tRPC + SSE.
 *
 * Default: http://127.0.0.1:8765
 */

import http from "node:http";
import { pathToFileURL } from "node:url";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { appRouter } from "./router.js";
import { getDb, closeDb, getDbPath } from "./db.js";
import { SyncPointEventBus } from "./event-bus.js";
import type { SyncPointEventData } from "./event-bus.js";
import { wakeEngineStart, wakeEngineStop } from "./application/wake-engine-service.js";

const DEFAULT_PORT = 8765;

export function startServer(port = DEFAULT_PORT): http.Server {
  // Ensure DB is initialized
  getDb();

  const bus = SyncPointEventBus.getInstance();

  // tRPC handler
  const trpcHandler = createHTTPHandler({
    router: appRouter,
    createContext: () => ({}),
  });

  const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // SSE endpoint for real-time events
    if (req.url === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write("data: {\"type\":\"connected\"}\n\n");

      const onEvent = (data: SyncPointEventData) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      bus.on("event", onEvent);

      req.on("close", () => {
        bus.off("event", onEvent);
      });
      return;
    }

    // Status endpoint
    if (req.url === "/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", version: "0.1.0" }));
      return;
    }

    // Everything else goes to tRPC (strip /trpc prefix)
    if (req.url?.startsWith("/trpc")) {
      req.url = req.url.slice(5) || "/";
    }
    trpcHandler(req, res);
  });

  // Start Wake Engine (auto-wake orchestration)
  wakeEngineStart();

  server.listen(port, () => {
    console.log(`SyncPoint server running at http://127.0.0.1:${port}`);
    console.log(`  Database:   ${getDbPath()}`);
    console.log(`  tRPC API:  http://127.0.0.1:${port}/trpc/...`);
    console.log(`  SSE events: http://127.0.0.1:${port}/events`);
    console.log(`  Wake Engine: active`);
    console.log(`  Status:     http://127.0.0.1:${port}/status`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down SyncPoint server...");
    wakeEngineStop();
    closeDb();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
