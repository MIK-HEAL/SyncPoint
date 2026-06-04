/**
 * Runtime repository — CRUD for runtime instances.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { RuntimeStatus } from "syncpoint-adapters";
import type { Runtime, RuntimeCreate } from "syncpoint-adapters";
import { _getDb, now, createId, NotFoundError } from "./_shared.js";

export function createRuntime(data: RuntimeCreate): Runtime {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.runtimes).values({
    id,
    name: data.name,
    kind: data.kind ?? "local-mcp",
    provider: data.provider ?? "",
    host: data.host ?? "",
    workspaceRoot: data.workspaceRoot ?? "",
    agentId: data.agentId ?? null,
    status: RuntimeStatus.ACTIVE,
    lastSeenAt: ts,
    createdAt: ts,
  }).run();
  return getRuntime(id);
}

export function getRuntime(id: string): Runtime {
  const db = _getDb();
  const rows = db.select().from(s.runtimes).where(eq(s.runtimes.id, id)).all();
  if (!rows.length) throw new NotFoundError("runtime", id);
  return rows[0] as unknown as Runtime;
}

export function listRuntimes(): Runtime[] {
  return _getDb().select().from(s.runtimes).all() as unknown as Runtime[];
}

export function updateRuntimeAgent(runtimeId: string, agentId: string | null): Runtime {
  const db = _getDb();
  getRuntime(runtimeId); // ensure exists
  db.update(s.runtimes).set({ agentId, lastSeenAt: now() }).where(eq(s.runtimes.id, runtimeId)).run();
  return getRuntime(runtimeId);
}

export function updateRuntimeStatus(runtimeId: string, status: RuntimeStatus): Runtime {
  const db = _getDb();
  getRuntime(runtimeId);
  db.update(s.runtimes).set({ status, lastSeenAt: now() }).where(eq(s.runtimes.id, runtimeId)).run();
  return getRuntime(runtimeId);
}

export function touchRuntime(runtimeId: string): void {
  const db = _getDb();
  db.update(s.runtimes).set({ lastSeenAt: now() }).where(eq(s.runtimes.id, runtimeId)).run();
}

/**
 * Lookup: given a runtimeId, return the bound agentId (or null).
 */
export function getAgentIdForRuntime(runtimeId: string): string | null {
  try {
    const rt = getRuntime(runtimeId);
    return rt.agentId ?? null;
  } catch {
    return null;
  }
}
