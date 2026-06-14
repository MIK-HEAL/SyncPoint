#!/usr/bin/env node

import { Command } from "commander";
import { AutonomousLoopRunner } from "./runner.js";
import { RunnerConfigSchema } from "./config.js";

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const program = new Command();

program
  .name("syncpoint-loop-runner")
  .description("Autonomous orchestrator — runs Claude Code agents in parallel via SyncPoint")
  .version("0.1.0");

// ---------------------------------------------------------------------------
// run — start the autonomous loop
// ---------------------------------------------------------------------------

program
  .command("run")
  .description("Start the autonomous loop runner")
  .option("--url <url>", "SyncPoint server URL", process.env.SYNCPOINT_URL ?? "http://127.0.0.1:8765")
  .option("--concurrency <n>", "Number of parallel workers (1-16)", "1")
  .option("--max-iterations <n>", "Maximum total iterations before stopping", "100")
  .option("--max-failures <n>", "Max failures per task before giving up", "3")
  .option("--poll-interval <ms>", "Poll interval in milliseconds", "2000")
  .option("--timeout <ms>", "Claude execution timeout in ms", "600000")
  .option("--claude-binary <path>", "Path to Claude Code CLI binary", "claude")
  .option("--dry-run", "Plan work but don't execute Claude", false)
  .option("--log-level <level>", "Log level (debug|info|warn|error)", "info")
  .option("--log-file <path>", "Optional log file path")
  .action(async (opts) => {
    const config = RunnerConfigSchema.parse({
      serverUrl: opts.url,
      concurrency: Number(opts.concurrency),
      maxIterations: Number(opts.maxIterations),
      maxFailuresPerTask: Number(opts.maxFailures),
      pollInterval: Number(opts.pollInterval),
      claudeTimeout: Number(opts.timeout),
      claudeBinary: opts.claudeBinary,
      dryRun: opts.dryRun,
      logLevel: opts.logLevel,
      logFile: opts.logFile,
    });

    const runner = new AutonomousLoopRunner(config);

    const shutdown = async () => {
      console.log("\nShutting down...");
      await runner.shutdown();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    try {
      await runner.start();
    } catch (err) {
      console.error("Runner failed:", err);
      process.exit(1);
    }
  });

// ---------------------------------------------------------------------------
// status — check what's running
// ---------------------------------------------------------------------------

program
  .command("status")
  .description("Check SyncPoint server status (agents, tasks, wakes)")
  .option("--url <url>", "SyncPoint server URL", process.env.SYNCPOINT_URL ?? "http://127.0.0.1:8765")
  .action(async (opts) => {
    try {
      const trpcUrl = `${opts.url}/trpc`;

      async function query(path: string) {
        const res = await fetch(`${trpcUrl}/${path}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = (await res.json()) as { result?: { data?: unknown } };
        return json.result?.data;
      }

      const [agents, tasks, wakes] = await Promise.all([
        query("agent.list") as Promise<Array<{ id: string; name: string; status: string; currentTaskId: string | null }>>,
        query("task.list") as Promise<Array<{ id: string; title: string; status: string; ownerAgentId: string | null }>>,
        query("wake.stats") as Promise<{ total: number; queued: number; running: number; done: number; failed: number } | null>,
      ]);

      console.log("\n=== SyncPoint Status ===\n");

      console.log("Agents:");
      if (agents.length === 0) {
        console.log("  (none)");
      } else {
        for (const a of agents) {
          const task = a.currentTaskId ? ` → ${a.currentTaskId}` : "";
          console.log(`  ${a.name} [${a.status}]${task}`);
        }
      }

      console.log("\nTasks:");
      const statusCounts: Record<string, number> = {};
      for (const t of tasks) {
        statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
      }
      for (const [status, count] of Object.entries(statusCounts)) {
        console.log(`  ${status}: ${count}`);
      }
      const openTasks = tasks.filter((t) => t.status === "OPEN" || t.status === "ASSIGNED");
      if (openTasks.length > 0) {
        console.log("\n  Available for execution:");
        for (const t of openTasks) {
          const owner = t.ownerAgentId ? ` [${t.ownerAgentId}]` : "";
          console.log(`    - ${t.title} (${t.status})${owner}`);
        }
      }

      if (wakes) {
        console.log("\nWake Engine:");
        console.log(`  total=${wakes.total} queued=${wakes.queued} running=${wakes.running} done=${wakes.done} failed=${wakes.failed}`);
      }

      console.log();
    } catch (err) {
      console.error("Failed to get status:", err);
      process.exit(1);
    }
  });

program.parseAsync(process.argv);
