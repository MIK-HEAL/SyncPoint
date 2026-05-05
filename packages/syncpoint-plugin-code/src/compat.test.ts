import { describe, it, expect } from "vitest";
import {
  fileClaimToResourceClaim,
  patchProposalToOperation,
  operationToPatchProposal,
  patchStatusToOperationStatus,
  operationStatusToPatchStatus,
} from "./compat.js";
import {
  FileClaimStatus,
  FileClaimMode,
  ResourceClaimStatus,
  ResourceClaimMode,
  PatchProposalStatus,
  OperationStatus,
} from "syncpoint-core";
import type { FileClaim, PatchProposal, Operation } from "syncpoint-core";

describe("fileClaimToResourceClaim", () => {
  it("converts FileClaim to ResourceClaim", () => {
    const fc: FileClaim = {
      id: "fc1", agentId: "a1", taskId: "t1", sessionId: "s1",
      paths: "src/auth.ts, src/login.ts",
      mode: FileClaimMode.EXCLUSIVE, status: FileClaimStatus.ACTIVE,
      createdAt: "2024-01-01", releasedAt: "",
    };
    const rc = fileClaimToResourceClaim(fc);
    expect(rc.id).toBe("fc1");
    expect(rc.actorId).toBe("a1");
    expect(rc.resources).toHaveLength(2);
    expect(rc.resources[0].type).toBe("file");
    expect(rc.resources[0].locator).toBe("src/auth.ts");
    expect(rc.mode).toBe(ResourceClaimMode.EXCLUSIVE);
    expect(rc.status).toBe(ResourceClaimStatus.ACTIVE);
  });
});

describe("patchProposalToOperation", () => {
  it("converts PatchProposal to Operation(type=code_patch)", () => {
    const pp: PatchProposal = {
      id: "pp1", sessionId: "s1", taskId: "t1", agentId: "a1",
      title: "fix bug", summary: "summary", patchText: "diff...",
      touchedFiles: "src/auth.ts,src/login.ts",
      relatedClaimIds: "c1", status: PatchProposalStatus.SUBMITTED,
      checkResult: "", decisionSummary: "",
      createdAt: "2024-01-01", updatedAt: "2024-01-01",
    };
    const op = patchProposalToOperation(pp);
    expect(op.type).toBe("code_patch");
    expect(op.actorId).toBe("a1");
    expect(op.targetResources).toHaveLength(2);
    expect(op.status).toBe(OperationStatus.SUBMITTED);
  });
});

describe("operationToPatchProposal", () => {
  it("converts Operation back to PatchProposal shape", () => {
    const op: Operation = {
      id: "op1", type: "code_patch", actorId: "a1", taskId: "t1",
      sessionId: "s1", title: "fix", summary: "",
      targetResources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      payloadRef: "", status: OperationStatus.APPROVED,
      checkResult: "", decisionSummary: "",
      createdAt: "2024-01-01", updatedAt: "2024-01-01",
    };
    const pp = operationToPatchProposal(op, "patch text", "c1");
    expect(pp.agentId).toBe("a1");
    expect(pp.patchText).toBe("patch text");
    expect(pp.touchedFiles).toBe("src/auth.ts");
    expect(pp.status).toBe(PatchProposalStatus.APPROVED);
  });
});

describe("status mapping", () => {
  it("round-trips patch status", () => {
    for (const s of Object.values(PatchProposalStatus)) {
      const op = patchStatusToOperationStatus(s);
      const back = operationStatusToPatchStatus(op);
      expect(back).toBe(s);
    }
  });
});
