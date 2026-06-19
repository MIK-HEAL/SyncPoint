/**
 * State Transition Service — atomic state transitions with audit trail.
 *
 * Every state change is recorded in state_transition_log, enabling:
 *   - Crash recovery: replay log to restore consistent state
 *   - Debugging: trace entity lifecycle
 *   - Audit: who changed what and when
 *
 * Design: Wraps SQLite transactions to ensure the transition check,
 * state update, and log insert are atomic (all-or-nothing).
 *
 * DB access is delegated to state-transition-repository (Drizzle typed queries).
 * Compensation definitions are extensible via registerCompensation().
 */

import { SyncPointError } from "syncpoint-kernel";
import { defaultContext } from "../db.js";
import { logger } from "../logger.js";
import {
  insertTransitionLog,
  getEntityTransitionHistory as repoGetHistory,
  findIntermediateStateEntitiesFromLog,
} from "../repositories/state-transition-repository.js";
import type { StateTransitionRow } from "../repositories/state-transition-repository.js";

// ── Types ────────────────────────────────────────────────

export interface StateTransitionRecord {
  entityType: string;
  entityId: string;
  fromState: string;
  toState: string;
  operation: string;
  agentId: string;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

/**
 * Error thrown when a state transition fails due to state mismatch.
 */
export class StateTransitionError extends SyncPointError {
  readonly code = "STATE_TRANSITION_ERROR";
  readonly httpStatus = 409;
  readonly retryable = false;
  readonly suggestion = "Refresh the current state and retry the operation.";
  constructor(
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly expectedFrom: string,
    public readonly targetTo: string,
    message: string,
  ) {
    super(message);
    this.name = "StateTransitionError";
  }
  get userMessage(): string {
    return `Cannot change "${this.entityType}" "${this.entityId}" from ${this.expectedFrom} to ${this.targetTo}`;
  }
}

/**
 * Map of entity_type → table_name + status_column for state lookups.
 * Used by getCurrentEntityState to find the current state of an entity.
 */
const ENTITY_STATE_TABLES: Record<string, { table: string; statusCol: string }> = {
  resource_claim: { table: "resource_claim", statusCol: "status" },
  sync_gate: { table: "sync_gate", statusCol: "status" },
  operation: { table: "operation", statusCol: "status" },
  write_permit: { table: "write_permit", statusCol: "status" },
  checkpoint_review: { table: "checkpoint_review", statusCol: "status" },
  negotiation_session: { table: "negotiation_session", statusCol: "status" },
  guard_session: { table: "guard_session", statusCol: "status" },
};

/**
 * Get the current state of an entity from its database table.
 * Returns undefined if the entity is not found or the entity type is unknown.
 */
function getCurrentEntityState(entityType: string, entityId: string): string | undefined {
  const mapping = ENTITY_STATE_TABLES[entityType];
  if (!mapping) return undefined;
  const db = defaultContext.raw;
  const row = db.prepare(
    `SELECT ${mapping.statusCol} as state FROM ${mapping.table} WHERE id = ?`
  ).get(entityId) as { state: string } | undefined;
  return row?.state;
}

export interface CompensationDefinition {
  entityType: string;
  operation: string;
  compensateOperation: string;
  compensateToState: string;
  description: string;
}

// ── Compensation Registry ─────────────────────────────────

const compensationRegistry = new Map<string, CompensationDefinition>();

function compensationKey(entityType: string, operation: string): string {
  return `${entityType}::${operation}`;
}

/**
 * Register a compensation definition for a given entity type + operation pair.
 * Domain modules should call this during initialization instead of editing
 * a centralized array.
 */
export function registerCompensation(def: CompensationDefinition): void {
  compensationRegistry.set(compensationKey(def.entityType, def.operation), def);
}

/**
 * Remove a compensation definition. Useful for testing.
 */
export function unregisterCompensation(entityType: string, operation: string): void {
  compensationRegistry.delete(compensationKey(entityType, operation));
}

/**
 * Clear all compensation definitions. Test utility.
 */
export function clearCompensationRegistry(): void {
  compensationRegistry.clear();
}

// ── Built-in compensations (registered at module load) ───

function registerBuiltinCompensations(): void {
  // Resource Claim
  registerCompensation({
    entityType: "resource_claim",
    operation: "claim",
    compensateOperation: "release",
    compensateToState: "released",
    description: "If claim crashed after marking resources but before completion, release the claim",
  });
  registerCompensation({
    entityType: "resource_claim",
    operation: "extend",
    compensateOperation: "release",
    compensateToState: "released",
    description: "If extend crashed, release the claim to restore consistency",
  });
  // Sync Gate
  registerCompensation({
    entityType: "sync_gate",
    operation: "request",
    compensateOperation: "cancel",
    compensateToState: "cancelled",
    description: "If gate request crashed, cancel the gate",
  });
  registerCompensation({
    entityType: "sync_gate",
    operation: "resolve",
    compensateOperation: "reopen",
    compensateToState: "active",
    description: "If resolve crashed partway, reopen the gate for re-evaluation",
  });
  // Operation
  registerCompensation({
    entityType: "operation",
    operation: "submit",
    compensateOperation: "cancel",
    compensateToState: "cancelled",
    description: "If submit crashed, cancel the operation",
  });
  registerCompensation({
    entityType: "operation",
    operation: "approve",
    compensateOperation: "reject",
    compensateToState: "rejected",
    description: "If approve crashed, reject the operation to prevent partial apply",
  });
  // Write Permit
  registerCompensation({
    entityType: "write_permit",
    operation: "prepare",
    compensateOperation: "revoke",
    compensateToState: "revoked",
    description: "If prepare crashed, revoke the permit",
  });
  // Checkpoint Review
  registerCompensation({
    entityType: "checkpoint_review",
    operation: "approve",
    compensateOperation: "cancel",
    compensateToState: "cancelled",
    description: "If approve crashed, cancel the review to prevent partial state",
  });
  registerCompensation({
    entityType: "checkpoint_review",
    operation: "reject",
    compensateOperation: "cancel",
    compensateToState: "cancelled",
    description: "If reject crashed, cancel the review",
  });
  // Negotiation Session
  registerCompensation({
    entityType: "negotiation_session",
    operation: "start",
    compensateOperation: "cancel",
    compensateToState: "cancelled",
    description: "If session start crashed, cancel the session",
  });
  // Guard Session
  registerCompensation({
    entityType: "guard_session",
    operation: "create",
    compensateOperation: "revoke",
    compensateToState: "revoked",
    description: "If guard session creation crashed, revoke the session",
  });
}

registerBuiltinCompensations();

// ── Atomic transition ────────────────────────────────────

/**
 * Execute a state transition atomically:
 * 1. Begin transaction
 * 2. Verify current state matches expected fromState (if validateFromState is true)
 * 3. Execute the update callback (provided by caller)
 * 4. Insert transition log record via repository
 * 5. Commit
 *
 * If any step fails, the transaction is rolled back.
 * Returns the transition record on success, throws on failure.
 */
export function executeAtomicTransition<T>(
  record: StateTransitionRecord,
  updateFn: () => T,
  options?: { validateFromState?: boolean },
): T {
  const db = defaultContext.raw;
  const createdAt = record.createdAt ?? new Date().toISOString();
  const shouldValidate = options?.validateFromState ?? false;

  const runTransition = db.transaction(() => {
    // State guard: verify the entity is currently in the expected fromState
    if (shouldValidate) {
      const currentState = getCurrentEntityState(record.entityType, record.entityId);
      if (currentState !== undefined && currentState !== record.fromState) {
        throw new StateTransitionError(
          record.entityType,
          record.entityId,
          record.fromState,
          record.toState,
          `Expected current state '${record.fromState}' but found '${currentState}'`,
        );
      }
    }

    const result = updateFn();
    insertTransitionLog({
      entityType: record.entityType,
      entityId: record.entityId,
      fromState: record.fromState,
      toState: record.toState,
      operation: record.operation,
      agentId: record.agentId,
      payload: record.payload,
      createdAt,
    });
    return result;
  });

  try {
    const result = runTransition();
    logger.debug("State transition committed", {
      entityType: record.entityType,
      entityId: record.entityId,
      transition: `${record.fromState} → ${record.toState}`,
      operation: record.operation,
      agentId: record.agentId,
    });
    return result;
  } catch (err) {
    logger.error("State transition failed", {
      entityType: record.entityType,
      entityId: record.entityId,
      transition: `${record.fromState} → ${record.toState}`,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Query ─────────────────────────────────────────────────

/**
 * Get the transition history for an entity.
 * Delegates to repository (Drizzle typed query).
 */
export function getEntityTransitionHistory(
  entityType: string,
  entityId: string,
  limit = 50,
): StateTransitionRecord[] {
  const rows: StateTransitionRow[] = repoGetHistory(entityType, entityId, limit);
  return rows.map(r => ({
    entityType: r.entityType,
    entityId: r.entityId,
    fromState: r.fromState,
    toState: r.toState,
    operation: r.operation,
    agentId: r.agentId,
    payload: r.payload,
    createdAt: r.createdAt,
  }));
}

/**
 * Find all entities currently in a non-terminal (intermediate) state.
 * Used for crash recovery: identifies entities that might be stuck.
 * Delegates to repository (Drizzle typed query with subquery).
 */
export function findIntermediateStateEntities(
  entityType: string,
  terminalStates: string[],
): Array<{ entityId: string; state: string }> {
  return findIntermediateStateEntitiesFromLog(entityType, terminalStates);
}

// ── Compensation Operations ──────────────────────────────

/**
 * Get the compensation definition for a given entity type and operation.
 * Returns undefined if no compensation is defined.
 */
export function getCompensationDefinition(
  entityType: string,
  operation: string,
): CompensationDefinition | undefined {
  return compensationRegistry.get(compensationKey(entityType, operation));
}

/**
 * Get all compensation definitions, optionally filtered by entity type.
 */
export function listCompensationDefinitions(
  entityType?: string,
): CompensationDefinition[] {
  const all = Array.from(compensationRegistry.values());
  if (!entityType) return all;
  return all.filter(d => d.entityType === entityType);
}

/**
 * Get the recommended recovery state for a stuck entity based on its
 * last operation. Returns the compensation target state, or undefined
 * if no compensation is defined (meaning the entity may be in a valid
 * intermediate state).
 */
export function getRecoveryState(
  entityType: string,
  lastOperation: string,
): string | undefined {
  return getCompensationDefinition(entityType, lastOperation)?.compensateToState;
}
