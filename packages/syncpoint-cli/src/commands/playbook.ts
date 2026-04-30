/**
 * CLI commands for Playbook — next-action, capture-evidence, active-session.
 */

import { Command } from "commander";
import { pbGetNextAction, pbCaptureEvidence, pbGetActiveSession } from "syncpoint-server/application";
import type { EvidenceKind } from "syncpoint-core";

export function registerPlaybookCommands(program: Command): void {
  const playbook = program
    .command("playbook")
    .description("Synchronization playbook — next sync actions and evidence capture");

  // ── next-action ────────────────────────────────────
  playbook
    .command("next-action")
    .description("Get the next recommended sync action for an agent in a session")
    .requiredOption("--session <id>", "Session ID")
    .requiredOption("--agent <id>", "Agent ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      try {
        const result = pbGetNextAction({ sessionId: opts.session, agentId: opts.agent });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Session: ${result.sessionId} [${result.sessionStatus}]`);
          console.log(`Agent: ${result.agentId}`);
          console.log(`\nRecommended actions (${result.actions.length}):`);
          for (const a of result.actions) {
            console.log(`  [P${a.priority}] ${a.action}`);
            console.log(`        ${a.reason}`);
            if (a.cliHint) console.log(`        CLI: ${a.cliHint}`);
          }
        }
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── active-session ─────────────────────────────────
  playbook
    .command("active-session")
    .description("Find the active sync session for an agent and show next actions")
    .requiredOption("--agent <id>", "Agent ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      try {
        const result = pbGetActiveSession(opts.agent);
        if (!result) {
          if (opts.json) {
            console.log(JSON.stringify({ active: false }));
          } else {
            console.log("No active session for this agent.");
          }
          return;
        }
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Active session: ${result.sessionId} [${result.sessionStatus}]`);
          console.log(`Agent: ${result.agentName} (${result.agentId})`);
          console.log(`Roles: ${result.roles.join(", ")}`);
          console.log(`Assignments: ${result.assignmentCount}  Reviews: ${result.reviewCount}`);
          console.log(`\nNext actions (${result.actions.length}):`);
          for (const a of result.actions) {
            console.log(`  [P${a.priority}] ${a.action}`);
            console.log(`        ${a.reason}`);
            if (a.cliHint) console.log(`        CLI: ${a.cliHint}`);
          }
        }
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
      }
    });

  // ── capture-evidence ───────────────────────────────
  playbook
    .command("capture-evidence")
    .description("Record command output as review evidence")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--command <cmd>", "Command that was run")
    .requiredOption("--output <text>", "Command output to record")
    .option("--exit-code <n>", "Exit code of the command", parseInt)
    .option("--kind <kind>", "Evidence kind (auto-detected if omitted)")
    .option("--json", "Output JSON")
    .action((opts) => {
      try {
        const result = pbCaptureEvidence({
          reviewRequestId: opts.review,
          command: opts.command,
          output: opts.output,
          exitCode: opts.exitCode,
          kind: opts.kind as EvidenceKind | undefined,
        });
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Evidence captured: ${result.evidence.id}`);
          console.log(`  Kind: ${result.kind}`);
          console.log(`  Title: ${result.title}`);
        }
      } catch (err: any) {
        console.error(err.message);
        process.exitCode = 1;
      }
    });
}
