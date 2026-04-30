/**
 * SyncPoint data model interfaces.
 * These are pure type definitions — no runtime dependencies beyond Zod schemas.
 */

import { z } from "zod";
import {
  AgentStatus,
  TaskStatus,
  HandoffStatus,
  ContractStatus,
  DiaryEntryType,
  EventType,
} from "./states.js";

// ── Helpers ────────────────────────────────────────────

const nanoid12 = z.string().min(1).max(24);
const isoDate = z.string().datetime({ offset: true });
const jsonField = z.string().default(""); // JSON stored as string

// ── Agent ──────────────────────────────────────────────

export const AgentSchema = z.object({
  id: nanoid12,
  name: z.string().min(1),
  provider: z.enum(["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"]),
  role: z.enum(["manager", "frontend", "backend", "tester", "reviewer", "other"]),
  status: z.nativeEnum(AgentStatus).default(AgentStatus.IDLE),
  currentTaskId: z.string().nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Agent = z.infer<typeof AgentSchema>;

export const AgentCreateSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(["codex", "claude-code", "cursor", "cline", "copilot", "human", "other"]),
  role: z.enum(["manager", "frontend", "backend", "tester", "reviewer", "other"]),
});

export type AgentCreate = z.infer<typeof AgentCreateSchema>;

// ── Task ───────────────────────────────────────────────

export const TaskSchema = z.object({
  id: nanoid12,
  title: z.string().min(1),
  description: z.string().default(""),
  status: z.nativeEnum(TaskStatus).default(TaskStatus.OPEN),
  ownerAgentId: z.string().nullable().default(null),
  parentTaskId: z.string().nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
});

export type TaskCreate = z.infer<typeof TaskCreateSchema>;

// ── Checkpoint ─────────────────────────────────────────

export const CheckpointSchema = z.object({
  id: nanoid12,
  taskId: nanoid12,
  agentId: nanoid12,
  summary: z.string().min(1),
  progress: z.string().default(""),
  currentUnderstanding: z.string().default(""),
  changedFiles: jsonField,
  risks: z.string().default(""),
  blockers: z.string().default(""),
  nextSteps: z.string().default(""),
  needSync: z.boolean().default(false),
  createdAt: isoDate,
});

export type Checkpoint = z.infer<typeof CheckpointSchema>;

export const CheckpointCreateSchema = z.object({
  taskId: nanoid12,
  agentId: nanoid12,
  summary: z.string().min(1),
  progress: z.string().default(""),
  currentUnderstanding: z.string().default(""),
  changedFiles: jsonField,
  risks: z.string().default(""),
  blockers: z.string().default(""),
  nextSteps: z.string().default(""),
  needSync: z.boolean().default(false),
});

export type CheckpointCreate = z.infer<typeof CheckpointCreateSchema>;

// ── DiaryEntry ─────────────────────────────────────────

export const DiaryEntrySchema = z.object({
  id: nanoid12,
  agentId: nanoid12,
  taskId: nanoid12,
  entryType: z.nativeEnum(DiaryEntryType).default(DiaryEntryType.NOTE),
  content: z.string().min(1),
  createdAt: isoDate,
});

export type DiaryEntry = z.infer<typeof DiaryEntrySchema>;

export const DiaryEntryCreateSchema = z.object({
  agentId: nanoid12,
  taskId: nanoid12,
  entryType: z.nativeEnum(DiaryEntryType).default(DiaryEntryType.NOTE),
  content: z.string().min(1),
});

export type DiaryEntryCreate = z.infer<typeof DiaryEntryCreateSchema>;

// ── Handoff ────────────────────────────────────────────

export const HandoffSchema = z.object({
  id: nanoid12,
  fromAgentId: nanoid12,
  toAgentId: nanoid12,
  taskId: nanoid12,
  contextSummary: z.string().min(1),
  status: z.nativeEnum(HandoffStatus).default(HandoffStatus.PENDING),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Handoff = z.infer<typeof HandoffSchema>;

export const HandoffCreateSchema = z.object({
  fromAgentId: nanoid12,
  toAgentId: nanoid12,
  taskId: nanoid12,
  contextSummary: z.string().min(1),
});

export type HandoffCreate = z.infer<typeof HandoffCreateSchema>;

// ── PeerContract ───────────────────────────────────────

export const PeerContractSchema = z.object({
  id: nanoid12,
  taskId: nanoid12,
  title: z.string().default(""),
  participants: jsonField,       // JSON array of agent ids
  scope: z.string().default(""),
  responsibilities: jsonField,  // JSON {agentId: string}
  interfaceSpec: jsonField,     // JSON: API endpoints, schemas
  fileBoundaries: jsonField,    // JSON {agentId: [patterns]}
  dependencies: jsonField,      // JSON
  testPlan: z.string().default(""),
  risks: z.string().default(""),
  status: z.nativeEnum(ContractStatus).default(ContractStatus.DRAFT),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type PeerContract = z.infer<typeof PeerContractSchema>;

export const PeerContractCreateSchema = z.object({
  taskId: nanoid12,
  title: z.string().default(""),
  participants: jsonField,
  scope: z.string().default(""),
  responsibilities: jsonField,
  interfaceSpec: jsonField,
  fileBoundaries: jsonField,
  dependencies: jsonField,
  testPlan: z.string().default(""),
  risks: z.string().default(""),
});

export type PeerContractCreate = z.infer<typeof PeerContractCreateSchema>;

// ── ContextCapsule ─────────────────────────────────────

export const ContextCapsuleSchema = z.object({
  id: nanoid12,
  taskId: nanoid12,
  agentId: nanoid12,
  checkpointId: nanoid12,
  goal: z.string().default(""),
  currentPhase: z.string().default(""),
  confirmedDecisions: jsonField,    // JSON array
  interfaceContract: jsonField,     // JSON ref to peer contract
  workingFiles: jsonField,         // JSON array
  completedWork: z.string().default(""),
  remainingWork: z.string().default(""),
  risks: z.string().default(""),
  blockers: z.string().default(""),
  nextSteps: z.string().default(""),
  resumePrompt: z.string().default(""),
  // P12 extended capsule fields
  intentScope: z.string().default(""),
  nonGoals: z.string().default(""),
  verifiedFacts: z.string().default(""),
  unverifiedClaims: z.string().default(""),
  evidenceRefs: z.string().default(""),
  activeConstraints: z.string().default(""),
  doNotTouch: z.string().default(""),
  handoffInstructions: z.string().default(""),
  validationStatus: z.string().default(""),
  staleReason: z.string().default(""),
  createdAt: isoDate,
});

export type ContextCapsule = z.infer<typeof ContextCapsuleSchema>;

export const ContextCapsuleCreateSchema = z.object({
  taskId: nanoid12,
  agentId: nanoid12,
  checkpointId: nanoid12,
  goal: z.string().default(""),
  currentPhase: z.string().default(""),
  confirmedDecisions: jsonField,
  interfaceContract: jsonField,
  workingFiles: jsonField,
  completedWork: z.string().default(""),
  remainingWork: z.string().default(""),
  risks: z.string().default(""),
  blockers: z.string().default(""),
  nextSteps: z.string().default(""),
  resumePrompt: z.string().default(""),
  // P12 extended capsule fields (all optional for backward compat)
  intentScope: z.string().optional().default(""),
  nonGoals: z.string().optional().default(""),
  verifiedFacts: z.string().optional().default(""),
  unverifiedClaims: z.string().optional().default(""),
  evidenceRefs: z.string().optional().default(""),
  activeConstraints: z.string().optional().default(""),
  doNotTouch: z.string().optional().default(""),
  handoffInstructions: z.string().optional().default(""),
});

export type ContextCapsuleCreate = z.input<typeof ContextCapsuleCreateSchema>;

// ── Event ──────────────────────────────────────────────

export const EventSchema = z.object({
  id: nanoid12,
  eventType: z.nativeEnum(EventType),
  entityType: z.enum(["agent", "task", "checkpoint", "handoff", "contract", "capsule", "diary"]),
  entityId: nanoid12,
  detail: z.string().default(""),
  createdAt: isoDate,
});

export type Event = z.infer<typeof EventSchema>;

// ── Status response ────────────────────────────────────

export const StatusResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

export type StatusResponse = z.infer<typeof StatusResponseSchema>;
