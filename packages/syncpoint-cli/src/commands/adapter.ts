/**
 * CLI: syncpoint adapter — adapter protocol commands.
 */

import { Command } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import * as repo from "syncpoint-server/repositories";
import { buildAdapterInstruction, getAdapterConfig, listAdapterProviders } from "syncpoint-adapters";
import type { AdapterLifecycleEvent } from "syncpoint-adapters";

export function registerAdapterCommand(program: Command): void {
  program
    .command("adapter")
    .description("Agent adapter protocol commands")
    .addCommand(
      new Command("boot")
        .description("Boot adapter: generate context files for an AI editor")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--agent <agentId>", "Agent ID")
        .option("--provider <provider>", "Provider override (codex, claude-code, cursor, cline)")
        .option("--event <event>", "Lifecycle event: boot|resume|handoff|checkpoint", "resume")
        .option("--dry-run", "Print files but do not write them")
        .action(async (opts) => {
          const ctx = repo.getResumeContext(opts.task, opts.agent);
          ctx.projectMemories = []; // P3B: no raw PM in adapter output
          const provider = opts.provider ?? ctx.agent.name;
          const instruction = buildAdapterInstruction(ctx, provider as any, opts.event as AdapterLifecycleEvent);
          if (!instruction.ready) {
            console.error("⚠ Context not ready:");
            for (const w of instruction.warnings) console.error(`  - ${w}`);
            console.error("");
          }
          if (opts.dryRun) {
            console.log("Dry run — files that would be written:\n");
            for (const [filePath, content] of Object.entries(instruction.files) as [string, string][]) {
              console.log(`── ${filePath} ──`);
              console.log(content.slice(0, 500) + (content.length > 500 ? "\n..." : ""));
              console.log("");
            }
            console.log(instruction.summary);
          } else {
            for (const [filePath, content] of Object.entries(instruction.files) as [string, string][]) {
              const dir = path.dirname(filePath);
              if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(filePath, content, "utf-8");
            }
            console.log(instruction.summary);
            for (const [filePath] of Object.entries(instruction.files) as [string, string][]) {
              console.log(`  ✓ ${filePath}`);
            }
          }
        })
    )
    .addCommand(
      new Command("init")
        .description("Show setup instructions for an AI editor adapter")
        .argument("<provider>", "Provider: " + listAdapterProviders().join(", "))
        .action(async (provider) => {
          const config = getAdapterConfig(provider);
          if (!config) {
            console.error(`Unknown provider: ${provider}`);
            console.error(`Available: ${listAdapterProviders().join(", ")}`);
            return;
          }
          console.log(`\n  Provider:    ${config.provider}`);
          console.log(`  Rules file:  ${config.rulesFile} (${config.rulesFormat})`);
          if (config.extraFiles.length > 0) {
            console.log(`  Extra files: ${config.extraFiles.map((f: { path: string }) => f.path).join(", ")}`);
          }
          console.log(`\n  Setup Instructions:\n`);
          console.log(config.setupInstructions.split("\n").map((l: string) => `    ${l}`).join("\n"));
          console.log(`\n  After setup, run:\n`);
          console.log(`    syncpoint adapter boot --task <taskId> --agent <agentId> --provider ${config.provider}`);
          console.log("");
        })
    )
    .addCommand(
      new Command("info")
        .description("List available adapter providers")
        .action(async () => {
          console.log("\nAvailable adapter providers:\n");
          for (const name of listAdapterProviders()) {
            const cfg = getAdapterConfig(name)!;
            console.log(`  ${name.padEnd(14)} → ${cfg.rulesFile} (${cfg.rulesFormat})`);
          }
          console.log("");
        })
    );
}
