/**
 * PeerContract repository.
 */

import { eq } from "drizzle-orm";
import * as s from "../schema.js";
import { ContractStatus, TaskStatus, EventType, validateTaskTransition, validateContractTransition } from "syncpoint-core";
import type { PeerContract, PeerContractCreate, Task } from "syncpoint-core";
import { _getDb, now, createId, logEvent, NotFoundError } from "./_shared.js";
import { hydrateContractRow, replaceContractStructuredFields } from "./contract-repository-internals.js";
import { getTask } from "./task-repository.js";

export function createContract(data: PeerContractCreate): PeerContract {
  getTask(data.taskId);
  const db = _getDb();
  const id = createId();
  const ts = now();
  db.insert(s.peerContracts).values({
    id,
    taskId: data.taskId,
    title: data.title,
    scope: data.scope,
    testPlan: data.testPlan,
    risks: data.risks,
    status: ContractStatus.DRAFT,
    createdAt: ts,
    updatedAt: ts,
  }).run();
  replaceContractStructuredFields(id, data);
  // Contract creation drives task status to NEEDS_CONTRACT
  const task = db.select().from(s.tasks).where(eq(s.tasks.id, data.taskId)).get() as unknown as Task | undefined;
  if (task && (task.status as TaskStatus) === TaskStatus.ASSIGNED) {
    validateTaskTransition(task.status as TaskStatus, TaskStatus.NEEDS_CONTRACT);
    db.update(s.tasks).set({ status: TaskStatus.NEEDS_CONTRACT, updatedAt: ts }).where(eq(s.tasks.id, data.taskId)).run();
  }
  logEvent(EventType.CONTRACT_DRAFTED, "contract", id);
  return hydrateContractRow(db.select().from(s.peerContracts).where(eq(s.peerContracts.id, id)).get()!);
}

export function getContract(id: string): PeerContract {
  const db = _getDb();
  const row = db.select().from(s.peerContracts).where(eq(s.peerContracts.id, id)).get();
  if (!row) throw new NotFoundError("contract", id);
  return hydrateContractRow(row);
}

export function getContractForTask(taskId: string): PeerContract | undefined {
  const row = _getDb().select().from(s.peerContracts).where(eq(s.peerContracts.taskId, taskId)).get();
  return row ? hydrateContractRow(row) : undefined;
}

export function updateContractStatus(id: string, target: ContractStatus): PeerContract {
  const contract = getContract(id);
  validateContractTransition(contract.status as ContractStatus, target);
  const old = contract.status;
  const db = _getDb();
  db.update(s.peerContracts).set({ status: target, updatedAt: now() }).where(eq(s.peerContracts.id, id)).run();
  // Contract status changes drive task status
  const taskStatusMap: Partial<Record<ContractStatus, TaskStatus>> = {
    [ContractStatus.REVIEWING]: TaskStatus.CONTRACT_REVIEW,
    [ContractStatus.APPROVED]: TaskStatus.READY_TO_WORK,
    [ContractStatus.REJECTED]: TaskStatus.NEEDS_CONTRACT,
  };
  const newTaskStatus = taskStatusMap[target];
  if (newTaskStatus) {
    const task = db.select().from(s.tasks).where(eq(s.tasks.id, contract.taskId)).get() as unknown as Task | undefined;
    if (task) {
      validateTaskTransition(task.status as TaskStatus, newTaskStatus);
      db.update(s.tasks).set({ status: newTaskStatus, updatedAt: now() }).where(eq(s.tasks.id, contract.taskId)).run();
    }
  }
  const eventMap: Partial<Record<ContractStatus, EventType>> = {
    [ContractStatus.REVIEWING]: EventType.CONTRACT_REVIEW_REQUESTED,
    [ContractStatus.APPROVED]: EventType.CONTRACT_APPROVED,
    [ContractStatus.REJECTED]: EventType.CONTRACT_REJECTED,
  };
  const et = eventMap[target] ?? EventType.CONTRACT_UPDATED;
  logEvent(et, "contract", id, `${old}→${target}`);
  return getContract(id);
}
