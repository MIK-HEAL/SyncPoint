/**
 * Shared infrastructure for all repository modules.
 */

import Database from "better-sqlite3";
import { nanoid } from "nanoid";
import { defaultContext, createTestDatabaseContext, type DatabaseContext, type SyncPointDb } from "../db.js";
import * as s from "../schema.js";
import { EventType, ResourceNotFoundError } from "syncpoint-kernel";
import { createEventBus, type SyncPointEventBus } from "../event-bus.js";

// ── Database context ──────────────────────────────────

let _context: DatabaseContext = defaultContext;

export function _getDb(): SyncPointDb {
  return _context.db;
}

export function getRawDb(): Database.Database {
  return _context.raw;
}

/** @internal Inject a test database context. */
export function __setTestContext(ctx: DatabaseContext): void {
  _context = ctx;
}

/** @internal Reset to default context after test. */
export function __resetContext(): void {
  _context = defaultContext;
}

/** @internal Create a fresh in-memory context for tests. */
export function __createTestContext(): DatabaseContext {
  const ctx = createTestDatabaseContext();
  _context = ctx;
  return ctx;
}

// ── Event bus ─────────────────────────────────────────

let _bus: SyncPointEventBus = createEventBus();

export function _getBus(): SyncPointEventBus {
  return _bus;
}

/** @internal Reset event bus for tests. */
export function __resetBus(): void {
  _bus = createEventBus();
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
  const bus = _getBus();
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
    const rawDb = getRawDb();
    const row = rawDb.prepare("SELECT MAX(seq) as max_seq FROM event").get() as { max_seq: number | null } | undefined;
    const maxSeq = row?.max_seq;
    if (typeof maxSeq === "number" && maxSeq > 0) {
      _getBus().recoverSeq(maxSeq);
    }
  } catch {
    // Table might not have seq column yet (migration pending)
  }
}

export class NotFoundError extends ResourceNotFoundError {
  constructor(public entity: string, public entityId: string) {
    super(`${entity}:${entityId}`);
    this.name = "NotFoundError";
  }
}
