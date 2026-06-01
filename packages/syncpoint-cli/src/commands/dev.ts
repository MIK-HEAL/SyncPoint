/**
 * CLI Dev commands — debugging / inspection utilities.
 *
 *   syncpoint dev status   — snapshot of all Gates, Claims, Agents, Operations
 *   syncpoint dev tail     — live event stream from the internal event bus
 *   syncpoint dev reset    — wipe all collaboration state back to initial
 */

import { Command } from "commander";
import * as repo from "syncpoint-server/repositories";
import { SyncPointEventBus, getRawDb, getDbPath } from "syncpoint-server";
import type { SyncPointEventData } from "syncpoint-server";

// ── 4.1  dev status ──────────────────────────────────

function printStatus(opts: { json?: boolean }): void {
  const agents = repo.listAgents();
  const claims = repo.listResourceClaims();
  const gates = repo.listSyncGates();
  const operations = repo.listOperations();
  const permits = repo.listWritePermits();

  if (opts.json) {
    console.log(JSON.stringify({ agents, claims, gates, operations, permits }, null, 2));
    return;
  }

  // ── Agents ─────────────────────────────────
  console.log(`\n=== Agents (${agents.length}) ===`);
  if (agents.length === 0) {
    console.log("  (none)");
  } else {
    console.table(agents.map(a => ({
      id: a.id.slice(0, 12),
      name: a.name,
      status: a.status,
      task: a.currentTaskId?.slice(0, 12) ?? "-",
    })));
  }

  // ── Resource Claims ────────────────────────
  console.log(`\n=== Resource Claims (${claims.length}) ===`);
  if (claims.length === 0) {
    console.log("  (none)");
  } else {
    console.table(claims.map(c => ({
      id: c.id.slice(0, 12),
      actor: c.actorId.slice(0, 12),
      task: c.taskId.slice(0, 12),
      mode: c.mode,
      status: c.status,
      resources: c.resources.map(r => r.locator).join(", "),
    })));
  }

  // ── Sync Gates ─────────────────────────────
  console.log(`\n=== Sync Gates (${gates.length}) ===`);
  if (gates.length === 0) {
    console.log("  (none)");
  } else {
    console.table(gates.map(g => ({
      id: g.id.slice(0, 12),
      task: g.taskId.slice(0, 12),
      status: g.status,
      reason: g.reason,
      required: g.requiredAgentIds.length,
      acked: g.ackedAgentIds.length,
    })));
  }

  // ── Operations ────────────────────────────
  console.log(`\n=== Operations (${operations.length}) ===`);
  if (operations.length === 0) {
    console.log("  (none)");
  } else {
    console.table(operations.map(o => ({
      id: o.id.slice(0, 12),
      type: o.type,
      actor: o.actorId.slice(0, 12),
      task: o.taskId.slice(0, 12),
      status: o.status,
      title: o.title.slice(0, 40),
    })));
  }

  // ── Write Permits ──────────────────────────
  console.log(`\n=== Write Permits (${permits.length}) ===`);
  if (permits.length === 0) {
    console.log("  (none)");
  } else {
    console.table(permits.map(p => ({
      id: p.id.slice(0, 12),
      actor: p.actorId.slice(0, 12),
      task: p.taskId.slice(0, 12),
      status: p.status,
      intent: p.intent,
    })));
  }

  console.log(`\nDB: ${getDbPath()}`);
}

// ── 4.2  dev tail ─────────────────────────────────────

function startTail(opts: { json?: boolean; n?: string }): void {
  const bus = SyncPointEventBus.getInstance();

  // Print recent events from DB first
  const limit = parseInt(opts.n ?? "20", 10);
  const raw = getRawDb();
  const recent = raw.prepare(
    `SELECT id, event_type, entity_type, entity_id, detail, created_at FROM event ORDER BY created_at DESC LIMIT ?`
  ).all(limit) as Array<{ id: string; event_type: string; entity_type: string; entity_id: string; detail: string; created_at: string }>;

  if (recent.length > 0) {
    if (opts.json) {
      for (const row of recent.reverse()) {
        console.log(JSON.stringify(row));
      }
    } else {
      console.log(`--- Last ${recent.length} events ---`);
      for (const row of recent) {
        console.log(`  [${row.created_at}] ${row.event_type} ${row.entity_type}:${row.entity_id.slice(0, 12)}${row.detail ? ` (${row.detail})` : ""}`);
      }
      console.log("--- live ---");
    }
  }

  // Subscribe to live events
  const handler = (data: SyncPointEventData) => {
    if (opts.json) {
      console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
      return;
    }
    const ts = new Date().toISOString();
    console.log(`[${ts}] ${data.eventType} ${data.entityType}:${data.entityId.slice(0, 12)}${data.detail ? ` (${data.detail})` : ""}`);
  };

  bus.on("event", handler);

  console.log("Tailing events (Ctrl+C to stop)...");
  process.on("SIGINT", () => {
    bus.off("event", handler);
    console.log("\nStopped tailing.");
    process.exit(0);
  });
}

// ── 4.3  dev reset ────────────────────────────────────

function resetState(opts: { json?: boolean; confirm?: boolean }): void {
  if (!opts.confirm) {
    console.log("This will DELETE all collaboration state (gates, claims, operations, permits, events, etc.).");
    console.log("Run with --confirm to proceed.");
    return;
  }

  const raw = getRawDb();
  // Delete in dependency order — child join tables first, then parent tables
  const joinTables = [
    "sync_gate_required_agent",
    "sync_gate_ack",
    "sync_gate_vote",
    "sync_gate_resource",
    "sync_gate_related_claim",
    "resource_claim_resource",
    "operation_resource",
    "write_permit_resource",
    "checkpoint_review_approver",
    "negotiation_participant",
    "context_snapshot_resource",
  ];
  const parentTables = [
    "sync_gate",
    "resource_claim",
    "operation",
    "write_permit",
    "checkpoint_review",
    "negotiation_session",
    "context_snapshot",
    "checkpoint",
    "diary_entry",
    "handoff",
    "peer_contract",
    "review_request",
    "review_evidence",
    "review_decision",
    "change_request",
    "approval_record",
    "review_checklist_item",
    "event",
    "guard_session",
  ];

  const allTables = [...joinTables, ...parentTables];
  let deleted = 0;

  for (const table of allTables) {
    try {
      const result = raw.prepare(`DELETE FROM \`${table}\``).run();
      deleted += result.changes;
    } catch {
      // Table may not exist in this DB — skip
    }
  }

  // Reset agent currentTaskId
  try {
    raw.exec(`UPDATE agent SET current_task_id = NULL WHERE current_task_id IS NOT NULL`);
  } catch { /* no agents table */ }

  // Reset task ownerAgentId
  try {
    raw.exec(`UPDATE task SET owner_agent_id = NULL WHERE owner_agent_id IS NOT NULL`);
  } catch { /* no tasks table */ }

  if (opts.json) {
    console.log(JSON.stringify({ deleted, tables: allTables.length }));
    return;
  }

  console.log(`Reset complete. Deleted ${deleted} rows across ${allTables.length} tables.`);
  console.log("Agents and tasks remain; collaboration state cleared.");
}

// ── Register ──────────────────────────────────────────

export function registerDevCommands(program: Command): void {
  const dev = program
    .command("dev")
    .description("Developer debugging and inspection commands");

  dev
    .command("status")
    .description("Snapshot of all Gates, Claims, Agents, Operations, and Permits")
    .option("--json", "Output JSON")
    .action((opts) => {
      printStatus(opts);
    });

  dev
    .command("tail")
    .description("Live event stream from the SyncPoint event bus")
    .option("-n, --lines <n>", "Number of recent events to show first", "20")
    .option("--json", "Output newline-delimited JSON")
    .action((opts) => {
      startTail(opts);
    });

  dev
    .command("reset")
    .description("Wipe all collaboration state back to initial (keeps agents and tasks)")
    .option("--confirm", "Actually perform the reset (required)")
    .option("--json", "Output JSON result")
    .action((opts) => {
      resetState(opts);
    });
}
