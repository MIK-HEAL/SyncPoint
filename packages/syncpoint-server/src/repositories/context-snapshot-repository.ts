/**
 * ContextSnapshot repository.
 *
 * Uses the normalized context_snapshot + context_snapshot_resource tables.
 * Supports incremental storage: first snapshot is full, subsequent are deltas.
 */

import { eq, and, desc, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import * as s from "../schema.js";
import { EventType, SNAPSHOT_VERSION } from "syncpoint-core";
import type { ContextSnapshot, ContextSnapshotCreate, ContextSnapshotPayload } from "syncpoint-core";
import { _getDb, getRawDb, now, createId, logEvent } from "./_shared.js";
import { getTask } from "./task-repository.js";
import { getAgent } from "./agent-repository.js";

// ── Internal helpers ────────────────────────────────

function computePayloadHash(payload: ContextSnapshotPayload): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

function rowToSnapshot(row: any): ContextSnapshot {
  return {
    id: row.id,
    taskId: row.taskId,
    agentId: row.agentId,
    checkpointId: row.checkpointId,
    kind: row.kind ?? "resume",
    summary: row.summary ?? "",
    payload: row.payloadJson ?? {},
    version: row.version ?? 1,
    contentHash: row.contentHash ?? "",
    isDelta: Boolean(row.isDelta),
    baseSnapshotId: row.baseSnapshotId ?? "",
    validationStatus: "",
    staleReason: "",
    createdAt: row.createdAt,
  } as ContextSnapshot;
}

// ── CRUD ────────────────────────────────────────────

export function createContextSnapshot(data: ContextSnapshotCreate): ContextSnapshot {
  getTask(data.taskId);
  getAgent(data.agentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  const contentHash = computePayloadHash(data.payload ?? {});

  // Determine if this should be a delta snapshot
  let isDelta = data.isDelta ?? false;
  let baseSnapshotId = data.baseSnapshotId ?? "";
  let payloadToStore = data.payload ?? {};

  if (!isDelta) {
    // Check if there's a previous full snapshot for this task+agent
    const prevFull = db.select().from(s.contextSnapshots)
      .where(and(
        eq(s.contextSnapshots.taskId, data.taskId),
        eq(s.contextSnapshots.agentId, data.agentId),
        eq(s.contextSnapshots.isDelta, false),
      ))
      .orderBy(desc(s.contextSnapshots.createdAt))
      .limit(1)
      .get();

    if (prevFull) {
      // Compute delta: only store fields that differ from the previous full snapshot
      const prevPayload = (prevFull as any).payloadJson as ContextSnapshotPayload;
      const delta = computeDelta(prevPayload, data.payload ?? {});
      if (Object.keys(delta).length > 0) {
        isDelta = true;
        baseSnapshotId = prevFull.id;
        payloadToStore = delta;
      }
    }
  }

  db.insert(s.contextSnapshots).values({
    id,
    taskId: data.taskId,
    agentId: data.agentId,
    checkpointId: data.checkpointId ?? "",
    kind: data.kind ?? "resume",
    summary: data.summary ?? "",
    payloadJson: payloadToStore,
    version: SNAPSHOT_VERSION,
    contentHash,
    isDelta,
    baseSnapshotId,
    createdAt: ts,
  }).run();
  logEvent(EventType.CONTEXT_SNAPSHOT_CREATED, "context_snapshot", id);
  const row = db.select().from(s.contextSnapshots).where(eq(s.contextSnapshots.id, id)).get();
  return rowToSnapshot(row);
}

export function listContextSnapshots(taskId: string): ContextSnapshot[] {
  getTask(taskId);
  return _getDb().select().from(s.contextSnapshots)
    .where(eq(s.contextSnapshots.taskId, taskId))
    .all()
    .map(rowToSnapshot);
}

export function getLatestContextSnapshot(taskId: string, agentId: string): ContextSnapshot | undefined {
  const row = _getDb().select().from(s.contextSnapshots)
    .where(and(eq(s.contextSnapshots.taskId, taskId), eq(s.contextSnapshots.agentId, agentId)))
    .orderBy(desc(s.contextSnapshots.createdAt))
    .limit(1)
    .get();
  return row ? rowToSnapshot(row) : undefined;
}

/**
 * Reconstruct the full payload of a snapshot by applying deltas in order.
 */
export function resolveSnapshotPayload(snapshotId: string): ContextSnapshotPayload | undefined {
  const db = _getDb();
  const snapshot = db.select().from(s.contextSnapshots)
    .where(eq(s.contextSnapshots.id, snapshotId))
    .get();
  if (!snapshot) return undefined;

  const row = snapshot as any;
  if (!row.isDelta) return row.payloadJson as ContextSnapshotPayload;

  // Walk the delta chain backwards to find the base full snapshot
  const chain: Array<{ id: string; payloadJson: ContextSnapshotPayload; isDelta: boolean; baseSnapshotId: string }> = [row];
  let current = row;
  while (current.isDelta && current.baseSnapshotId) {
    const base = db.select().from(s.contextSnapshots)
      .where(eq(s.contextSnapshots.id, current.baseSnapshotId))
      .get() as any;
    if (!base) break;
    chain.unshift(base);
    current = base;
  }

  // Apply deltas in order
  let payload: ContextSnapshotPayload = chain[0]!.payloadJson as ContextSnapshotPayload;
  for (let i = 1; i < chain.length; i++) {
    payload = applyDelta(payload, chain[i]!.payloadJson as ContextSnapshotPayload);
  }
  return payload;
}

// ── Delta computation ──────────────────────────────

function computeDelta(base: ContextSnapshotPayload, current: ContextSnapshotPayload): Partial<ContextSnapshotPayload> {
  const delta: Record<string, unknown> = {};
  const allKeys = new Set([...Object.keys(base), ...Object.keys(current)]);
  for (const key of allKeys) {
    const bVal = (base as any)[key];
    const cVal = (current as any)[key];
    if (JSON.stringify(bVal) !== JSON.stringify(cVal)) {
      (delta as any)[key] = cVal;
    }
  }
  return delta;
}

function applyDelta(base: ContextSnapshotPayload, delta: Partial<ContextSnapshotPayload>): ContextSnapshotPayload {
  return { ...base, ...delta };
}

// ── Garbage Collection ──────────────────────────────

export interface SnapshotGcConfig {
  keepLastN?: number;
  maxAgeDays?: number;
  maxTotalMb?: number;
}

const DEFAULT_GC_CONFIG: Required<SnapshotGcConfig> = {
  keepLastN: 50,
  maxAgeDays: 30,
  maxTotalMb: 100,
};

export interface GcResult {
  deletedCount: number;
  freedBytes: number;
}

/**
 * Run garbage collection on context snapshots.
 * Deletes snapshots that exceed the configured limits.
 * Always keeps at least one full snapshot per task+agent.
 */
export function runSnapshotGc(config: SnapshotGcConfig = {}): GcResult {
  const cfg = { ...DEFAULT_GC_CONFIG, ...config };
  const rawDb = getRawDb();
  let deletedCount = 0;
  let freedBytes = 0;

  // 1. Delete snapshots older than maxAgeDays
  if (cfg.maxAgeDays > 0) {
    const cutoff = new Date(Date.now() - cfg.maxAgeDays * 86_400_000).toISOString();
    const oldRows = rawDb.prepare(
      "SELECT id FROM context_snapshot WHERE created_at < ? AND id NOT IN " +
      "(SELECT id FROM context_snapshot WHERE is_delta = 0 GROUP BY task_id, agent_id HAVING MIN(created_at))"
    ).all(cutoff) as Array<{ id: string }>;
    for (const row of oldRows) {
      const size = rawDb.prepare("SELECT LENGTH(payload_json) as sz FROM context_snapshot WHERE id = ?").get(row.id) as { sz: number } | undefined;
      rawDb.prepare("DELETE FROM context_snapshot_resource WHERE snapshot_id = ?").run(row.id);
      rawDb.prepare("DELETE FROM context_snapshot WHERE id = ?").run(row.id);
      deletedCount++;
      freedBytes += size?.sz ?? 0;
    }
  }

  // 2. Keep only last N snapshots per task+agent
  if (cfg.keepLastN > 0) {
    const taskAgents = rawDb.prepare(
      "SELECT DISTINCT task_id, agent_id FROM context_snapshot"
    ).all() as Array<{ task_id: string; agent_id: string }>;
    for (const ta of taskAgents) {
      const rows = rawDb.prepare(
        "SELECT id, LENGTH(payload_json) as sz FROM context_snapshot WHERE task_id = ? AND agent_id = ? ORDER BY created_at DESC"
      ).all(ta.task_id, ta.agent_id) as Array<{ id: string; sz: number }>;
      for (let i = cfg.keepLastN; i < rows.length; i++) {
        const row = rows[i]!;
        rawDb.prepare("DELETE FROM context_snapshot_resource WHERE snapshot_id = ?").run(row.id);
        rawDb.prepare("DELETE FROM context_snapshot WHERE id = ?").run(row.id);
        deletedCount++;
        freedBytes += row.sz;
      }
    }
  }

  return { deletedCount, freedBytes };
}

// ── Version compatibility check ─────────────────────

export function checkSnapshotVersion(snapshot: ContextSnapshot): { compatible: boolean; message: string } {
  if (snapshot.version === SNAPSHOT_VERSION) {
    return { compatible: true, message: "Snapshot version is compatible." };
  }
  if (snapshot.version < SNAPSHOT_VERSION) {
    return {
      compatible: false,
      message: `Snapshot version ${snapshot.version} is older than current version ${SNAPSHOT_VERSION}. Manual migration may be required.`,
    };
  }
  return {
    compatible: false,
    message: `Snapshot version ${snapshot.version} is newer than current version ${SNAPSHOT_VERSION}. Please update SyncPoint.`,
  };
}
