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

export enum EventType {
  // Agent
  AGENT_REGISTERED = "AGENT_REGISTERED",
  AGENT_STATUS_CHANGED = "AGENT_STATUS_CHANGED",
  // Task
  TASK_CREATED = "TASK_CREATED",
  TASK_ASSIGNED = "TASK_ASSIGNED",
  TASK_STATUS_CHANGED = "TASK_STATUS_CHANGED",
  // Checkpoint
  CHECKPOINT_CREATED = "CHECKPOINT_CREATED",
  // Handoff
  HANDOFF_INITIATED = "HANDOFF_INITIATED",
  HANDOFF_ACCEPTED = "HANDOFF_ACCEPTED",
  HANDOFF_REJECTED = "HANDOFF_REJECTED",
  // Diary
  DIARY_ENTRY_CREATED = "DIARY_ENTRY_CREATED",
  // Contract
  PEER_KICKOFF = "PEER_KICKOFF",
  CONTRACT_DRAFTED = "CONTRACT_DRAFTED",
  CONTRACT_REVIEW_REQUESTED = "CONTRACT_REVIEW_REQUESTED",
  CONTRACT_APPROVED = "CONTRACT_APPROVED",
  CONTRACT_REJECTED = "CONTRACT_REJECTED",
  CONTRACT_UPDATED = "CONTRACT_UPDATED",
  WORK_STARTED = "WORK_STARTED",
  CHECKPOINT_SYNC = "CHECKPOINT_SYNC",
  CONFLICT_DETECTED = "CONFLICT_DETECTED",
  // Capsule
  CAPSULE_CREATED = "CAPSULE_CREATED",
  // Project Memory
  PROJECT_MEMORY_CREATED = "PROJECT_MEMORY_CREATED",
  PROJECT_MEMORY_APPROVED = "PROJECT_MEMORY_APPROVED",
  PROJECT_MEMORY_DEPRECATED = "PROJECT_MEMORY_DEPRECATED",
  PROJECT_MEMORY_UPDATED = "PROJECT_MEMORY_UPDATED",
  // Orchestration (used by Wake Engine)
  SESSION_CREATED = "SESSION_CREATED",
  SESSION_ADVANCED = "SESSION_ADVANCED",
  SESSION_CANCELLED = "SESSION_CANCELLED",
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  ASSIGNMENT_CREATED = "ASSIGNMENT_CREATED",
  ASSIGNMENT_ACCEPTED = "ASSIGNMENT_ACCEPTED",
  ASSIGNMENT_STARTED = "ASSIGNMENT_STARTED",
  ASSIGNMENT_COMPLETED = "ASSIGNMENT_COMPLETED",
  REVIEW_REQUESTED = "REVIEW_REQUESTED",
  REVIEW_STARTED = "REVIEW_STARTED",
  REVIEW_DECIDED = "REVIEW_DECIDED",
  REVIEW_APPROVED = "REVIEW_APPROVED",
  REVIEW_BLOCKED = "REVIEW_BLOCKED",
  // Wake
  WAKE_CREATED = "WAKE_CREATED",
  WAKE_DISPATCHED = "WAKE_DISPATCHED",
  WAKE_DONE = "WAKE_DONE",
  WAKE_FAILED = "WAKE_FAILED",
  // FileClaim / Conflict
  FILE_CLAIMED = "FILE_CLAIMED",
  FILE_RELEASED = "FILE_RELEASED",
  FILE_CONFLICT_DETECTED = "FILE_CONFLICT_DETECTED",
  // SyncGate
  SYNC_GATE_CREATED = "SYNC_GATE_CREATED",
  SYNC_GATE_REQUESTED = "SYNC_GATE_REQUESTED",
  SYNC_GATE_ACKED = "SYNC_GATE_ACKED",
  SYNC_GATE_RESOLVED = "SYNC_GATE_RESOLVED",
  SYNC_GATE_CANCELLED = "SYNC_GATE_CANCELLED",
}

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

export class InvalidTransition extends Error {
  constructor(public entity: string, public fromState: string, public toState: string) {
    super(`Invalid ${entity} transition: ${fromState} → ${toState}`);
    this.name = "InvalidTransition";
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
