/**
 * Relationship Mode — explicit coordination patterns between agents.
 *
 * Three modes, each with distinct synchronization rules:
 *
 *   manager-delegate:  delegate → wait → report → review
 *   peer-contract:     contract → parallel work → checkpoint sync → merge
 *   handoff-resume:    capsule → handoff → accept → resume
 */

import { z } from "zod";

// ── Mode ────────────────────────────────────────────

export enum RelationshipMode {
  MANAGER_DELEGATE = "manager-delegate",
  PEER_CONTRACT = "peer-contract",
  HANDOFF_RESUME = "handoff-resume",
}

export const RelationshipModeSchema = z.nativeEnum(RelationshipMode);

// ── Phase flow per mode ─────────────────────────────

/**
 * The expected phase sequence for each mode.
 * These are the "sync verbs" that wake/playbook should enforce.
 */
export const MODE_PHASE_FLOW: Record<RelationshipMode, string[]> = {
  [RelationshipMode.MANAGER_DELEGATE]: [
    "plan",          // architect plans & delegates
    "accept",        // executor accepts assignment
    "work",          // executor works (with checkpoints)
    "checkpoint",    // executor creates checkpoint
    "report",        // executor completes → reports back
    "review",        // reviewer/architect reviews
    "approve",       // reviewer approves or requests changes
  ],
  [RelationshipMode.PEER_CONTRACT]: [
    "contract",      // peers agree on scope boundary
    "claim-files",   // each peer claims file ownership
    "work",          // parallel work (with checkpoints)
    "checkpoint",    // checkpoint to sync state
    "sync",          // sync gate when overlap detected
    "merge",         // merge results after sync
    "review",        // mutual or third-party review
  ],
  [RelationshipMode.HANDOFF_RESUME]: [
    "capsule",       // current agent creates context capsule
    "handoff",       // handoff to next agent
    "accept",        // next agent accepts handoff
    "resume",        // next agent resumes with capsule context
    "work",          // next agent works
    "checkpoint",    // checkpoint progress
  ],
};

// ── Sync rules per mode ─────────────────────────────

export interface ModeSyncRule {
  /** Sync gate required before this phase? */
  requiresSyncGate: boolean;
  /** File claim required before work? */
  requiresFileClaim: boolean;
  /** Checkpoint required before this phase? */
  requiresCheckpoint: boolean;
  /** Review required before advancing? */
  requiresReview: boolean;
  /** Can agents work in parallel? */
  allowsParallelWork: boolean;
}

export const MODE_SYNC_RULES: Record<RelationshipMode, ModeSyncRule> = {
  [RelationshipMode.MANAGER_DELEGATE]: {
    requiresSyncGate: false,
    requiresFileClaim: false,
    requiresCheckpoint: true,
    requiresReview: true,
    allowsParallelWork: false,
  },
  [RelationshipMode.PEER_CONTRACT]: {
    requiresSyncGate: true,
    requiresFileClaim: true,
    requiresCheckpoint: true,
    requiresReview: true,
    allowsParallelWork: true,
  },
  [RelationshipMode.HANDOFF_RESUME]: {
    requiresSyncGate: false,
    requiresFileClaim: false,
    requiresCheckpoint: true,
    requiresReview: false,
    allowsParallelWork: false,
  },
};

// ── Wake verb whitelist per mode ────────────────────

/**
 * Which wake actions are valid for each mode.
 * This is used by P4 to restrict wake generation.
 */
export const MODE_WAKE_VERBS: Record<RelationshipMode, string[]> = {
  [RelationshipMode.MANAGER_DELEGATE]: [
    "plan", "plan-tasks", "accept", "accept-assignment",
    "checkpoint", "review", "start-review", "request-review",
    "approve", "advance-session", "resume", "address-changes",
  ],
  [RelationshipMode.PEER_CONTRACT]: [
    "plan", "plan-tasks", "accept", "accept-assignment",
    "claim-files", "checkpoint", "sync", "sync-checkpoint",
    "review", "start-review", "request-review",
    "approve", "advance-session", "resume", "address-changes",
  ],
  [RelationshipMode.HANDOFF_RESUME]: [
    "capsule", "handoff", "accept", "accept-assignment",
    "resume", "checkpoint", "plan", "plan-tasks",
    "advance-session",
  ],
};

// ── Mode action enforcement ────────────────────────

export type ModeActionVerdict = "allowed" | "recommended" | "blocked";

/**
 * Actions that MUST be performed before an agent can start work in this mode.
 */
export const REQUIRED_BEFORE_START: Record<RelationshipMode, string[]> = {
  [RelationshipMode.MANAGER_DELEGATE]: [
    "accept",
  ],
  [RelationshipMode.PEER_CONTRACT]: [
    "accept",
    "claim-files",
  ],
  [RelationshipMode.HANDOFF_RESUME]: [
    "accept",
  ],
};

/**
 * Actions that are recommended (but not required) in each mode.
 */
export const RECOMMENDED_ACTIONS: Record<RelationshipMode, string[]> = {
  [RelationshipMode.MANAGER_DELEGATE]: [
    "checkpoint", "review", "approve",
  ],
  [RelationshipMode.PEER_CONTRACT]: [
    "checkpoint", "sync-checkpoint", "review",
  ],
  [RelationshipMode.HANDOFF_RESUME]: [
    "checkpoint", "capsule", "handoff",
  ],
};

/**
 * Actions that should NEVER be generated for this mode (in wake/playbook).
 */
export const FORBIDDEN_ACTIONS: Record<RelationshipMode, string[]> = {
  [RelationshipMode.MANAGER_DELEGATE]: [
    "claim-files", "sync-checkpoint", "handoff", "capsule",
  ],
  [RelationshipMode.PEER_CONTRACT]: [
    "handoff", "capsule",
  ],
  [RelationshipMode.HANDOFF_RESUME]: [
    "claim-files", "sync-checkpoint", "start-review", "request-review",
  ],
};

// ── Pure helpers ────────────────────────────────────

/**
 * Check if a wake action verb is valid for a given mode.
 */
export function isValidWakeVerb(mode: RelationshipMode, action: string): boolean {
  return MODE_WAKE_VERBS[mode]?.includes(action) ?? false;
}

/**
 * Get the sync rules for a given mode.
 */
export function getSyncRules(mode: RelationshipMode): ModeSyncRule {
  return MODE_SYNC_RULES[mode];
}

/**
 * Get the expected phase flow for a given mode.
 */
export function getPhaseFlow(mode: RelationshipMode): string[] {
  return MODE_PHASE_FLOW[mode];
}

/**
 * Get a human-readable description of a mode's coordination pattern.
 */
export function getModeDescription(mode: RelationshipMode): string {
  switch (mode) {
    case RelationshipMode.MANAGER_DELEGATE:
      return "Manager delegates tasks to executor(s). Executor reports back. Manager/reviewer approves. Sequential, hierarchical coordination.";
    case RelationshipMode.PEER_CONTRACT:
      return "Peers agree on scope boundaries via contracts. File claims prevent conflicts. Sync gates enforce coordination at overlap points. Parallel work with structured merge.";
    case RelationshipMode.HANDOFF_RESUME:
      return "One agent packages context into a capsule and hands off to the next. Sequential relay — each agent picks up where the previous left off.";
  }
}

/**
 * Determine if a given action is allowed, recommended, or blocked for a mode.
 */
export function isModeActionAllowed(mode: RelationshipMode, action: string): ModeActionVerdict {
  if (FORBIDDEN_ACTIONS[mode].includes(action)) return "blocked";
  if (RECOMMENDED_ACTIONS[mode].includes(action)) return "recommended";
  return "allowed";
}

/**
 * Get actions required before an agent can start work in this mode.
 */
export function getRequiredBeforeStart(mode: RelationshipMode): string[] {
  return REQUIRED_BEFORE_START[mode];
}

/**
 * Get recommended actions for a mode.
 */
export function getRecommendedActions(mode: RelationshipMode): string[] {
  return RECOMMENDED_ACTIONS[mode];
}

/**
 * Get forbidden actions for a mode.
 */
export function getForbiddenActions(mode: RelationshipMode): string[] {
  return FORBIDDEN_ACTIONS[mode];
}
