import { Command, Option } from "commander";
import { LoopError } from "syncpoint-server/application";
import { loopResume, loopCheckpoint, wakeNext, wakeAck, wakeList } from "syncpoint-server/application";
import * as repo from "syncpoint-server/repositories";
import { formatResumeExplanation } from "../formatter.js";
import { requireAgentId } from "./shared.js";

export function registerLoopCommands(program: Command): void {
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

