/**
 * Task repository — CRUD for tasks.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { TaskStatus, EventType, validateTaskTransition } from "syncpoint-core";
import type { Task, TaskCreate } from "syncpoint-core";
import { _getDb, now, createId, logEvent, NotFoundError } from "./_shared.js";
import { getAgent } from "./agent-repository.js";

export function createTask(data: TaskCreate): Task {
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.tasks).values({
    id,
    title: data.title,
    description: data.description,
    status: TaskStatus.OPEN,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  logEvent(EventType.TASK_CREATED, "task", id);
  return getTask(id);
}

export function getTask(id: string): Task {
  const db = _getDb();
  const rows = db.select().from(s.tasks).where(eq(s.tasks.id, id)).all();
  if (!rows.length) throw new NotFoundError("task", id);
  return rows[0] as unknown as Task;
}

export function listTasks(): Task[] {
  return _getDb().select().from(s.tasks).all() as unknown as Task[];
}

export function assignTask(taskId: string, agentId: string): Task {
  getAgent(agentId);
  const task = getTask(taskId);
  validateTaskTransition(task.status as TaskStatus, TaskStatus.ASSIGNED);
  _getDb().update(s.tasks).set({ ownerAgentId: agentId, status: TaskStatus.ASSIGNED, updatedAt: now() })
    .where(eq(s.tasks.id, taskId)).run();
  _getDb().update(s.agents).set({ currentTaskId: taskId, updatedAt: now() })
    .where(eq(s.agents.id, agentId)).run();
  logEvent(EventType.TASK_ASSIGNED, "task", taskId, agentId);
  return getTask(taskId);
}

export function updateTaskStatus(taskId: string, target: TaskStatus): Task {
  const task = getTask(taskId);
  validateTaskTransition(task.status as TaskStatus, target);
  const old = task.status;
  _getDb().update(s.tasks).set({ status: target, updatedAt: now() }).where(eq(s.tasks.id, taskId)).run();
  logEvent(EventType.TASK_STATUS_CHANGED, "task", taskId, `${old}→${target}`);
  return getTask(taskId);
}
