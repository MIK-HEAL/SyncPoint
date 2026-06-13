/**
 * CLI: syncpoint loop — composite agent workflow commands.
 */

import { Command, Option } from "commander";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  loopBoot,
  loopResume,
  loopCheckpoint,
  loopHandoff,
  loopStatus,
  LoopError,
} from "syncpoint-server/application";

function fail(code: number, message: string, json: boolean): never {
  if (json) console.log(JSON.stringify({ ok: false, error: message, exitCode: code }));
  else console.error(`Error: ${message}`);
  process.exitCode = code;
  throw new LoopError(code, message);
}

function catchLoop(err: unknown, json: boolean): void {
  if (process.exitCode) return;
  const code = err instanceof LoopError ? err.exitCode : 1;
  const msg = err instanceof Error ? err.message : String(err);
  fail(code, msg, json);
}

function writeFiles(files: Record<string, string>) {
  for (const [fp, content] of Object.entries(files)) {
    const dir = path.dirname(fp);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fp, content, "utf-8");
  }
}

export function registerLoopCommand(program: Command): void {
  program
    .command("loop")
    .description("Agent workflow loop — composite commands for AI editors")
    .addCommand(
      new Command("boot")
        .description("Boot: assign task, enforce context policy, generate editor rules files")
        .requiredOption("--agent <agentId>", "Agent ID")
        .requiredOption("--task <taskId>", "Task ID")
        .option("--provider <provider>", "Editor provider override")
        .option("--json", "Machine-readable JSON output")
        .action(async (opts) => {
          const isJson = !!opts.json;
          try {
            const result = loopBoot({
              agentId: opts.agent,
              taskId: opts.task,
              provider: opts.provider,
            });
            writeFiles(result.files);

            if (isJson) {
              const { files, ...rest } = result;
              console.log(JSON.stringify(rest));
            } else {
              console.log(`✓ loop boot: agent ${result.agentId} → task ${result.taskId}`);
              console.log(`  Task status: ${result.taskStatus}`);
              console.log(`  Context ready: ${result.contextReady}`);
              for (const f of result.filesWritten) console.log(`  ✓ ${f}`);
              if (result.warnings.length) {
                console.log("  Warnings:");
                for (const w of result.warnings) console.log(`    - ${w}`);
              }
            }
          } catch (err: unknown) { catchLoop(err, isJson); }
        })
    )
    .addCommand(
      new Command("resume")
        .description("Resume: enforce context, regenerate editor rules, output resume prompt")
        .requiredOption("--agent <agentId>", "Agent ID")
        .requiredOption("--task <taskId>", "Task ID")
        .option("--provider <provider>", "Editor provider override")
        .option("--format <format>", "Prompt output format: system-prompt|cursorrules|agents-md|clipboard", "system-prompt")
        .addOption(new Option("--context-mode <mode>", "Context mode").choices(["snapshot-first", "snapshot-only", "snapshot-locked"]))
        .option("--session <sessionId>", "Session ID for protocol gate scoping")
        .option("--json", "Machine-readable JSON output")
        .action(async (opts) => {
          const isJson = !!opts.json;
          try {
            const result = loopResume({
              agentId: opts.agent,
              taskId: opts.task,
              provider: opts.provider,
              format: opts.format,
              contextMode: opts.contextMode,
              sessionId: opts.session,
            });
            writeFiles(result.files);

            if (isJson) {
              const { files, ...rest } = result;
              console.log(JSON.stringify(rest));
            } else {
              console.log(`✓ loop resume: agent ${result.agentId} → task ${result.taskId}`);
              for (const f of result.filesWritten) console.log(`  ✓ ${f}`);
              console.log("\n" + result.prompt);
            }
          } catch (err: unknown) { catchLoop(err, isJson); }
        })
    )
    .addCommand(
      new Command("checkpoint")
        .description("Checkpoint: save progress + context snapshot + refresh editor rules")
        .requiredOption("--agent <agentId>", "Agent ID")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--summary <text>", "Checkpoint summary")
        .option("--progress <text>", "Progress description", "")
        .option("--next-steps <text>", "Next steps", "")
        .option("--risks <text>", "Risks", "")
        .option("--blockers <text>", "Blockers", "")
        .option("--goal <text>", "Snapshot goal (inherits from latest if empty)")
        .option("--phase <text>", "Current phase", "")
        .option("--completed <text>", "Completed work", "")
        .option("--remaining <text>", "Remaining work", "")
        .option("--working-resources <text>", "Working resources", "")
        .option("--resume-prompt <text>", "Custom resume prompt for snapshot")
        .option("--need-sync", "Flag task as needing sync", false)
        .option("--provider <provider>", "Editor provider override")
        .option("--json", "Machine-readable JSON output")
        .action(async (opts) => {
          const isJson = !!opts.json;
          try {
            const result = loopCheckpoint({
              agentId: opts.agent,
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
              resumePrompt: opts.resumePrompt,
              needSync: opts.needSync,
              provider: opts.provider,
            });
            writeFiles(result.files);

            if (isJson) {
              const { files, ...rest } = result;
              console.log(JSON.stringify(rest));
            } else {
              console.log(`✓ loop checkpoint: ${opts.summary}`);
              console.log(`  Checkpoint: ${result.checkpointId}`);
              console.log(`  Snapshot:   ${result.snapshotId}`);
              if (result.needSync) console.log("  ⚠ Task flagged for sync");
              for (const f of result.filesWritten) console.log(`  ✓ ${f}`);
            }
          } catch (err: unknown) { catchLoop(err, isJson); }
        })
    )
    .addCommand(
      new Command("handoff")
        .description("Handoff: save snapshot, create handoff, generate rules for receiver")
        .requiredOption("--task <taskId>", "Task ID")
        .requiredOption("--from <fromAgentId>", "Sending agent ID")
        .requiredOption("--to <toAgentId>", "Receiving agent ID")
        .requiredOption("--context <text>", "Handoff context / summary")
        .option("--auto-accept", "Automatically accept the handoff")
        .option("--provider <provider>", "Receiver's editor provider override")
        .option("--json", "Machine-readable JSON output")
        .action(async (opts) => {
          const isJson = !!opts.json;
          try {
            const result = loopHandoff({
              taskId: opts.task,
              fromAgentId: opts.from,
              toAgentId: opts.to,
              context: opts.context,
              autoAccept: opts.autoAccept,
              provider: opts.provider,
            });
            writeFiles(result.files);

            if (isJson) {
              const { files, ...rest } = result;
              console.log(JSON.stringify(rest));
            } else {
              console.log(`✓ loop handoff: ${result.from} → ${result.to}`);
              console.log(`  Handoff: ${result.handoffId}${result.accepted ? " (auto-accepted)" : " (pending acceptance)"}`);
              for (const f of result.filesWritten) console.log(`  ✓ ${f}`);
            }
          } catch (err: unknown) { catchLoop(err, isJson); }
        })
    )
    .addCommand(
      new Command("status")
        .description("Show agent's current task status and context readiness")
        .requiredOption("--agent <agentId>", "Agent ID")
        .option("--task <taskId>", "Task ID (defaults to agent's current task)")
        .option("--json", "Machine-readable JSON output")
        .action(async (opts) => {
          const isJson = !!opts.json;
          try {
            const result = loopStatus({
              agentId: opts.agent,
              taskId: opts.task,
            });

            if (isJson) {
              console.log(JSON.stringify(result));
            } else {
              if (!result.hasTask) {
                console.log(`Agent ${result.agentName} (${result.agentId}) — no current task`);
                return;
              }
              console.log(`Agent:      ${result.agentName} (${result.agentId}) [${result.agentStatus}]`);
              console.log(`Task:       ${result.taskTitle} (${result.taskId}) [${result.taskStatus}]`);
              console.log(`Contract:   ${result.contractStatus ?? "none"}`);
              console.log(`Checkpoints: ${result.checkpointCount}`);
              console.log(`Snapshot:   ${result.hasSnapshot ? "yes" : "none"}`);
              console.log(`Context:    ${result.contextReady ? "✓ ready" : "✗ not ready"}`);
              if (result.warnings?.length) {
                console.log("Warnings:");
                for (const w of result.warnings) console.log(`  - ${w}`);
              }
            }
          } catch (err: unknown) { catchLoop(err, isJson); }
        })
    );
}
