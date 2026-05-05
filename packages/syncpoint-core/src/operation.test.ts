/**
 * Unit tests for Operation — generic operation protocol.
 */

import { describe, it, expect } from "vitest";
import {
  OperationStatus,
  validateOperationTransition,
} from "./operation.js";
import {
  PatchProposalStatus,
  patchProposalToOperation,
  operationToPatchProposal,
  patchStatusToOperationStatus,
  operationStatusToPatchStatus,
} from "./patch-proposal.js";
import type { PatchProposal } from "./patch-proposal.js";

// ── Operation transitions ──────────────────────────

describe("Operation status transitions", () => {
  it("DRAFT → SUBMITTED is valid", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("SUBMITTED → APPROVED is valid", () => {
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.APPROVED)).toBe(true);
  });

  it("SUBMITTED → CONFLICTING is valid", () => {
    expect(validateOperationTransition(OperationStatus.SUBMITTED, OperationStatus.CONFLICTING)).toBe(true);
  });

  it("APPROVED → APPLIED is valid", () => {
    expect(validateOperationTransition(OperationStatus.APPROVED, OperationStatus.APPLIED)).toBe(true);
  });

  it("APPLIED → anything is invalid (terminal)", () => {
    expect(validateOperationTransition(OperationStatus.APPLIED, OperationStatus.CANCELLED)).toBe(false);
  });

  it("REJECTED → SUBMITTED is valid (resubmit)", () => {
    expect(validateOperationTransition(OperationStatus.REJECTED, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("CONFLICTING → SUBMITTED is valid (resubmit after fix)", () => {
    expect(validateOperationTransition(OperationStatus.CONFLICTING, OperationStatus.SUBMITTED)).toBe(true);
  });

  it("DRAFT → APPLIED is invalid", () => {
    expect(validateOperationTransition(OperationStatus.DRAFT, OperationStatus.APPLIED)).toBe(false);
  });
});

// ── PatchProposal ↔ Operation mapping ──────────────

describe("PatchProposal ↔ Operation mapping", () => {
  const sampleProposal: PatchProposal = {
    id: "pp1",
    sessionId: "s1",
    taskId: "t1",
    agentId: "a1",
    title: "Fix auth bug",
    summary: "Fixes the auth bypass",
    patchText: "diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new",
    touchedFiles: "src/auth.ts,src/utils.ts",
    relatedClaimIds: "c1,c2",
    status: PatchProposalStatus.SUBMITTED,
    checkResult: "",
    decisionSummary: "",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  it("converts PatchProposal to Operation(type=code_patch)", () => {
    const op = patchProposalToOperation(sampleProposal);
    expect(op.type).toBe("code_patch");
    expect(op.actorId).toBe("a1");
    expect(op.taskId).toBe("t1");
    expect(op.status).toBe(OperationStatus.SUBMITTED);
    expect(op.targetResources).toHaveLength(2);
    expect(op.targetResources[0].type).toBe("file");
    expect(op.targetResources[0].locator).toBe("src/auth.ts");
  });

  it("converts Operation back to PatchProposal", () => {
    const op = patchProposalToOperation(sampleProposal);
    const pp = operationToPatchProposal(op, sampleProposal.patchText, sampleProposal.relatedClaimIds);
    expect(pp.agentId).toBe(sampleProposal.agentId);
    expect(pp.taskId).toBe(sampleProposal.taskId);
    expect(pp.status).toBe(sampleProposal.status);
    expect(pp.touchedFiles).toBe("src/auth.ts,src/utils.ts");
  });

  it("maps all PatchProposalStatus values to OperationStatus", () => {
    for (const s of Object.values(PatchProposalStatus)) {
      const os = patchStatusToOperationStatus(s);
      expect(os).toBeDefined();
      expect(operationStatusToPatchStatus(os)).toBe(s);
    }
  });
});
