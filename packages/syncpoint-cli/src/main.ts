#!/usr/bin/env node

/**
 * SyncPoint CLI — command-line interface for editor AI synchronization.
 * This file handles program setup and command registration only.
 * Business logic lives in syncpoint-server/application.
 * Command implementations live in ./commands/*.
 */

import { Command, Option } from "commander";
import { closeDb, startServer, initSyncpointDir } from "syncpoint-server";
import { USER_AGENT_PROVIDER_VALUES } from "syncpoint-core";
import { initProjectAgents, listAgentTeamTemplates } from "syncpoint-server/application";
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
import { registerWriteCommands } from "./commands/write.js";
import { registerGuardCommands } from "./commands/guard.js";
import { registerTeamCommands } from "./commands/team.js";
import { registerDevCommands } from "./commands/dev.js";
import { registerMessageCommands } from "./commands/message.js";

const program = new Command();
let keepDbOpen = false;
program
  .name("syncpoint")
  .description("SyncPoint — declare agents in files, sync automatically")
  .version("0.1.0");

// ── Init ──────────────────────────────────────────────

program
  .command("init")
  .description("Initialize .syncpoint/ in the current (or given) directory")
  .argument("[dir]", "Directory to initialize (defaults to cwd)")
  .addOption(new Option("--no-agents", "Skip generating the default example agent manifest"))
  .addOption(new Option("--team <templateId>", "Materialize a built-in team template alongside the example agent").choices(listAgentTeamTemplates().templates.map((t: { id: string }) => t.id)))
  .addOption(new Option("--provider <provider>", "Default provider for generated agents").choices([...USER_AGENT_PROVIDER_VALUES]))
  .addOption(new Option("--agent-format <format>", "Manifest file format").choices(["yaml", "json"]))
  .option("--prefix <prefix>", "Name prefix for generated agents")
  .option("--no-sync", "Skip syncing generated manifests into runtime state")
  .action((dir, opts) => {
    const created = initSyncpointDir(dir);
    console.log(`Initialized SyncPoint at ${created}`);
    console.log(`Database: ${created}/syncpoint.db`);

    const generateExample = opts.agents !== false;
    if (generateExample || opts.team) {
      const agentResult = initProjectAgents({
        exampleAgent: generateExample,
        teamTemplateId: opts.team,
        defaultProvider: opts.provider,
        format: opts.agentFormat,
        namePrefix: opts.prefix,
        sync: opts.sync,
      });

      if (agentResult.exampleManifest) {
        const m = agentResult.exampleManifest;
        console.log(`\nExample agent: ${m.manifest.name} → ${m.write.filePath}`);
        console.log(`  Edit this file to customize your agent, or add more manifests to .syncpoint/agents/`);
      }

      if (agentResult.teamWrites.length) {
        console.log(`\nTeam template agents:`);
        for (const w of agentResult.teamWrites) {
          console.log(`  ${w.manifestPath} → ${w.filePath}`);
        }
      }

      console.log(`\nNext steps:`);
      console.log(`  1. Edit manifests in .syncpoint/agents/ to describe your agents`);
      console.log(`  2. Run \`syncpoint agent sync\` to refresh runtime state after edits`);
      console.log(`  3. Run \`syncpoint agent list\` to see all declared agents`);
    } else {
      console.log(`\nNo agent manifests generated. Run \`syncpoint agent init --name <name>\` to create one.`);
    }
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
registerWriteCommands(program);
registerGuardCommands(program);
registerTeamCommands(program);
registerDevCommands(program);
registerMessageCommands(program);

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
