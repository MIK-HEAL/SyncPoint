/**
 * Capsule Dominant Context — types and mode definitions.
 *
 * Design principle:
 *   capsule-only means agent working-context only, not protocol-only.
 *
 * Three layers:
 *   1. Protocol Gate   — hard collaboration rules (pinned, contract, claims, gates, review/wake)
 *   2. Capsule Reality  — agent's current task working memory
 *   3. Validation Notes — staleness, evidence coverage, missing proof
 */

import { z } from "zod";

// ── Context Mode ─────────────────────────────────────

export const ContextMode = z.enum([
  "capsule-first",   // capsule primary, validation notes visible, full prompt
  "capsule-only",    // capsule + protocol gate summary only, no raw checkpoint/project memory
  "capsule-locked",  // validated capsule + protocol gate only, hard-block on any gate failure
]);
export type ContextMode = z.infer<typeof ContextMode>;

export const DEFAULT_CONTEXT_MODE: ContextMode = "capsule-first";

// ── Protocol Gate Summary ────────────────────────────

export const ProtocolRuleSchema = z.object({
  source: z.enum(["pinned-memory", "peer-contract", "file-claim", "sync-gate", "sync-transaction", "review", "wake", "assignment", "projection"]),
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
    fileClaims: z.number(),
    activeGates: z.number(),
    activeTransactions: z.number(),
    pendingReviews: z.number(),
    pendingWakes: z.number(),
    projectionRules: z.number().default(0),
  }),
});
export type ProtocolGateSummary = z.infer<typeof ProtocolGateSummarySchema>;

// ── Capsule Validation ───────────────────────────────

export const CapsuleValidationSchema = z.object({
  /** Overall: is the capsule valid for use? */
  valid: z.boolean(),
  /** Is the capsule stale relative to latest checkpoint? */
  stale: z.boolean(),
  staleReason: z.string().nullable(),
  /** Does the capsule belong to the correct task+agent? */
  scopeMatch: z.boolean(),
  /** Are there unresolved blockers in the capsule? */
  hasBlockers: z.boolean(),
  /** Evidence: does a checkpoint exist to back the capsule? */
  hasEvidence: z.boolean(),
  /** Needs sync flag from checkpoint */
  needsSync: z.boolean(),
  /** Human-readable validation notes */
  notes: z.array(z.string()),
});
export type CapsuleValidation = z.infer<typeof CapsuleValidationSchema>;

// ── Extended Capsule Fields (additive) ───────────────
// These are optional new fields that enrich the capsule.
// Existing capsules without these fields still work (defaults to "").

export const CapsuleExtendedFieldsSchema = z.object({
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
export type CapsuleExtendedFields = z.infer<typeof CapsuleExtendedFieldsSchema>;
