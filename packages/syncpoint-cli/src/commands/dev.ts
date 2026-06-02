/**
 * CLI Dev commands — debugging / inspection utilities.
 *
 *   syncpoint dev status   — snapshot of all Gates, Claims, Agents, Operations
 *   syncpoint dev tail     — live event stream from the internal event bus
 *   syncpoint dev reset    — wipe all collaboration state back to initial
 */

import { Command } from "commander";
import * as repo from "syncpoint-server/repositories";
import { SyncPointEventBus, getRawDb, getDbPath, checkDbIntegrity, findIntermediateStateEntities, getEntityTransitionHistory, getCompensationDefinition } from "syncpoint-server";
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

// ── 4.4  dev integrity ──────────────────────────────────

function checkIntegrity(opts: { json?: boolean }): void {
  const result = checkDbIntegrity();
  if (opts.json) {
    console.log(JSON.stringify(result));
    return;
  }
  if (result.ok) {
    console.log(`✓ Database integrity: ${result.details}`);
  } else {
    console.error(`✗ Database integrity FAILED: ${result.details}`);
  }
}

// ── 4.5  dev recover ────────────────────────────────────

const KNOWN_ENTITY_TYPES = ["resource_claim", "sync_gate", "operation", "write_permit", "checkpoint_review", "negotiation_session", "guard_session"];
const TERMINAL_STATES: Record<string, string[]> = {
  resource_claim: ["released", "expired", "revoked"],
  sync_gate: ["resolved", "cancelled", "expired"],
  operation: ["applied", "rejected", "cancelled"],
  write_permit: ["applied", "expired", "revoked"],
  checkpoint_review: ["resolved", "cancelled"],
  negotiation_session: ["resolved", "cancelled", "expired"],
  guard_session: ["revoked", "expired"],
};

function scanStuckEntities(opts: { json?: boolean; entityType?: string }): void {
  const types = opts.entityType ? [opts.entityType] : KNOWN_ENTITY_TYPES;
  const stuck: Array<{ entityType: string; entityId: string; state: string; lastOperation?: string; lastTransition?: string; suggestedRecovery?: string }> = [];

  for (const entityType of types) {
    const terminalStates = TERMINAL_STATES[entityType] ?? [];
    if (terminalStates.length === 0) continue;
    try {
      const intermediates = findIntermediateStateEntities(entityType, terminalStates);
      for (const entity of intermediates) {
        // Get last transition time and operation
        const history = getEntityTransitionHistory(entityType, entity.entityId, 1);
        const lastOp = history[0]?.operation;
        const compensation = lastOp ? getCompensationDefinition(entityType, lastOp) : undefined;
        stuck.push({
          entityType,
          entityId: entity.entityId,
          state: entity.state,
          lastOperation: lastOp,
          lastTransition: history[0]?.createdAt,
          suggestedRecovery: compensation?.compensateToState,
        });
      }
    } catch {
      // Entity type may not have transitions logged yet — skip
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ stuck, count: stuck.length }));
    return;
  }

  if (stuck.length === 0) {
    console.log("No stuck entities found. All entities are in terminal states or have no transition log.");
    return;
  }

  console.log(`Found ${stuck.length} stuck entities (in non-terminal states):`);
  console.table(stuck.map(s => ({
    type: s.entityType,
    id: s.entityId.slice(0, 12),
    state: s.state,
    lastOp: s.lastOperation ?? "unknown",
    suggestedRecovery: s.suggestedRecovery ?? "manual",
  })));
  console.log("\nSuggested recovery commands:");
  for (const s of stuck) {
    const targetState = s.suggestedRecovery ?? "manual";
    if (targetState !== "manual") {
      console.log(`  syncpoint dev recover --entity-type ${s.entityType} --entity-id ${s.entityId} --to-state ${targetState}`);
    }
  }
}

function forceRecover(opts: { json?: boolean; entityType?: string; entityId?: string; toState?: string }): void {
  if (!opts.entityType || !opts.entityId || !opts.toState) {
    console.error("--entity-type, --entity-id, and --to-state are required for forced recovery.");
    console.error("Example: syncpoint dev recover --entity-type resource_claim --entity-id abc123 --to-state released");
    process.exit(1);
  }

  const raw = getRawDb();
  const tableName = opts.entityType;

  // Map entity_type to the actual table and state column
  const stateColumnMap: Record<string, string> = {
    resource_claim: "status",
    sync_gate: "status",
    operation: "status",
    write_permit: "status",
    checkpoint_review: "status",
    negotiation_session: "status",
    guard_session: "status",
  };
  const stateCol = stateColumnMap[opts.entityType];
  if (!stateCol) {
    console.error(`Unknown entity type: ${opts.entityType}`);
    process.exit(1);
  }

  try {
    const stmt = raw.prepare(`UPDATE \`${tableName}\` SET ${stateCol} = ? WHERE id = ?`);
    const result = stmt.run(opts.toState, opts.entityId);
    if (result.changes === 0) {
      console.error(`No row updated. Entity ${opts.entityType}:${opts.entityId} not found.`);
      process.exit(1);
    }
    // Log the recovery in state_transition_log
    raw.prepare(`
      INSERT INTO state_transition_log (id, entity_type, entity_id, from_state, to_state, operation, agent_id, payload_json, created_at)
      VALUES (?, ?, ?, 'recovery', ?, 'force_recover', 'system', '{}', ?)
    `).run(
      `recovery-${Date.now()}`,
      opts.entityType,
      opts.entityId,
      opts.toState,
      new Date().toISOString(),
    );
    if (opts.json) {
      console.log(JSON.stringify({ recovered: true, entityType: opts.entityType, entityId: opts.entityId, toState: opts.toState }));
    } else {
      console.log(`Recovered ${opts.entityType}:${opts.entityId.slice(0, 12)} → ${opts.toState}`);
    }
  } catch (err) {
    console.error(`Recovery failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

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

  dev
    .command("integrity")
    .description("Check database integrity (PRAGMA integrity_check)")
    .option("--json", "Output JSON")
    .action((opts) => {
      checkIntegrity(opts);
    });

  dev
    .command("recover")
    .description("Scan for stuck entities after a crash, or force-recover a specific entity")
    .option("--entity-type <type>", "Filter scan to a specific entity type, or target for force recovery")
    .option("--entity-id <id>", "Entity ID for force recovery")
    .option("--to-state <state>", "Target state for force recovery")
    .option("--json", "Output JSON")
    .action((opts) => {
      if (opts.entityId && opts.toState) {
        forceRecover(opts);
      } else {
        scanStuckEntities(opts);
      }
    });

  // ── Register ──────────────────────────────────────────
}
