/**
 * CLI commands for PatchProposal — propose, submit, check, approve, reject, apply.
 */

import { Command } from "commander";
import fs from "node:fs";
import {
  ppPropose, ppSubmit, ppCheck, ppApprove,
  ppReject, ppApply, ppCancel, ppStatus, ppList,
} from "syncpoint-server/application";

export const patchCmd = new Command("patch")
  .description("Patch proposal management");

patchCmd
  .command("propose")
  .description("Create a draft patch proposal")
  .requiredOption("--session <id>", "Session ID")
  .requiredOption("--task <id>", "Task ID")
  .requiredOption("--agent <id>", "Agent ID")
  .requiredOption("--title <title>", "Patch title")
  .option("--summary <text>", "Patch summary")
  .requiredOption("--file <path>", "Path to diff/patch file")
  .option("--json", "JSON output")
  .action((opts) => {
    const patchText = fs.readFileSync(opts.file, "utf-8");
    const result = ppPropose({
      sessionId: opts.session,
      taskId: opts.task,
      agentId: opts.agent,
      title: opts.title,
      summary: opts.summary,
      patchText,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch proposal created: ${result.id} [${result.status}]`);
      console.log(`  Title:   ${result.title}`);
      console.log(`  Files:   ${result.touchedFiles || "(none extracted)"}`);
    }
  });

patchCmd
  .command("submit")
  .description("Submit a draft patch for checking")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppSubmit(opts.patch);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.proposal.id} → ${result.proposal.status}`);
      if (result.checkResult) {
        console.log(`  Checks: ${result.checkResult.allPassed ? "ALL PASSED" : "FAILED"}`);
        for (const item of result.checkResult.items) {
          console.log(`    ${item.passed ? "✓" : "✗"} ${item.check}: ${item.detail}`);
        }
      }
    }
  });

patchCmd
  .command("check")
  .description("Run ownership/conflict checks on a patch")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppCheck(opts.patch);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.proposal.id} check:`);
      if (result.checkResult) {
        console.log(`  Result: ${result.checkResult.allPassed ? "ALL PASSED" : "FAILED"}`);
        for (const item of result.checkResult.items) {
          console.log(`    ${item.passed ? "✓" : "✗"} ${item.check}: ${item.detail}`);
        }
      }
    }
  });

patchCmd
  .command("approve")
  .description("Approve a submitted patch")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .requiredOption("--agent <id>", "Approving agent ID")
  .option("--summary <text>", "Approval summary")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppApprove(opts.patch, opts.agent, opts.summary);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("reject")
  .description("Reject a submitted patch")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .requiredOption("--agent <id>", "Rejecting agent ID")
  .option("--reason <text>", "Rejection reason")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppReject(opts.patch, opts.agent, opts.reason);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("apply")
  .description("Mark an approved patch as applied")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppApply(opts.patch);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("cancel")
  .description("Cancel a patch proposal")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .option("--reason <text>", "Cancellation reason")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppCancel(opts.patch, opts.reason);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Patch ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("status")
  .description("Get patch proposal status with check results")
  .requiredOption("--patch <id>", "Patch proposal ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppStatus(opts.patch);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const p = result.proposal;
      console.log(`Patch ${p.id} [${p.status}]`);
      console.log(`  Title:   ${p.title}`);
      console.log(`  Agent:   ${p.agentId}`);
      console.log(`  Files:   ${p.touchedFiles || "(none)"}`);
      if (result.checkResult) {
        console.log(`  Checks:  ${result.checkResult.allPassed ? "ALL PASSED" : "FAILED"}`);
      }
      if (p.decisionSummary) {
        console.log(`  Decision: ${p.decisionSummary}`);
      }
    }
  });

patchCmd
  .command("list")
  .description("List patch proposals")
  .option("--session <id>", "Filter by session")
  .option("--task <id>", "Filter by task")
  .option("--agent <id>", "Filter by agent")
  .option("--status <status>", "Filter by status")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = ppList({
      sessionId: opts.session,
      taskId: opts.task,
      agentId: opts.agent,
      status: opts.status,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.length === 0) {
        console.log("No patch proposals found.");
      } else {
        for (const p of result) {
          console.log(`${p.id}  [${p.status}]  ${p.title}  (${p.touchedFiles || "no files"})`);
        }
      }
    }
  });
