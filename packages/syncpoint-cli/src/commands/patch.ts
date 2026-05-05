/**
 * CLI commands for operations (code patches) — create, submit, check, approve, reject, apply.
 */

import { Command } from "commander";
import {
  opCreate, opSubmit, opCheck, opApprove,
  opReject, opApply, opCancel, opStatus, opList,
} from "syncpoint-server/application";

export const patchCmd = new Command("patch")
  .description("Operation (code patch) management");

patchCmd
  .command("propose")
  .description("Create a draft operation")
  .requiredOption("--session <id>", "Session ID")
  .requiredOption("--task <id>", "Task ID")
  .requiredOption("--agent <id>", "Agent ID")
  .requiredOption("--title <title>", "Operation title")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opCreate({
      type: "code_patch",
      sessionId: opts.session,
      taskId: opts.task,
      actorId: opts.agent,
      title: opts.title,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation created: ${result.id} [${result.status}]`);
      console.log(`  Title:   ${result.title}`);
    }
  });

patchCmd
  .command("submit")
  .description("Submit a draft operation for checking")
  .requiredOption("--id <id>", "Operation ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opSubmit(opts.id);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.operation.id} → ${result.operation.status}`);
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
  .description("Run checks on an operation")
  .requiredOption("--id <id>", "Operation ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opCheck(opts.id);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.operation.id} check:`);
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
  .description("Approve a submitted operation")
  .requiredOption("--id <id>", "Operation ID")
  .requiredOption("--agent <id>", "Approving agent ID")
  .option("--summary <text>", "Approval summary")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opApprove(opts.id, opts.agent, opts.summary);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("reject")
  .description("Reject a submitted operation")
  .requiredOption("--id <id>", "Operation ID")
  .requiredOption("--agent <id>", "Rejecting agent ID")
  .option("--reason <text>", "Rejection reason")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opReject(opts.id, opts.agent, opts.reason);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("apply")
  .description("Mark an approved operation as applied")
  .requiredOption("--id <id>", "Operation ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opApply(opts.id);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("cancel")
  .description("Cancel an operation")
  .requiredOption("--id <id>", "Operation ID")
  .option("--reason <text>", "Cancellation reason")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opCancel(opts.id, opts.reason);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Operation ${result.id} → ${result.status}`);
    }
  });

patchCmd
  .command("status")
  .description("Get operation status with check results")
  .requiredOption("--id <id>", "Operation ID")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opStatus(opts.id);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      const op = result.operation;
      console.log(`Operation ${op.id} [${op.status}]`);
      console.log(`  Title:   ${op.title}`);
      console.log(`  Actor:   ${op.actorId}`);
      if (result.checkResult) {
        console.log(`  Checks:  ${result.checkResult.allPassed ? "ALL PASSED" : "FAILED"}`);
      }
    }
  });

patchCmd
  .command("list")
  .description("List operations")
  .option("--task <id>", "Filter by task")
  .option("--agent <id>", "Filter by actor")
  .option("--status <status>", "Filter by status")
  .option("--json", "JSON output")
  .action((opts) => {
    const result = opList({
      type: "code_patch",
      taskId: opts.task,
      actorId: opts.agent,
      status: opts.status,
    });
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.length === 0) {
        console.log("No operations found.");
      } else {
        for (const op of result) {
          console.log(`${op.id}  [${op.status}]  ${op.title}`);
        }
      }
    }
  });
