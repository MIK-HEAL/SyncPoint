/**
 * Approval Gate — shared kernel types for review approval gates.
 *
 * ApprovalGateStatus and ApprovalGateResult are kernel-level types because both
 * syncpoint-governance (review workflow) and syncpoint-adapters (playbook engine)
 * depend on them at runtime. Housing them in kernel breaks the circular dependency
 * between governance ↔ adapters.
 */

import { z } from "zod";

// ── ApprovalGateStatus ────────────────────────────────

export enum ApprovalGateStatus {
  PENDING = "PENDING",
  PASSED = "PASSED",
  BLOCKED = "BLOCKED",
  WAIVED = "WAIVED",
}

// ── ApprovalGateResult ────────────────────────────────

export const ApprovalGateResultSchema = z.object({
  status: z.nativeEnum(ApprovalGateStatus),
  reasons: z.array(z.string()),
  checklistTotal: z.number(),
  checklistPassed: z.number(),
  checklistFailed: z.number(),
  checklistWaived: z.number(),
  checklistOpen: z.number(),
  evidenceCount: z.number(),
  openChangeRequests: z.number(),
});
export type ApprovalGateResult = z.infer<typeof ApprovalGateResultSchema>;
