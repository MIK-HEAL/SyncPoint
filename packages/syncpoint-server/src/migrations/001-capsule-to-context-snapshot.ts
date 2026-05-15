/**
 * Migration 001: Rename "capsule" → "context_snapshot" in persisted data.
 *
 * Updates three columns across two tables:
 *   1. event.event_type:              CAPSULE_CREATED → CONTEXT_SNAPSHOT_CREATED
 *   2. event.entity_type:             capsule → context_snapshot
 *   3. project_memory.projection_target: capsule → context_snapshot
 *
 * This script is idempotent — safe to run multiple times on the same database.
 *
 * Usage:
 *   npx tsx packages/syncpoint-server/src/migrations/001-capsule-to-context-snapshot.ts [db-path]
 *
 * If no db-path is provided, defaults to `.syncpoint/syncpoint.db`.
 */

import Database from "better-sqlite3";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(".syncpoint", "syncpoint.db");

function run(): void {
  const dbPath = process.argv[2] || DEFAULT_DB_PATH;
  const resolvedPath = path.resolve(dbPath);

  console.log(`[migration-001] Opening database: ${resolvedPath}`);

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(resolvedPath);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[migration-001] Failed to open database: ${message}`);
    process.exit(1);
  }

  try {
    // 1. Update event.event_type: CAPSULE_CREATED → CONTEXT_SNAPSHOT_CREATED
    try {
      const r1 = db.prepare(
        `UPDATE event SET event_type = 'CONTEXT_SNAPSHOT_CREATED' WHERE event_type = 'CAPSULE_CREATED'`
      ).run();
      console.log(`[migration-001] event.event_type: ${r1.changes} row(s) updated`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[migration-001] Skipped event.event_type update: ${message}`);
    }

    // 2. Update event.entity_type: capsule → context_snapshot
    try {
      const r2 = db.prepare(
        `UPDATE event SET entity_type = 'context_snapshot' WHERE entity_type = 'capsule'`
      ).run();
      console.log(`[migration-001] event.entity_type: ${r2.changes} row(s) updated`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[migration-001] Skipped event.entity_type update: ${message}`);
    }

    // 3. Update project_memory.projection_target: capsule → context_snapshot
    try {
      const r3 = db.prepare(
        `UPDATE project_memory SET projection_target = 'context_snapshot' WHERE projection_target = 'capsule'`
      ).run();
      console.log(`[migration-001] project_memory.projection_target: ${r3.changes} row(s) updated`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[migration-001] Skipped project_memory.projection_target update: ${message}`);
    }

    console.log("[migration-001] Done.");
  } finally {
    db.close();
  }
}

run();
