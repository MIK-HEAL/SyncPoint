/**
 * E2E test helper — starts an isolated server with its own temp DB.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getRandomPort, trpcFetch } from "./helpers.ts";

export interface E2EContext {
  baseUrl: string;
  port: number;
  server: http.Server;
  tmpDir: string;
  /** tRPC helper bound to this server. callerId defaults to 'e2e-test-user'. */
  rpc: (procedure: string, input?: unknown, method?: "GET" | "POST", callerIdOrOpts?: string | import("./helpers.ts").TrpcFetchOptions) => Promise<unknown>;
  cleanup: () => Promise<void>;
}

export async function startE2E(): Promise<E2EContext> {
  const port = await getRandomPort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoint-e2e-"));
  const spDir = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(spDir, { recursive: true });

  // Point DB to temp dir
  process.env.SYNCPOINT_DB_DIR = spDir;

  // Dynamic import to pick up the env var
  const { startServer } = await import("../main.ts");
  const { closeDb } = await import("../db.ts");

  const server = startServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  // Wait for server to be listening
  await new Promise<void>((resolve) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
  });

  return {
    baseUrl,
    port,
    server,
    tmpDir,
    rpc: (proc, input?, method?, callerId = "e2e-test-user") => trpcFetch(baseUrl, proc, input, method, callerId),
    cleanup: async () => {
      delete process.env.SYNCPOINT_DB_DIR;
      closeDb();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}
