#!/usr/bin/env node
/**
 * SyncPoint MCP Server — stdio entry point.
 *
 * Usage:
 *   node dist/main.js
 *
 * Environment:
 *   SYNCPOINT_DB_DIR — override .syncpoint/ directory
 *   SYNCPOINT_MEMORY_PATH — override project-memory.md path
 *   SYNCPOINT_PROJECT_ROOT — cd into project root before starting
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { defaultContext } from "syncpoint-server";
import { createSyncPointMcpServer } from "./server.js";
import { log } from "./errors.js";
import { logIdentityStatus } from "./identity.js";

async function main(): Promise<void> {
  // Optionally cd into project root
  if (process.env.SYNCPOINT_PROJECT_ROOT) {
    process.chdir(process.env.SYNCPOINT_PROJECT_ROOT);
    log(`Working directory: ${process.cwd()}`);
  }

  // Initialize DB
  defaultContext.db;
  log("Database initialized");

  // Log bound identity
  logIdentityStatus();

  // Create and start MCP server
  const server = createSyncPointMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  log("SyncPoint MCP server started (stdio)");
}

main().catch((err) => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
