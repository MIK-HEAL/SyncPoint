/**
 * CLI Facade — root-level short commands for v0.1.
 *
 * These wrap existing application services into user-friendly
 * top-level commands:
 *   syncpoint status
 *   syncpoint claim <paths>
 *   syncpoint resume
 *   syncpoint checkpoint
 *   syncpoint wake
 */

import fs from "node:fs";
import path from "node:path";
import { Command, Option } from "commander";
import { ResourceNotFoundError } from "syncpoint-kernel";
import type { ResourceRef } from "syncpoint-kernel";
import {
  buildSnapshot,
  rcClaim,
  rcRelease,
  rcList,
  loopResume,
  loopCheckpoint,
  wakeNext,
  wakeAck,
  wakeList,
  LoopError,
} from "syncpoint-server/application";
import * as repo from "syncpoint-server/repositories";
import { formatStatusOutput, formatResumeExplanation } from "./formatter.js";
import type { Snapshot } from "./formatter.js";
import { resolveAgent } from "./connect.js";

interface StatusOptions {
  session?: string;
  agent?: string;
  json?: boolean;
  watch?: boolean;
  interval?: string;
  events?: string;
  clear?: boolean;
}

/**
 * Resolve agent name-or-id to an agent ID. Throws if not found.
 */
function requireAgentId(nameOrId: string): string {
  const agent = resolveAgent(nameOrId);
  if (!agent) throw new ResourceNotFoundError(nameOrId);
  return agent.id;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildStatusSnapshot(opts: StatusOptions): Snapshot {
  const agentId = opts.agent ? requireAgentId(opts.agent) : undefined;
  return buildSnapshot({
    sessionId: opts.session,
    agentId,
    eventsLimit: parsePositiveInt(opts.events, 5),
  }) as Snapshot;
}

function renderStatus(opts: StatusOptions): void {
  const snapshot = buildStatusSnapshot(opts);

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (opts.clear !== false) {
    process.stdout.write("\x1B[2J\x1B[0f");
  }
  console.log(formatStatusOutput(snapshot));
}

function watchStatus(opts: StatusOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const render = () => {
      try {
        renderStatus(opts);
      } catch (error) {
        clearInterval(timer);
        reject(error);
      }
    };
    const timer = setInterval(render, parsePositiveInt(opts.interval, 1000));
    process.once("SIGINT", () => {
      clearInterval(timer);
      resolve();
    });
    render();
  });
}

export function registerFacadeCommands(program: Command): void {
  // ── syncpoint status ────────────────────────────────
  program
    .command("status")
    .description("Show current synchronization state — who is blocked, why, and what to do")
    .option("--session <sessionId>", "Scope to a specific session")
    .option("--agent <nameOrId>", "Agent name or ID for agent-specific gate actions")
    .option("-w, --watch", "Refresh status until Ctrl+C", false)
    .option("--interval <ms>", "Refresh interval for --watch", "1000")
    .option("--events <n>", "Number of recent events to show", "5")
    .option("--no-clear", "Do not clear the terminal between refreshes")
    .option("--json", "Machine-readable JSON output")
    .action(async (opts: StatusOptions) => {
      if (opts.watch) {
        await watchStatus(opts);
        return;
      }

      renderStatus({ ...opts, clear: false });
    });

  // ── syncpoint claim <paths> ─────────────────────────
  program
    .command("claim")
    .description("Declare resource ownership for the current task")
    .argument("<locators>", "Comma-separated resource locators (file paths, asset names, etc.)")
    .requiredOption("--agent <nameOrId>", "Agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--type <type>", "Resource type (file, binary_asset, db_table, ...)", "file")
    .option("--scope <scope>", "Claim granularity: file, function, or line_range", "file")
    .option("--function <name>", "Function name when --scope function")
    .option("--lines <start>-<end>", "Line range when --scope line_range (e.g. 10-30)")
    .option("--session <sessionId>", "Session ID")
    .option("--mode <mode>", "Claim mode: exclusive or shared", "exclusive")
    .option("--batch <file>", "Batch claim from a JSON or YAML file (one claim per line or array)")
    .option("--json", "Machine-readable JSON output")
    .action((locators, opts) => {
      if (opts.batch) {
        // Batch claim from file
        const batchPath = path.resolve(opts.batch);
        if (!fs.existsSync(batchPath)) {
          console.error(`Batch file not found: ${batchPath}`);
          process.exitCode = 1;
          return;
        }
        const raw = fs.readFileSync(batchPath, "utf-8");
        let entries: Array<{ locator: string; type?: string; scope?: string; functionName?: string; lineRange?: { start: number; end: number } }>;
        try {
          entries = JSON.parse(raw);
          if (!Array.isArray(entries)) entries = [entries];
        } catch {
          // Try line-by-line: each line is "locator [type] [scope]"
          entries = raw.split("\n").filter(line => line.trim() && !line.trim().startsWith("#")).map(line => {
            const parts = line.trim().split(/\s+/);
            return { locator: parts[0] ?? line.trim(), type: parts[1], scope: parts[2] };
          });
        }
        let successCount = 0;
        let conflictCount = 0;
        for (const entry of entries) {
          try {
            const result = rcClaim({
              actorId: requireAgentId(opts.agent),
              taskId: opts.task,
              sessionId: opts.session,
              resources: [{
                type: entry.type ?? opts.type ?? "file",
                locator: entry.locator,
                scope: (entry.scope ?? "file") as "file" | "function" | "line_range",
                metadata: "",
                ...(entry.functionName ? { functionName: entry.functionName } : {}),
                ...(entry.lineRange ? { lineRange: entry.lineRange } : {}),
              }],
              mode: opts.mode,
            });
            successCount++;
            if (result.conflicts.length > 0) conflictCount++;
          } catch (e) {
            if (opts.json) {
              console.log(JSON.stringify({ locator: entry.locator, error: (e as Error).message }));
            } else {
              console.error(`  Failed: ${entry.locator} — ${(e as Error).message}`);
            }
          }
        }
        if (opts.json) {
          console.log(JSON.stringify({ status: "batch_complete", total: entries.length, succeeded: successCount, conflicts: conflictCount }));
        } else {
          console.log(`Batch claim complete: ${successCount}/${entries.length} succeeded, ${conflictCount} conflict(s)`);
        }
        return;
      }

      const agentId = requireAgentId(opts.agent);
      let lineRange: { start: number; end: number } | undefined;
      if (opts.scope === "line_range" && opts.lines) {
        const parts = String(opts.lines).split("-").map(Number);
        if (parts.length === 2 && parts[0]! > 0 && parts[1]! >= parts[0]!) {
          lineRange = { start: parts[0]!, end: parts[1]! };
        } else {
          console.error(`Invalid --lines format: ${opts.lines}. Expected <start>-<end> (e.g. 10-30).`);
          process.exitCode = 1;
          return;
        }
      }
      const resources: ResourceRef[] = locators.split(",").map((p: string) => ({
        type: opts.type as string,
        locator: p.trim(),
        metadata: "",
        ...(opts.scope && opts.scope !== "file" ? { scope: opts.scope } : {}),
        ...(opts.scope === "function" && opts.function ? { functionName: opts.function } : {}),
        ...(lineRange ? { lineRange } : {}),
      }));
      const result = rcClaim({
        actorId: agentId,
        taskId: opts.task,
        sessionId: opts.session,
        resources,
        mode: opts.mode,
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const scopeDesc = opts.scope !== "file" ? `, scope=${opts.scope}${opts.function ? `:${opts.function}` : ""}${lineRange ? `:${lineRange.start}-${lineRange.end}` : ""}` : "";
      const resourceList = resources.map((r) => {
        let desc = r.locator;
        if (r.scope === "function" && r.functionName) desc += ` [function:${r.functionName}]`;
        if (r.scope === "line_range" && r.lineRange) desc += ` [lines:${r.lineRange.start}-${r.lineRange.end}]`;
        return desc;
      }).join(", ");
      console.log(`✅ Claimed: ${resourceList}`);
      console.log(`   Agent: ${agentId} | Task: ${opts.task} | Mode: ${opts.mode}${scopeDesc}`);
      console.log(`   Claim ID: ${result.claim.id}`);
      if (result.conflicts.length > 0) {
        console.log("");
        console.log(`⚠️  ${result.conflicts.length} conflict(s) detected:`);
        for (const c of result.conflicts) {
          const isHard = c.isHardConflict ? "🔒 HARD" : "ℹ️  SOFT";
          console.log(`   ${isHard} ${c.overlappingLocator}`);
        }
      }
      if (result.gateId) {
        console.log("");
        console.log(`🚧 SyncGate created: ${result.gateId}`);
        console.log("   Both agents must acknowledge and resolve before continuing.");
      }
    });

  // ── syncpoint release ────────────────────────────────
  program
    .command("release")
    .description("Release resource claims")
    .option("--claim <claimId>", "Release a specific claim by ID")
    .option("--all", "Release all claims for the specified agent")
    .option("--agent <nameOrId>", "Agent name or ID (required for --all)")
    .option("--task <taskId>", "Filter --all by task")
    .option("--session <sessionId>", "Session ID")
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      try {
        if (opts.claim) {
          // Release specific claim
          const released = rcRelease(opts.claim);
          if (opts.json) {
            console.log(JSON.stringify(released, null, 2));
          } else {
            console.log(`✅ Released: ${released.id}`);
            const resources = released.resources?.map((r: any) => r.locator).join(", ") ?? "";
            console.log(`   Resources: ${resources}`);
            console.log(`   Status: ${released.status}`);
          }
          return;
        }

        if (opts.all) {
          if (!opts.agent) {
            console.error("--all requires --agent to be specified.");
            process.exitCode = 1;
            return;
          }
          const agentId = requireAgentId(opts.agent);
          const claims = rcList({
            actorId: agentId,
            taskId: opts.task,
            sessionId: opts.session,
            status: "ACTIVE",
          });
          const releasedIds: string[] = [];
          const errors: string[] = [];
          for (const claim of claims) {
            try {
              rcRelease(claim.id);
              releasedIds.push(claim.id);
            } catch (e) {
              errors.push(`${claim.id}: ${(e as Error).message}`);
            }
          }
          if (opts.json) {
            console.log(JSON.stringify({ released: releasedIds.length, errors: errors.length, releasedIds }));
          } else {
            console.log(`✅ Released ${releasedIds.length} claim(s) for agent ${agentId}`);
            if (errors.length > 0) {
              console.log(`⚠️  ${errors.length} error(s):`);
              for (const e of errors) console.log(`   ${e}`);
            }
          }
          return;
        }

        console.error("Please specify --claim <claimId> or --all --agent <agent>.");
        console.error("Run 'syncpoint release --help' for usage.");
        process.exitCode = 1;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  // ── syncpoint resume ────────────────────────────────
  program
    .command("resume")
    .description("Resume work from the latest snapshot/checkpoint")
    .requiredOption("--agent <nameOrId>", "Agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .option("--provider <provider>", "Editor provider override")
    .addOption(new Option("--context-mode <mode>", "Context mode").choices(["snapshot-first", "snapshot-only", "snapshot-locked"]))
    .option("--session <sessionId>", "Session ID for protocol gate scoping")
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      try {
        const agentId = requireAgentId(opts.agent);
        const result = loopResume({
          agentId,
          taskId: opts.task,
          provider: opts.provider,
          contextMode: opts.contextMode,
          sessionId: opts.session,
        });

        if (opts.json) {
          const { files, ...rest } = result;
          console.log(JSON.stringify(rest, null, 2));
          return;
        }

        // Get agent/task info for display
        let agentName = agentId;
        let taskTitle = opts.task;
        try { agentName = repo.getAgent(agentId).name; } catch {}
        try { taskTitle = repo.getTask(opts.task).title; } catch {}

        // Get snapshot for resume info
        let snapshotInfo: any = {};
        try {
          const snapshot = repo.getLatestContextSnapshot(opts.task, agentId);
          if (snapshot) {
            const payload = snapshot.payload ?? {};
            snapshotInfo = {
              goal: payload.goal,
              phase: payload.currentPhase,
              completedWork: payload.completedWork,
              remainingWork: payload.remainingWork,
              workingResources: payload.workingResources,
              blockers: payload.blockers,
              nextSteps: payload.nextSteps,
            };
          }
        } catch {}

        const blocked = result.protocolGateBlocked || !result.snapshotValid;

        const explanation = formatResumeExplanation({
          agentId,
          agentName,
          taskTitle,
          blocked,
          snapshotValid: result.snapshotValid,
          protocolGateBlocked: result.protocolGateBlocked,
          validationNotes: result.validationNotes,
          constraintWarnings: result.constraintWarnings,
          ...snapshotInfo,
        });

        console.log(explanation);

        if (!blocked) {
          console.log("─".repeat(40));
          console.log("Resume prompt:");
          console.log(result.prompt);
        }
      } catch (err: unknown) {
        if (err instanceof LoopError) {
          console.error(`Blocked (exit ${err.exitCode}): ${err.message}`);
          process.exitCode = err.exitCode;
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${msg}`);
          process.exitCode = 1;
        }
      }
    });

  // ── syncpoint checkpoint ────────────────────────────
  program
    .command("checkpoint")
    .description("Save progress and create a context snapshot")
    .requiredOption("--agent <nameOrId>", "Agent name or ID")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--summary <text>", "Checkpoint summary")
    .option("--progress <text>", "Progress description", "")
    .option("--next-steps <text>", "Next steps", "")
    .option("--risks <text>", "Risks", "")
    .option("--blockers <text>", "Blockers", "")
    .option("--goal <text>", "Snapshot goal")
    .option("--phase <text>", "Current phase", "")
    .option("--completed <text>", "Completed work", "")
    .option("--remaining <text>", "Remaining work", "")
    .option("--working-resources <text>", "Working resources", "")
    .option("--need-sync", "Flag task as needing sync", false)
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      try {
        const agentId = requireAgentId(opts.agent);
        const result = loopCheckpoint({
          agentId,
          taskId: opts.task,
          summary: opts.summary,
          progress: opts.progress,
          nextSteps: opts.nextSteps,
          risks: opts.risks,
          blockers: opts.blockers,
          goal: opts.goal,
          phase: opts.phase,
          completed: opts.completed,
          remaining: opts.remaining,
          workingResources: opts.workingResources,
          needSync: opts.needSync,
        });

        if (opts.json) {
          const { files, ...rest } = result;
          console.log(JSON.stringify(rest, null, 2));
          return;
        }

        console.log(`Checkpoint saved: ${result.checkpointId}`);
        console.log(`Snapshot:         ${result.snapshotId}`);
        if (result.needSync) {
          console.log("  Task flagged for sync.");
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  // ── syncpoint snapshot gc ────────────────────────────
  program
    .command("snapshot-gc")
    .description("Run garbage collection on context snapshots")
    .option("--keep-last-n <n>", "Keep the last N snapshots per task+agent", "50")
    .option("--max-age-days <d>", "Delete snapshots older than D days", "30")
    .option("--max-size-mb <mb>", "Delete oldest snapshots until total size is under this limit (MB)", "100")
    .option("--keep-checkpoints", "Only keep snapshots linked to approved/rejected checkpoint reviews", false)
    .option("--dry-run", "Show what would be deleted without deleting", false)
    .option("--json", "Machine-readable JSON output", false)
    .action((opts) => {
      try {
        const config = {
          keepLastN: parseInt(opts.keepLastN, 10) || 50,
          maxAgeDays: parseInt(opts.maxAgeDays, 10) || 30,
          maxTotalMb: parseInt(opts.maxSizeMb, 10) || 100,
          keepCheckpoints: opts.keepCheckpoints === true,
        };
        if (opts.dryRun) {
          console.log("Dry run — no snapshots will be deleted.");
          console.log(`Config: keepLastN=${config.keepLastN}, maxAgeDays=${config.maxAgeDays}, maxTotalMb=${config.maxTotalMb}, keepCheckpoints=${config.keepCheckpoints}`);
          return;
        }
        const result = repo.runSnapshotGc(config);
        if (opts.json) {
          console.log(JSON.stringify(result));
          return;
        }
        console.log(`GC complete: deleted ${result.deletedCount} snapshot(s), freed ~${(result.freedBytes / 1024).toFixed(1)}KB`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Error: ${msg}`);
        process.exitCode = 1;
      }
    });

  // ── syncpoint wake ──────────────────────────────────
  program
    .command("wake")
    .description("Check or acknowledge pending wake requests")
    .option("--agent <agentId>", "Agent ID to check wakes for")
    .option("--session <sessionId>", "Session ID")
    .option("--ack <wakeId>", "Acknowledge a wake request")
    .option("--json", "Machine-readable JSON output")
    .action((opts) => {
      if (opts.ack) {
        const result = wakeAck(opts.ack);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Wake acknowledged: ${result.id} → ${result.status}`);
        }
        return;
      }

      if (opts.agent) {
        const next = wakeNext(opts.agent);
        if (opts.json) {
          console.log(JSON.stringify(next, null, 2));
          return;
        }
        if (next) {
          console.log(`Next wake for agent:`);
          console.log(`  ID:     ${next.id}`);
          console.log(`  Reason: ${next.reason || "sync obligation"}`);
          console.log(`  Event:  ${next.triggerEventType || "unknown"}`);
          console.log("");
          console.log(`Acknowledge: syncpoint wake --ack ${next.id}`);
        } else {
          console.log("No pending wake requests.");
        }
        return;
      }

      // List all
      const all = wakeList({
        sessionId: opts.session,
        status: "QUEUED",
      });

      if (opts.json) {
        console.log(JSON.stringify(all, null, 2));
        return;
      }

      if (all.length === 0) {
        console.log("No pending wake requests.");
        return;
      }

      console.log(`${all.length} pending wake(s):`);
      for (const w of all) {
        let agentName = w.targetAgentId;
        try { agentName = repo.getAgent(w.targetAgentId).name; } catch {}
        console.log(`  ${agentName}: ${w.reason || w.triggerEventType || "sync obligation"} [${w.status}]`);
      }
    });
}
