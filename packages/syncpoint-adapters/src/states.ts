/**
 * SyncPoint Core — types, state machine, protocol, Zod schemas.
 *
 * This package has NO Node-specific or editor-specific dependencies.
 * It defines the collaboration protocol in a language-agnostic way.
 */

// ── Enums ──────────────────────────────────────────────

export enum AgentStatus {
  IDLE = "IDLE",
  RUNNING = "RUNNING",
  CHECKPOINT = "CHECKPOINT",
  WAITING_SYNC = "WAITING_SYNC",
  BLOCKED = "BLOCKED",
  WAITING_REVIEW = "WAITING_REVIEW",
  HANDOFF = "HANDOFF",
  DONE = "DONE",
}

export enum TaskStatus {
  OPEN = "OPEN",
  ASSIGNED = "ASSIGNED",
  NEEDS_CONTRACT = "NEEDS_CONTRACT",
  CONTRACT_REVIEW = "CONTRACT_REVIEW",
  READY_TO_WORK = "READY_TO_WORK",
  IN_PROGRESS = "IN_PROGRESS",
  NEEDS_SYNC = "NEEDS_SYNC",
  BLOCKED = "BLOCKED",
  REVIEWING = "REVIEWING",
  DONE = "DONE",
  CANCELLED = "CANCELLED",
}

export enum HandoffStatus {
  PENDING = "PENDING",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  DONE = "DONE",
}

export enum ContractStatus {
  DRAFT = "DRAFT",
  REVIEWING = "REVIEWING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  ACTIVE = "ACTIVE",
  CLOSED = "CLOSED",
}

export enum DiaryEntryType {
  NOTE = "NOTE",
  REPORT = "REPORT",
  DECISION = "DECISION",
  RISK = "RISK",
}

// EventType is now imported from syncpoint-kernel (canonical source)
export { EventType } from "syncpoint-kernel";

// ── State transitions ──────────────────────────────────

export const AGENT_TRANSITIONS: Record<AgentStatus, AgentStatus[]> = {
  [AgentStatus.IDLE]: [AgentStatus.RUNNING],
  [AgentStatus.RUNNING]: [AgentStatus.CHECKPOINT, AgentStatus.BLOCKED, AgentStatus.HANDOFF, AgentStatus.WAITING_REVIEW, AgentStatus.DONE],
  [AgentStatus.CHECKPOINT]: [AgentStatus.WAITING_SYNC, AgentStatus.RUNNING],
  [AgentStatus.WAITING_SYNC]: [AgentStatus.RUNNING],
  [AgentStatus.BLOCKED]: [AgentStatus.RUNNING, AgentStatus.IDLE],
  [AgentStatus.WAITING_REVIEW]: [AgentStatus.RUNNING, AgentStatus.DONE],
  [AgentStatus.HANDOFF]: [AgentStatus.DONE, AgentStatus.IDLE],
  [AgentStatus.DONE]: [AgentStatus.IDLE],
};

export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  [TaskStatus.OPEN]: [TaskStatus.ASSIGNED, TaskStatus.CANCELLED],
  [TaskStatus.ASSIGNED]: [TaskStatus.IN_PROGRESS, TaskStatus.NEEDS_CONTRACT, TaskStatus.CANCELLED],
  [TaskStatus.NEEDS_CONTRACT]: [TaskStatus.CONTRACT_REVIEW, TaskStatus.CANCELLED],
  [TaskStatus.CONTRACT_REVIEW]: [TaskStatus.READY_TO_WORK, TaskStatus.NEEDS_CONTRACT, TaskStatus.CANCELLED],
  [TaskStatus.READY_TO_WORK]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.NEEDS_SYNC, TaskStatus.BLOCKED, TaskStatus.REVIEWING, TaskStatus.DONE, TaskStatus.CANCELLED],
  [TaskStatus.NEEDS_SYNC]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.CANCELLED],
  [TaskStatus.BLOCKED]: [TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED],
  [TaskStatus.REVIEWING]: [TaskStatus.IN_PROGRESS, TaskStatus.DONE, TaskStatus.CANCELLED],
  [TaskStatus.DONE]: [],
  [TaskStatus.CANCELLED]: [],
};

export const CONTRACT_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  [ContractStatus.DRAFT]: [ContractStatus.REVIEWING, ContractStatus.REJECTED],
  [ContractStatus.REVIEWING]: [ContractStatus.APPROVED, ContractStatus.REJECTED, ContractStatus.DRAFT],
  [ContractStatus.APPROVED]: [ContractStatus.ACTIVE],
  [ContractStatus.REJECTED]: [ContractStatus.DRAFT],
  [ContractStatus.ACTIVE]: [ContractStatus.CLOSED],
  [ContractStatus.CLOSED]: [],
};

// ── Protocol validation ────────────────────────────────

import { InvalidStateTransitionError } from "syncpoint-kernel";

/**
 * @deprecated Use InvalidStateTransitionError from syncpoint-kernel directly.
 * Kept for backward compatibility.
 */
export class InvalidTransition extends InvalidStateTransitionError {
  constructor(entity: string, fromState: string, toState: string) {
    super(entity, fromState, toState);
  }
}

export function validateAgentTransition(current: AgentStatus, target: AgentStatus): void {
  const allowed = AGENT_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("agent", current, target);
  }
}

export function validateTaskTransition(current: TaskStatus, target: TaskStatus): void {
  const allowed = TASK_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("task", current, target);
  }
}

export function validateContractTransition(current: ContractStatus, target: ContractStatus): void {
  const allowed = CONTRACT_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new InvalidTransition("contract", current, target);
  }
}
