/**
 * Context Policy — role-aware context preparation layer.
 *
 * Defines what context each role/intent needs before starting work,
 * and whether missing context should hard-block, soft-warn, or pass through.
 */

import { z } from "zod";

// ── Enums ────────────────────────────────────────────

export const ContextIntent = z.enum([
  "execute",
  "resume",
  "handoff-receive",
  "review",
  "architect-plan",
  "project-onboard",
  "memory-review",
]);
export type ContextIntent = z.infer<typeof ContextIntent>;

export const ContextRole = z.enum([
  "architect",
  "executor",
  "reviewer",
  "peer",
  "handoff-receiver",
  "observer",
]);
export type ContextRole = z.infer<typeof ContextRole>;

export const ContextGateMode = z.enum(["hard", "soft", "none"]);
export type ContextGateMode = z.infer<typeof ContextGateMode>;

// ── Context Section ──────────────────────────────────

export const ContextSection = z.enum([
  "task",
  "agent",
  "latest-capsule",
  "latest-checkpoint",
  "approved-contract",
  "handoff-context",
  "approved-project-memory",
  "pinned-memory",
  "task-list",
  "agent-list",
  "draft-memories",
  "deprecated-memories",
  "open-decisions",
  "risks",
]);
export type ContextSection = z.infer<typeof ContextSection>;

// ── Policy Definition ────────────────────────────────

export const ContextPolicySchema = z.object({
  intent: ContextIntent,
  gateMode: ContextGateMode,
  requiredSections: z.array(ContextSection),
  includeSections: z.array(ContextSection),
  description: z.string(),
});
export type ContextPolicy = z.infer<typeof ContextPolicySchema>;

// ── Policy Check Result ──────────────────────────────

export const ContextPolicyCheckSchema = z.object({
  section: ContextSection,
  present: z.boolean(),
  required: z.boolean(),
  message: z.string(),
});
export type ContextPolicyCheck = z.infer<typeof ContextPolicyCheckSchema>;

// ── Prepared Context ─────────────────────────────────

export const PreparedContextSchema = z.object({
  intent: ContextIntent,
  role: ContextRole,
  gateMode: ContextGateMode,

  /** Is the context ready to proceed? (hard gate: false blocks; soft gate: false warns) */
  ready: z.boolean(),

  /** Which required sections are missing */
  missingSections: z.array(ContextSection),

  /** Per-section check results */
  checks: z.array(ContextPolicyCheckSchema),

  /** Human-readable warnings */
  warnings: z.array(z.string()),

  /** Task info (null if task not required or not found) */
  task: z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    ownerAgentId: z.string().nullable(),
  }).nullable(),

  /** Agent info (null if agent not required or not found) */
  agent: z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
  }).nullable(),

  /** Resume context (present for execute/resume/handoff-receive) */
  resumeContext: z.any().nullable(),

  /** Latest handoff context (present for handoff-receive when available) */
  handoffContext: z.object({
    id: z.string(),
    fromAgentId: z.string(),
    toAgentId: z.string(),
    taskId: z.string(),
    contextSummary: z.string(),
    status: z.string(),
  }).nullable().default(null),

  /** Approved project memories */
  projectMemories: z.array(z.object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    content: z.string(),
  })),

  /** Draft project memories (for memory-review intent) */
  draftMemories: z.array(z.object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    content: z.string(),
    status: z.string(),
  })).default([]),

  /** All tasks (for architect-plan, project-onboard) */
  taskList: z.array(z.object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    ownerAgentId: z.string().nullable(),
  })).default([]),

  /** All agents (for project-onboard) */
  agentList: z.array(z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
    status: z.string(),
  })).default([]),

  /** Formatted prompt text for the given intent */
  prompt: z.string(),

  /** Suggested next actions for the agent */
  suggestedNextActions: z.array(z.string()),

  generatedAt: z.string(),
});
export type PreparedContext = z.infer<typeof PreparedContextSchema>;

// ── Policy Registry ──────────────────────────────────

export const CONTEXT_POLICIES: Record<ContextIntent, ContextPolicy> = {
  execute: {
    intent: "execute",
    gateMode: "hard",
    requiredSections: ["task", "agent", "latest-capsule", "latest-checkpoint"],
    includeSections: ["approved-contract", "approved-project-memory", "pinned-memory"],
    description: "Execute a task — requires full task context, hard gate on missing capsule/checkpoint.",
  },
  resume: {
    intent: "resume",
    gateMode: "hard",
    requiredSections: ["task", "agent", "latest-capsule", "latest-checkpoint"],
    includeSections: ["approved-contract", "approved-project-memory", "pinned-memory"],
    description: "Resume a task — same as execute, hard gate.",
  },
  "handoff-receive": {
    intent: "handoff-receive",
    gateMode: "hard",
    requiredSections: ["task", "agent", "latest-capsule"],
    includeSections: ["approved-contract", "handoff-context", "approved-project-memory", "pinned-memory"],
    description: "Receive a handoff — requires capsule and handoff context, hard gate.",
  },
  review: {
    intent: "review",
    gateMode: "soft",
    requiredSections: ["task", "latest-checkpoint", "latest-capsule"],
    includeSections: ["approved-contract", "approved-project-memory", "risks"],
    description: "Review a task — requires checkpoint/capsule, soft gate on missing info.",
  },
  "architect-plan": {
    intent: "architect-plan",
    gateMode: "soft",
    requiredSections: ["approved-project-memory"],
    includeSections: ["task-list", "open-decisions", "risks"],
    description: "Architecture planning — requires project memory, soft gate.",
  },
  "project-onboard": {
    intent: "project-onboard",
    gateMode: "none",
    requiredSections: [],
    includeSections: ["approved-project-memory", "task-list", "agent-list"],
    description: "Project onboarding — no hard requirements, includes everything available.",
  },
  "memory-review": {
    intent: "memory-review",
    gateMode: "none",
    requiredSections: [],
    includeSections: ["approved-project-memory", "draft-memories", "deprecated-memories"],
    description: "Memory review and curation — lists all memories by status.",
  },
};

/**
 * Get the context policy for an intent.
 */
export function getContextPolicy(intent: ContextIntent): ContextPolicy {
  return CONTEXT_POLICIES[intent];
}

/**
 * List all supported intents.
 */
export function listContextIntents(): ContextIntent[] {
  return ContextIntent.options;
}

/**
 * List all supported roles.
 */
export function listContextRoles(): ContextRole[] {
  return ContextRole.options;
}
