import type { ConstraintManifest, ContextMode, PromptFormat } from "syncpoint-core";

export interface LoopBootInput {
  agentId: string;
  taskId: string;
  provider?: string;
}

export interface LoopBootResult {
  ok: true;
  taskId: string;
  agentId: string;
  provider: string;
  taskStatus: string;
  contextReady: boolean;
  filesWritten: string[];
  files: Record<string, string>;
  warnings: string[];
}

export interface LoopResumeInput {
  agentId: string;
  taskId: string;
  provider?: string;
  format?: PromptFormat;
  contextMode?: ContextMode;
  sessionId?: string;
}

export interface LoopResumeResult {
  ok: true;
  taskId: string;
  agentId: string;
  provider: string;
  contextReady: boolean;
  filesWritten: string[];
  files: Record<string, string>;
  prompt: string;
  contextMode: string;
  protocolGateBlocked: boolean;
  snapshotValid: boolean;
  validationNotes: string[];
  constraintWarnings: string[];
  constraintManifest?: ConstraintManifest;
}

export interface LoopCheckpointInput {
  agentId: string;
  taskId: string;
  summary: string;
  progress?: string;
  nextSteps?: string;
  risks?: string;
  blockers?: string;
  goal?: string;
  phase?: string;
  completed?: string;
  remaining?: string;
  workingResources?: string;
  resumePrompt?: string;
  needSync?: boolean;
  provider?: string;
}

export interface LoopCheckpointResult {
  ok: true;
  taskId: string;
  agentId: string;
  checkpointId: string;
  snapshotId: string;
  needSync: boolean;
  filesWritten: string[];
  files: Record<string, string>;
}

export interface LoopHandoffInput {
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  context: string;
  autoAccept?: boolean;
  provider?: string;
}

export interface LoopHandoffResult {
  ok: true;
  taskId: string;
  handoffId: string;
  from: string;
  to: string;
  accepted: boolean;
  filesWritten: string[];
  files: Record<string, string>;
}

export interface LoopStatusInput {
  agentId: string;
  taskId?: string;
}

export interface LoopStatusResult {
  ok: true;
  agentId: string;
  agentName: string;
  agentStatus: string;
  hasTask: boolean;
  taskId?: string;
  taskTitle?: string;
  taskStatus?: string;
  contractStatus?: string | null;
  checkpointCount?: number;
  hasSnapshot?: boolean;
  contextReady?: boolean;
  warnings?: string[];
}

export const EXIT = {
  OK: 0,
  ERROR: 1,
  CONTEXT_POLICY: 2,
  CONTRACT_MISSING: 3,
  STATE_INVALID: 4,
} as const;

export class LoopError extends Error {
  public readonly constraintManifest?: ConstraintManifest;
  constructor(public readonly exitCode: number, message: string, opts?: { constraintManifest?: ConstraintManifest }) {
    super(message);
    this.name = "LoopError";
    this.constraintManifest = opts?.constraintManifest;
  }
}
