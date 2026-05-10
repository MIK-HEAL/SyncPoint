/**
 * Snapshot Dominant Context — types and mode definitions.
 *
 * Design principle:
 *   snapshot-only means agent working-context only, not protocol-only.
 *
 * Three layers:
 *   1. Protocol Gate   — hard collaboration rules (pinned, contract, claims, gates, review/wake)
 *   2. Snapshot Reality — agent's current task working memory
 *   3. Validation Notes — staleness, evidence coverage, missing proof
 */

import { z } from "zod";

// ── Context Mode ─────────────────────────────────────

export const ContextMode = z.enum([
  "snapshot-first",   // snapshot primary, validation notes visible, full prompt
  "snapshot-only",    // snapshot + protocol gate summary only, no raw checkpoint/project memory
  "snapshot-locked",  // validated snapshot + protocol gate only, hard-block on any gate failure
]);
export type ContextMode = z.infer<typeof ContextMode>;

export const DEFAULT_CONTEXT_MODE: ContextMode = "snapshot-first";

// ── Protocol Gate Summary ────────────────────────────

export const ProtocolRuleSchema = z.object({
  source: z.enum(["pinned-memory", "peer-contract", "resource-claim", "sync-gate", "checkpoint-review", "review", "wake", "assignment", "projection"]),
  severity: z.enum(["hard", "soft", "info"]),
  summary: z.string(),
  entityId: z.string().optional(),
});
export type ProtocolRule = z.infer<typeof ProtocolRuleSchema>;

export const ProtocolGateSummarySchema = z.object({
  /** All active protocol rules for this agent+task */
  rules: z.array(ProtocolRuleSchema),
  /** True if any hard rule is violated / unresolved */
  blocked: z.boolean(),
  /** Hard-blocking rule summaries */
  hardBlockers: z.array(z.string()),
  /** Counts by source */
  counts: z.object({
    pinnedRules: z.number(),
    contractConstraints: z.number(),
    resourceClaims: z.number(),
    activeGates: z.number(),
    activeTransactions: z.number(),
    pendingReviews: z.number(),
    pendingWakes: z.number(),
    projectionRules: z.number().default(0),
  }),
});
export type ProtocolGateSummary = z.infer<typeof ProtocolGateSummarySchema>;

// ── Snapshot Validation ──────────────────────────────

export const SnapshotValidationSchema = z.object({
  /** Overall: is the snapshot valid for use? */
  valid: z.boolean(),
  /** Is the snapshot stale relative to latest checkpoint? */
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  /** Does the snapshot belong to the correct task+agent? */
  scopeMatch: z.boolean(),
  /** Are there unresolved blockers in the snapshot? */
  hasBlockers: z.boolean(),
  /** Evidence: does a checkpoint exist to back the snapshot? */
  hasEvidence: z.boolean(),
  /** Needs sync flag from checkpoint */
  needsSync: z.boolean(),
  /** Human-readable validation notes */
  notes: z.array(z.string()),
});
export type SnapshotValidation = z.infer<typeof SnapshotValidationSchema>;

/** @deprecated Use SnapshotValidationSchema */
export const CapsuleValidationSchema = SnapshotValidationSchema;
/** @deprecated Use SnapshotValidation */
export type CapsuleValidation = SnapshotValidation;

// ── Extended Snapshot Fields (additive) ──────────────
// These are optional new fields that enrich the snapshot.
// Existing snapshots without these fields still work (defaults to "").

export const SnapshotExtendedFieldsSchema = z.object({
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
});
export type SnapshotExtendedFields = z.infer<typeof SnapshotExtendedFieldsSchema>;

/** @deprecated Use SnapshotExtendedFieldsSchema */
export const CapsuleExtendedFieldsSchema = SnapshotExtendedFieldsSchema;
/** @deprecated Use SnapshotExtendedFields */
export type CapsuleExtendedFields = SnapshotExtendedFields;
