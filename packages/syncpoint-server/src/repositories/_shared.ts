/**
 * Shared infrastructure for all repository modules.
 */

import { nanoid } from "nanoid";
import { getDb } from "../db.js";
import * as s from "../schema.js";
import { EventType } from "syncpoint-core";
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
  db.insert(s.events).values({
    id: createId(),
    eventType: eventType,
    entityType,
    entityId,
    detail,
    createdAt: now(),
  }).run();
  bus.emit("event", { eventType, entityType, entityId, detail });
}

// ── Error ────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(public entity: string, public entityId: string) {
    super(`${entity} not found: ${entityId}`);
    this.name = "NotFoundError";
  }
}
