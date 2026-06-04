/**
 * Shared infrastructure for all repository modules.
 */

import { nanoid } from "nanoid";
import { getDb, getRawDb as _getRawDb } from "../db.js";
export { _getRawDb as getRawDb };
import * as s from "../schema.js";
import { EventType } from "syncpoint-kernel";
import { SyncPointEventBus } from "../event-bus.js";

const bus = SyncPointEventBus.getInstance();

// ── Test DB injection ────────────────────────────────

let _testDb: ReturnType<typeof getDb> | null = null;

/** @internal Test-only: inject a test database */
export function __setDb(override: ReturnType<typeof getDb> | null): void {
  _testDb = override;
}

export function _getDb(): ReturnType<typeof getDb> {
  return _testDb ?? getDb();
}

export function now(): string {
  return new Date().toISOString();
}

export function createId(): string {
  return `s${nanoid(11)}`;
}

export function logEvent(
  eventType: EventType,
  entityType: string,
  entityId: string,
  detail = ""
): void {
  const db = _getDb();
  // Emit event first to get the seq number from the bus
  bus.emitEvent(eventType, entityType, entityId, detail);
  const seq = bus.currentSeq;
  db.insert(s.events).values({
    id: createId(),
    seq,
    eventType: eventType,
    entityType,
    entityId,
    detail,
    createdAt: now(),
  }).run();
}

/**
 * Recover the event bus sequence number from the database.
 * Called on server startup to ensure seq continuity after restart.
 */
export function recoverEventBusSeq(): void {
  try {
    const rawDb = _getRawDb();
    const row = rawDb.prepare("SELECT MAX(seq) as max_seq FROM event").get() as { max_seq: number | null } | undefined;
    const maxSeq = row?.max_seq;
    if (typeof maxSeq === "number" && maxSeq > 0) {
      bus.recoverSeq(maxSeq);
    }
  } catch {
    // Table might not have seq column yet (migration pending)
  }
}

export class NotFoundError extends Error {
  constructor(public entity: string, public entityId: string) {
    super(`${entity} not found: ${entityId}`);
    this.name = "NotFoundError";
  }
}
