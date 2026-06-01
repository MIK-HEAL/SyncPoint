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
import { AgentProviderSchema, AgentRoleSchema } from "./agent-file-manifest.js";

// ── Helpers ────────────────────────────────────────────

const nanoid12 = z.string().min(1).max(24);
const isoDate = z.string().datetime({ offset: true });
const jsonField = z.string().default(""); // JSON stored as string

// ── Agent ──────────────────────────────────────────────

export const AgentSchema = z.object({
  id: nanoid12,
  name: z.string().min(1),
  provider: AgentProviderSchema,
  role: AgentRoleSchema,
  status: z.nativeEnum(AgentStatus).default(AgentStatus.IDLE),
  currentTaskId: z.string().nullable().default(null),
  runtimeId: z.string().nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export type Agent = z.infer<typeof AgentSchema>;

export const AgentCreateSchema = z.object({
  name: z.string().min(1),
  provider: AgentProviderSchema,
  role: AgentRoleSchema,
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
  changedFiles: z.array(z.string()).default([]),
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
  changedFiles: z.array(z.string()).default([]),
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
  participants: z.array(z.string()).default([]),       // JSON array of agent ids
  scope: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),  // JSON {agentId: string}
  interfaceSpec: z.array(z.string()).default([]),     // JSON: API endpoints, schemas
  fileBoundaries: z.array(z.string()).default([]),    // JSON {agentId: [patterns]}
  dependencies: z.array(z.string()).default([]),      // JSON
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
  participants: z.array(z.string()).default([]),
  scope: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  interfaceSpec: z.array(z.string()).default([]),
  fileBoundaries: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  testPlan: z.string().default(""),
  risks: z.string().default(""),
});

export type PeerContractCreate = z.infer<typeof PeerContractCreateSchema>;

// ── ContextSnapshotPayload ──────────────────────────

export const ContextSnapshotPayloadSchema = z.object({
  goal: z.string().optional(),
  currentPhase: z.string().optional(),
  confirmedDecisions: z.array(z.string()).optional(),
  interfaceContract: z.unknown().optional(),
  completedWork: z.string().optional(),
  remainingWork: z.string().optional(),
  risks: z.array(z.string()).optional(),
  blockers: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  resumePrompt: z.string().optional(),
  intentScope: z.string().optional(),
  nonGoals: z.array(z.string()).optional(),
  verifiedFacts: z.array(z.string()).optional(),
  unverifiedClaims: z.array(z.string()).optional(),
  evidenceRefs: z.array(z.string()).optional(),
  activeConstraints: z.array(z.string()).optional(),
  doNotTouch: z.array(z.string()).optional(),
  handoffInstructions: z.string().optional(),
  workingResources: z.array(z.string()).optional(),
});

export type ContextSnapshotPayload = z.infer<typeof ContextSnapshotPayloadSchema>;

// ── ContextSnapshot ────────────────────────────────

export const ContextSnapshotSchema = z.object({
  id: nanoid12,
  taskId: nanoid12,
  agentId: nanoid12,
  checkpointId: nanoid12.optional(),
  kind: z.enum(["resume", "handoff", "review", "system"]).default("resume"),
  summary: z.string().default(""),
  payload: ContextSnapshotPayloadSchema,
  validationStatus: z.string().default(""),
  staleReason: z.string().default(""),
  createdAt: isoDate,
});

export type ContextSnapshot = z.infer<typeof ContextSnapshotSchema>;

export const ContextSnapshotCreateSchema = z.object({
  taskId: nanoid12,
  agentId: nanoid12,
  checkpointId: nanoid12.optional(),
  kind: z.enum(["resume", "handoff", "review", "system"]).default("resume"),
  summary: z.string().default(""),
  payload: ContextSnapshotPayloadSchema,
});

export type ContextSnapshotCreate = z.input<typeof ContextSnapshotCreateSchema>;

// ── Event ──────────────────────────────────────────────

export const EventSchema = z.object({
  id: nanoid12,
  eventType: z.nativeEnum(EventType),
  entityType: z.enum(["agent", "task", "checkpoint", "handoff", "contract", "context_snapshot", "diary", "agent_message"]),
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
