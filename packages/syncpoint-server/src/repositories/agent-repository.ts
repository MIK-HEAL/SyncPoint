/**
 * Agent repository — CRUD for agents.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { AgentStatus, validateAgentTransition } from "syncpoint-adapters";
import { EventType } from "syncpoint-kernel";
import type { Agent, AgentCreate } from "syncpoint-adapters";
import { _getDb, now, createId, logEvent, NotFoundError } from "./_shared.js";

export function createAgent(data: AgentCreate): Agent {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.agents).values({
    id,
    name: data.name,
    provider: data.provider,
    role: data.role,
    status: AgentStatus.IDLE,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  logEvent(EventType.AGENT_REGISTERED, "agent", id);
  return getAgent(id);
}

export function getAgent(id: string): Agent {
  const db = _getDb();
  const rows = db.select().from(s.agents).where(eq(s.agents.id, id)).all();
  if (!rows.length) throw new NotFoundError("agent", id);
  return rows[0] as unknown as Agent;
}

export function listAgents(): Agent[] {
  return _getDb().select().from(s.agents).all() as unknown as Agent[];
}

export function updateAgentStatus(id: string, target: AgentStatus): Agent {
  const agent = getAgent(id);
  validateAgentTransition(agent.status as AgentStatus, target);
  const old = agent.status;
  _getDb().update(s.agents).set({ status: target, updatedAt: now() }).where(eq(s.agents.id, id)).run();
  logEvent(EventType.AGENT_STATUS_CHANGED, "agent", id, `${old}→${target}`);
  return getAgent(id);
}

export function getAgentByName(name: string): Agent | null {
  const db = _getDb();
  const rows = db.select().from(s.agents).where(eq(s.agents.name, name)).all();
  if (!rows.length) return null;
  return rows[0] as unknown as Agent;
}

export function updateAgentRuntime(id: string, runtimeId: string | null): Agent {
  getAgent(id); // ensure exists
  _getDb().update(s.agents).set({ runtimeId, updatedAt: now() }).where(eq(s.agents.id, id)).run();
  return getAgent(id);
}

export function updateAgentProfile(id: string, input: Partial<AgentCreate>): Agent {
  getAgent(id);

  const updates: Partial<Pick<Agent, "name" | "provider" | "role" | "updatedAt">> = {
    updatedAt: now(),
  };

  if (input.name !== undefined) updates.name = input.name;
  if (input.provider !== undefined) updates.provider = input.provider;
  if (input.role !== undefined) updates.role = input.role;

  _getDb().update(s.agents).set(updates).where(eq(s.agents.id, id)).run();
  return getAgent(id);
}
