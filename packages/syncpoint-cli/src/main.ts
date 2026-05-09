#!/usr/bin/env node

/**
 * SyncPoint CLI — command-line interface for editor AI synchronization.
 * This file handles program setup and command registration only.
 * Business logic lives in syncpoint-server/application.
 * Command implementations live in ./commands/*.
 */

import { Command } from "commander";
import { closeDb, startServer, initSyncpointDir } from "syncpoint-server";
import { registerPrimitiveCommands } from "./commands/primitives.js";
import { registerAdapterCommand } from "./commands/adapter.js";
import { registerContextCommands } from "./commands/context.js";
import { registerProjectMemoryCommands } from "./commands/project-memory.js";
import { registerLoopCommand } from "./commands/loop.js";
import { registerSessionCommands } from "./commands/session.js";
import { registerReviewCommands } from "./commands/review.js";
import { registerPlaybookCommands } from "./commands/playbook.js";
import { registerDemoCommands } from "./commands/demo.js";
import { registerSyncCommands } from "./commands/sync.js";
import { patchCmd } from "./commands/patch.js";
import { constraintCmd } from "./commands/constraint.js";
import { registerFacadeCommands } from "./commands/facade.js";
import { registerConnectCommands } from "./commands/connect.js";
import { registerWatchCommands } from "./commands/watch.js";

const program = new Command();
let keepDbOpen = false;
program
  .name("syncpoint")
  .description("SyncPoint — local synchronization protocol layer for editor AI agents")
  .version("0.1.0");

// ── Init ──────────────────────────────────────────────

program
  .command("init")
  .description("Initialize .syncpoint/ in the current (or given) directory")
  .argument("[dir]", "Directory to initialize (defaults to cwd)")
  .action((dir?: string) => {
    const created = initSyncpointDir(dir);
    console.log(`Initialized SyncPoint at ${created}`);
    console.log(`Database: ${created}/syncpoint.db`);
  });

// ── Server ─────────────────────────────────────────────

program
  .command("server")
  .description("Manage SyncPoint server")
  .addCommand(
    new Command("start")
      .description("Start the SyncPoint server")
      .option("-p, --port <port>", "Port number", "8765")
      .action((opts) => {
        keepDbOpen = true;
        startServer(parseInt(opts.port, 10));
      })
  );

// ── Delegated command groups ────────────────────────

registerPrimitiveCommands(program);
registerContextCommands(program);
registerProjectMemoryCommands(program);
registerAdapterCommand(program);
registerLoopCommand(program);
registerSessionCommands(program);
registerReviewCommands(program);
registerPlaybookCommands(program);
registerSyncCommands(program);
program.addCommand(patchCmd);
program.addCommand(constraintCmd);
registerDemoCommands(program);
registerFacadeCommands(program);
registerConnectCommands(program);
registerWatchCommands(program);

// ── Parse ────────────────────────────────────────────

program
  .parseAsync(process.argv)
  .finally(() => {
    if (!keepDbOpen) closeDb();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
