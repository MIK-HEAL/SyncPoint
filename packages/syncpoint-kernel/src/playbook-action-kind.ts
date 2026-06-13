/**
 * Playbook Action Kind — shared kernel Zod enum for action types.
 *
 * Defines the canonical set of actions that the playbook engine can recommend.
 * Moved to kernel to eliminate the semantic circular dependency between
 * syncpoint-governance (which consumes action kinds in wake.ts) and
 * syncpoint-adapters (which defines the playbook engine).
 */

import { z } from "zod";

export const PlaybookActionKind = z.enum([
  // Architect actions
  "plan-tasks",
  "assign-roles",
  "advance-session",

  // Executor actions
  "accept-assignment",
  "start-work",
  "checkpoint",
  "complete-assignment",
  "address-changes",

  // Reviewer actions
  "start-review",
  "add-checklist",
  "add-evidence",
  "evaluate-gate",
  "approve-review",
  "block-review",

  // Shared actions
  "request-review",
  "handoff",

  // Mode-specific sync actions
  "claim-resources",
  "sync-checkpoint",

  // Terminal / informational
  "wait",
  "session-completed",
  "no-action",
]);
export type PlaybookActionKind = z.infer<typeof PlaybookActionKind>;
