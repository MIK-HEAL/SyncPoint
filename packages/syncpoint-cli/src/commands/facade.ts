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

import { Command, Option } from "commander";
import {
  buildSnapshot,
  rcClaim,
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
  if (!agent) throw new Error(`Agent not found: "${nameOrId}". Use an agent ID or registered name.`);
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
    .option("--session <sessionId>", "Session ID")
    .option("--mode <mode>", "Claim mode: exclusive or shared", "exclusive")
    .option("--json", "Machine-readable JSON output")
    .action((locators, opts) => {
      const agentId = requireAgentId(opts.agent);
      const resources = locators.split(",").map((p: string) => ({
        type: opts.type as string,
        locator: p.trim(),
        metadata: "",
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

      console.log(`Claimed: ${locators} (${opts.type}, ${opts.mode})`);
      if (result.conflicts.length > 0) {
        console.log("");
        console.log("Conflicts detected:");
        for (const c of result.conflicts) {
          console.log(`  [conflict] ${c.overlappingLocator}`);
        }
      }
      if (result.gateId) {
        console.log("");
        console.log(`SyncGate created: ${result.gateId}`);
        console.log("  Both agents must acknowledge and resolve before continuing.");
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
