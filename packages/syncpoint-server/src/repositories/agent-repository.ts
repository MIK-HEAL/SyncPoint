/**
 * Agent repository — CRUD for agents.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { AgentStatus, EventType, validateAgentTransition } from "syncpoint-core";
import type { Agent, AgentCreate } from "syncpoint-core";
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
