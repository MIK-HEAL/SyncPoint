/**
 * ContextCapsule repository.
 */

import { eq, and, desc } from "drizzle-orm";
import * as s from "../schema.js";
import { EventType } from "syncpoint-core";
import type { ContextCapsule, ContextCapsuleCreate } from "syncpoint-core";
import { _getDb, now, createId, logEvent } from "./_shared.js";
import { getTask } from "./task-repository.js";
import { getAgent } from "./agent-repository.js";

export function createCapsule(data: ContextCapsuleCreate): ContextCapsule {
  getTask(data.taskId);
  getAgent(data.agentId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.contextCapsules).values({
    id,
    taskId: data.taskId,
    agentId: data.agentId,
    checkpointId: data.checkpointId,
    goal: data.goal,
    currentPhase: data.currentPhase,
    confirmedDecisions: data.confirmedDecisions,
    interfaceContract: data.interfaceContract,
    workingFiles: data.workingFiles,
    completedWork: data.completedWork,
    remainingWork: data.remainingWork,
    risks: data.risks,
    blockers: data.blockers,
    nextSteps: data.nextSteps,
    resumePrompt: data.resumePrompt,
    // P12 extended fields
    intentScope: data.intentScope ?? "",
    nonGoals: data.nonGoals ?? "",
    verifiedFacts: data.verifiedFacts ?? "",
    unverifiedClaims: data.unverifiedClaims ?? "",
    evidenceRefs: data.evidenceRefs ?? "",
    activeConstraints: data.activeConstraints ?? "",
    doNotTouch: data.doNotTouch ?? "",
    handoffInstructions: data.handoffInstructions ?? "",
    createdAt: ts,
  }).run();
  logEvent(EventType.CAPSULE_CREATED, "capsule", id);
  return db.select().from(s.contextCapsules).where(eq(s.contextCapsules.id, id)).get() as unknown as ContextCapsule;
}

export function listCapsules(taskId: string): ContextCapsule[] {
  getTask(taskId);
  return _getDb().select().from(s.contextCapsules).where(eq(s.contextCapsules.taskId, taskId)).all() as unknown as ContextCapsule[];
}

export function getLatestCapsule(taskId: string, agentId: string): ContextCapsule | undefined {
  return _getDb().select().from(s.contextCapsules)
    .where(and(eq(s.contextCapsules.taskId, taskId), eq(s.contextCapsules.agentId, agentId)))
    .orderBy(desc(s.contextCapsules.createdAt))
    .limit(1)
    .get() as unknown as ContextCapsule | undefined;
}
