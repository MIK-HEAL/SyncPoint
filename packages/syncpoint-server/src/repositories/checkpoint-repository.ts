/**
 * Checkpoint + DiaryEntry repository.
 */

import { eq, and, desc } from "drizzle-orm";
import * as s from "../schema.js";
import { EventType } from "syncpoint-core";
import type { Checkpoint, CheckpointCreate, DiaryEntry, DiaryEntryCreate } from "syncpoint-core";
import { _getDb, now, createId, logEvent } from "./_shared.js";
import { getTask } from "./task-repository.js";
import { getAgent } from "./agent-repository.js";

export function createCheckpoint(data: CheckpointCreate): Checkpoint {
  getTask(data.taskId);
  getAgent(data.agentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.checkpoints).values({
    id,
    taskId: data.taskId,
    agentId: data.agentId,
    summary: data.summary,
    progress: data.progress,
    currentUnderstanding: data.currentUnderstanding,
    changedFiles: data.changedFiles,
    risks: data.risks,
    blockers: data.blockers,
    nextSteps: data.nextSteps,
    needSync: data.needSync,
    createdAt: ts,
  }).run();
  logEvent(EventType.CHECKPOINT_CREATED, "checkpoint", id);
  return db.select().from(s.checkpoints).where(eq(s.checkpoints.id, id)).get() as unknown as Checkpoint;
}

export function listCheckpoints(taskId: string): Checkpoint[] {
  getTask(taskId);
  return _getDb().select().from(s.checkpoints).where(eq(s.checkpoints.taskId, taskId)).all() as unknown as Checkpoint[];
}

export function getLatestCheckpointForAgent(taskId: string, agentId: string): Checkpoint | null {
  const rows = _getDb().select().from(s.checkpoints)
    .where(and(eq(s.checkpoints.taskId, taskId), eq(s.checkpoints.agentId, agentId)))
    .orderBy(desc(s.checkpoints.createdAt))
    .limit(1)
    .all() as unknown as Checkpoint[];
  return rows[0] ?? null;
}

export function createDiaryEntry(data: DiaryEntryCreate): DiaryEntry {
  getTask(data.taskId);
  getAgent(data.agentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.diaryEntries).values({
    id,
    agentId: data.agentId,
    taskId: data.taskId,
    entryType: data.entryType,
    content: data.content,
    createdAt: ts,
  }).run();
  logEvent(EventType.DIARY_ENTRY_CREATED, "diary", id);
  return db.select().from(s.diaryEntries).where(eq(s.diaryEntries.id, id)).get() as unknown as DiaryEntry;
}

export function listDiaryEntries(taskId: string): DiaryEntry[] {
  getTask(taskId);
  return _getDb().select().from(s.diaryEntries).where(eq(s.diaryEntries.taskId, taskId)).all() as unknown as DiaryEntry[];
}
