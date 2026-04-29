/**
 * CLI: syncpoint sync — synchronization gate commands.
 */

import { Command } from "commander";
import {
  sgRequest,
  sgAck,
  sgResolve,
  sgCancel,
  sgStatus,
  sgList,
  sgCheckAgent,
  stxCreate,
  stxApprove,
  stxReject,
  stxResolve,
  stxCancel,
  stxStatus,
  stxList,
} from "syncpoint-server/application";

function csv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

function print(value: unknown, json: boolean): void {
  if (json) console.log(JSON.stringify(value, null, 2));
}

function printGateStatus(result: ReturnType<typeof sgStatus>, json: boolean): void {
  if (json) {
    print(result, true);
    return;
  }

  console.log(`SyncGate: ${result.gate.id} [${result.gate.status}]`);
  console.log(`  Task: ${result.gate.taskId}`);
  if (result.gate.sessionId) console.log(`  Session: ${result.gate.sessionId}`);
  console.log(`  Reason: ${result.gate.reason}`);
  console.log(`  Required: ${result.gate.requiredAgentIds || "none"}`);
  console.log(`  Acked: ${result.gate.ackedAgentIds || "none"}`);
  console.log(`  Pending: ${result.pending.join(", ") || "none"}`);
  console.log(`  Blocking: ${result.isBlocking ? "yes" : "no"}`);
  if (result.gate.description) console.log(`  Description: ${result.gate.description}`);
  if (result.gate.decisionSummary) console.log(`  Decision: ${result.gate.decisionSummary}`);
}

export function registerSyncCommands(program: Command): void {
  const sync = program
    .command("sync")
    .description("Manage synchronization gates");

  sync
    .command("request")
    .description("Request a synchronization gate")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Requesting agent ID")
    .option("--required <agentIds>", "Comma-separated required agent IDs; defaults to --agent")
    .option("--session <sessionId>", "Session ID")
    .option("--reason <reason>", "file_conflict|phase_transition|manual_request|checkpoint_required|context_drift", "manual_request")
    .option("--description <text>", "Sync request description", "")
    .option("--files <paths>", "Related files")
    .option("--checkpoint <id>", "Related checkpoint ID")
    .option("--claims <ids>", "Related file claim IDs")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = sgRequest({
        sessionId: opts.session,
        taskId: opts.task,
        requestedByAgentId: opts.agent,
        requiredAgentIds: csv(opts.required).length > 0 ? csv(opts.required) : [opts.agent],
        reason: opts.reason,
        description: opts.description,
        relatedFiles: opts.files,
        relatedCheckpointId: opts.checkpoint,
        relatedClaimIds: opts.claims,
      });

      if (opts.json) print(result, true);
      else {
        console.log(`SyncGate requested: ${result.gate.id} [${result.gate.status}]`);
        console.log(`  Required: ${result.gate.requiredAgentIds}`);
        console.log(`  Pending: ${result.pending.join(", ") || "none"}`);
      }
    });

  sync
    .command("ack")
    .description("Acknowledge a synchronization gate")
    .requiredOption("--gate <gateId>", "SyncGate ID")
    .requiredOption("--agent <agentId>", "Acknowledging agent ID")
    .option("--summary <text>", "Acknowledgement summary", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = sgAck(opts.gate, opts.agent, opts.summary);
      printGateStatus(result, !!opts.json);
    });

  sync
    .command("resolve")
    .description("Resolve an acknowledged synchronization gate")
    .requiredOption("--gate <gateId>", "SyncGate ID")
    .option("--summary <text>", "Decision summary", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = sgResolve(opts.gate, opts.summary);
      printGateStatus(result, !!opts.json);
    });

  sync
    .command("cancel")
    .description("Cancel a synchronization gate")
    .requiredOption("--gate <gateId>", "SyncGate ID")
    .option("--reason <text>", "Cancellation reason", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const gate = sgCancel(opts.gate, opts.reason);
      if (opts.json) print(gate, true);
      else console.log(`SyncGate cancelled: ${gate.id} [${gate.status}]`);
    });

  sync
    .command("status")
    .description("Show synchronization gate status")
    .option("--gate <gateId>", "SyncGate ID")
    .option("--task <taskId>", "Task ID")
    .option("--session <sessionId>", "Session ID")
    .option("--agent <agentId>", "Also check whether this agent is blocked")
    .option("--json", "Output JSON")
    .action((opts) => {
      if (opts.gate) {
        const result = sgStatus(opts.gate);
        printGateStatus(result, !!opts.json);
        return;
      }

      const gates = sgList({ taskId: opts.task, sessionId: opts.session });
      const block = opts.agent
        ? sgCheckAgent(opts.agent, { taskId: opts.task, sessionId: opts.session })
        : undefined;

      if (opts.json) {
        print({ gates, block }, true);
        return;
      }

      console.log(`SyncGates: ${gates.length}`);
      for (const g of gates) {
        console.log(`  ${g.id} [${g.status}] task=${g.taskId} reason=${g.reason}`);
      }
      if (block) {
        console.log(`Blocked: ${block.blocked ? "yes" : "no"}`);
        if (block.blockingGates.length) {
          console.log(`  Gates: ${block.blockingGates.map(g => g.id).join(", ")}`);
        }
      }
    });

  // ── Sync Transaction subcommands ──
  const tx = sync
    .command("tx")
    .description("Manage sync transactions (checkpoint approval flows)");

  tx
    .command("create")
    .description("Create a sync transaction for a checkpoint")
    .requiredOption("--checkpoint <id>", "Checkpoint ID")
    .requiredOption("--approvers <agentIds>", "Comma-separated approver agent IDs")
    .requiredOption("--session <sessionId>", "Session ID")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--agent <agentId>", "Requesting agent ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = stxCreate({
        sessionId: opts.session,
        taskId: opts.task,
        checkpointId: opts.checkpoint,
        requestingAgentId: opts.agent,
        requiredApproverIds: csv(opts.approvers),
      });
      if (opts.json) { print(result, true); return; }
      console.log(`SyncTransaction created: ${result.tx.id} [${result.tx.status}]`);
      console.log(`  Gate: ${result.tx.gateId}`);
      console.log(`  Pending: ${result.pending.join(", ") || "none"}`);
    });

  tx
    .command("status")
    .description("Show sync transaction status")
    .requiredOption("--tx <txId>", "Transaction ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = stxStatus(opts.tx);
      if (opts.json) { print(result, true); return; }
      console.log(`SyncTransaction: ${result.tx.id} [${result.tx.status}]`);
      console.log(`  Gate: ${result.tx.gateId}`);
      console.log(`  Checkpoint: ${result.tx.checkpointId}`);
      console.log(`  Approved: ${result.tx.approvedByIds || "none"}`);
      console.log(`  Rejected: ${result.tx.rejectedByIds || "none"}`);
      console.log(`  Pending: ${result.pending.join(", ") || "none"}`);
      console.log(`  Blocking: ${result.isBlocking ? "yes" : "no"}`);
    });

  tx
    .command("approve")
    .description("Approve a sync transaction")
    .requiredOption("--tx <txId>", "Transaction ID")
    .requiredOption("--agent <agentId>", "Approving agent ID")
    .option("--summary <text>", "Approval summary", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = stxApprove(opts.tx, opts.agent, opts.summary);
      if (opts.json) { print(result, true); return; }
      console.log(`SyncTransaction approved by ${opts.agent}: ${result.tx.id} [${result.tx.status}]`);
      console.log(`  Pending: ${result.pending.join(", ") || "none"}`);
    });

  tx
    .command("reject")
    .description("Reject a sync transaction")
    .requiredOption("--tx <txId>", "Transaction ID")
    .requiredOption("--agent <agentId>", "Rejecting agent ID")
    .option("--reason <text>", "Rejection reason", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = stxReject(opts.tx, opts.agent, opts.reason);
      if (opts.json) { print(result, true); return; }
      console.log(`SyncTransaction rejected by ${opts.agent}: ${result.tx.id} [${result.tx.status}]`);
    });

  tx
    .command("resolve")
    .description("Resolve a sync transaction (releases bound SyncGate)")
    .requiredOption("--tx <txId>", "Transaction ID")
    .option("--summary <text>", "Decision summary", "")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = stxResolve(opts.tx, opts.summary);
      if (opts.json) { print(result, true); return; }
      console.log(`SyncTransaction resolved: ${result.tx.id} [${result.tx.status}]`);
    });

  tx
    .command("list")
    .description("List sync transactions")
    .option("--session <sessionId>", "Filter by session")
    .option("--task <taskId>", "Filter by task")
    .option("--status <status>", "Filter by status")
    .option("--json", "Output JSON")
    .action((opts) => {
      const txs = stxList({ sessionId: opts.session, taskId: opts.task, status: opts.status });
      if (opts.json) { print(txs, true); return; }
      console.log(`SyncTransactions: ${txs.length}`);
      for (const t of txs) {
        console.log(`  ${t.id} [${t.status}] task=${t.taskId} checkpoint=${t.checkpointId}`);
      }
    });
}
