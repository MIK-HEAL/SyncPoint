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
  /** Keep only the last N snapshots per task+agent. 0 = disabled. */
  keepLastN?: number;
  /** Delete snapshots older than this many days. 0 = disabled. */
  maxAgeDays?: number;
  /** Delete oldest snapshots until total payload size is under this limit (MB). 0 = disabled. */
  maxTotalMb?: number;
  /**
   * When true, only keep snapshots whose checkpoint is linked to an
   * approved or rejected CheckpointReview. Snapshots without a checkpoint
   * or with a non-terminal review are candidates for deletion (subject to
   * keepLastN and maxAgeDays floors).
   */
  keepCheckpoints?: boolean;
}

const DEFAULT_GC_CONFIG: Required<SnapshotGcConfig> = {
  keepLastN: 50,
  maxAgeDays: 30,
  maxTotalMb: 100,
  keepCheckpoints: false,
};

export interface GcResult {
  deletedCount: number;
  freedBytes: number;
}

/** IDs of snapshots that must never be deleted (one full snapshot per task+agent). */
function protectedSnapshotIds(rawDb: ReturnType<typeof getRawDb>): Set<string> {
  const rows = rawDb.prepare(
    "SELECT id FROM context_snapshot WHERE is_delta = 0 " +
    "AND id IN (SELECT MIN(id) FROM context_snapshot WHERE is_delta = 0 GROUP BY task_id, agent_id)"
  ).all() as Array<{ id: string }>;
  return new Set(rows.map(r => r.id));
}

/**
 * Run garbage collection on context snapshots.
 *
 * Strategies are applied in order:
 * 1. maxAgeDays — delete snapshots older than cutoff.
 * 2. maxTotalMb — delete oldest snapshots until total size is under limit.
 * 3. keepLastN — keep only the most recent N per task+agent.
 * 4. keepCheckpoints — delete snapshots not linked to approved/rejected reviews.
 *
 * Always preserves at least one full snapshot per task+agent pair.
 */
export function runSnapshotGc(config: SnapshotGcConfig = {}): GcResult {
  const cfg = { ...DEFAULT_GC_CONFIG, ...config };
  const rawDb = getRawDb();
  const protected_ = protectedSnapshotIds(rawDb);
  let deletedCount = 0;
  let freedBytes = 0;

  const deleteSnapshot = (id: string, size: number): void => {
    rawDb.prepare("DELETE FROM context_snapshot_resource WHERE snapshot_id = ?").run(id);
    rawDb.prepare("DELETE FROM context_snapshot WHERE id = ?").run(id);
    deletedCount++;
    freedBytes += size;
  };

  const isProtected = (id: string): boolean => protected_.has(id);

  // ── 1. maxAgeDays ──
  if (cfg.maxAgeDays > 0) {
    const cutoff = new Date(Date.now() - cfg.maxAgeDays * 86_400_000).toISOString();
    const oldRows = rawDb.prepare(
      "SELECT id, LENGTH(payload_json) as sz FROM context_snapshot WHERE created_at < ? ORDER BY created_at ASC"
    ).all(cutoff) as Array<{ id: string; sz: number }>;
    for (const row of oldRows) {
      if (isProtected(row.id)) continue;
      deleteSnapshot(row.id, row.sz);
    }
  }

  // ── 2. maxTotalMb — size-based eviction ──
  if (cfg.maxTotalMb > 0) {
    const maxBytes = cfg.maxTotalMb * 1024 * 1024;
    const totalRow = rawDb.prepare(
      "SELECT COALESCE(SUM(LENGTH(payload_json)), 0) as total_sz FROM context_snapshot"
    ).get() as { total_sz: number };
    let currentTotal = totalRow.total_sz;

    if (currentTotal > maxBytes) {
      // Delete oldest non-protected snapshots until under limit
      const candidates = rawDb.prepare(
        "SELECT id, LENGTH(payload_json) as sz FROM context_snapshot ORDER BY created_at ASC"
      ).all() as Array<{ id: string; sz: number }>;

      for (const row of candidates) {
        if (currentTotal <= maxBytes) break;
        if (isProtected(row.id)) continue;
        deleteSnapshot(row.id, row.sz);
        currentTotal -= row.sz;
      }
    }
  }

  // ── 3. keepLastN — per task+agent ──
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
        if (isProtected(row.id)) continue;
        deleteSnapshot(row.id, row.sz);
      }
    }
  }

  // ── 4. keepCheckpoints — only snapshots linked to approved/rejected reviews ──
  if (cfg.keepCheckpoints) {
    // Find snapshots whose checkpointId is NOT linked to an approved or rejected review.
    // Snapshots with empty checkpointId are also candidates (no review at all).
    const unreviewedRows = rawDb.prepare(
      "SELECT cs.id, LENGTH(cs.payload_json) as sz FROM context_snapshot cs " +
      "WHERE cs.checkpoint_id IS NOT NULL AND cs.checkpoint_id != '' " +
      "AND cs.checkpoint_id NOT IN (" +
      "  SELECT cr.checkpoint_id FROM checkpoint_review cr " +
      "  WHERE cr.status IN ('APPROVED', 'REJECTED')" +
      ") " +
      "ORDER BY cs.created_at ASC"
    ).all() as Array<{ id: string; sz: number }>;

    // Also include snapshots with no checkpoint link at all
    const orphanRows = rawDb.prepare(
      "SELECT cs.id, LENGTH(cs.payload_json) as sz FROM context_snapshot cs " +
      "WHERE cs.checkpoint_id IS NULL OR cs.checkpoint_id = '' " +
      "ORDER BY cs.created_at ASC"
    ).all() as Array<{ id: string; sz: number }>;

    const allCandidates = [...unreviewedRows, ...orphanRows];

    for (const row of allCandidates) {
      if (isProtected(row.id)) continue;
      deleteSnapshot(row.id, row.sz);
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
