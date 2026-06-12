/**
 * Approval Gate — shared kernel types for review approval gates.
 *
 * ApprovalGateStatus is a kernel-level enum because both
 * syncpoint-governance (review workflow) and syncpoint-adapters (playbook engine)
 * depend on it at runtime. Housing it in kernel breaks the circular dependency
 * between governance ↔ adapters.
 */

// ── ApprovalGateStatus ────────────────────────────────

export enum ApprovalGateStatus {
  PENDING = "PENDING",
  PASSED = "PASSED",
  BLOCKED = "BLOCKED",
  WAIVED = "WAIVED",
}
