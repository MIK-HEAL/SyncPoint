/**
 * Integration tests for PatchProposal Service — patch lifecycle.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import {
  ppPropose, ppSubmit, ppCheck, ppApprove,
  ppReject, ppApply, ppCancel, ppStatus, ppList,
} from "./patch-proposal-service.js";
import { pmAdd, pmApprove } from "./project-memory-service.js";
import { fcClaimFiles } from "./file-claim-service.js";
import { orchCreateSession, orchAssignRole } from "./orchestration-service.js";
import { PatchProposalStatus, MemoryKind } from "syncpoint-core";

const SAMPLE_PATCH = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
+import { verify } from "jsonwebtoken";
 export function authenticate(token: string) {
   return token.length > 0;
 }`;

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let task1Id: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-pp-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const a1 = repo.createAgent({ name: "exec-a", provider: "codex", role: "backend" });
  const a2 = repo.createAgent({ name: "reviewer", provider: "cursor", role: "reviewer" });
  agent1Id = a1.id;
  agent2Id = a2.id;

  const t1 = repo.createTask({ title: "Auth module", description: "" });
  task1Id = t1.id;

  const sess = orchCreateSession({ title: "PP test session", createdBy: agent1Id });
  sessionId = sess.session.id;
  orchAssignRole({ sessionId, agentId: agent1Id, role: "executor" as any });
  orchAssignRole({ sessionId, agentId: agent2Id, role: "reviewer" as any });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("PatchProposal full lifecycle — happy path", () => {
  let patchId: string;

  it("proposes a draft patch and extracts files", () => {
    const result = ppPropose({
      sessionId,
      taskId: task1Id,
      agentId: agent1Id,
      title: "Add JWT verification",
      summary: "Adds jwt verify call",
      patchText: SAMPLE_PATCH,
    });

    expect(result.status).toBe(PatchProposalStatus.DRAFT);
    expect(result.touchedFiles).toContain("src/auth.ts");
    patchId = result.id;
  });

  it("submit triggers auto-check — CONFLICTING when no claims", () => {
    const result = ppSubmit(patchId);
    // No file claims → files_covered_by_claims fails → CONFLICTING
    expect(result.proposal.status).toBe(PatchProposalStatus.CONFLICTING);
    expect(result.checkResult).toBeTruthy();
    expect(result.checkResult!.allPassed).toBe(false);
  });

  it("after claiming files, resubmit passes checks", () => {
    fcClaimFiles({
      agentId: agent1Id,
      taskId: task1Id,
      sessionId,
      paths: "src/**",
      mode: "exclusive",
    });

    // Resubmit (CONFLICTING → SUBMITTED)
    const result = ppSubmit(patchId);
    expect(result.proposal.status).toBe(PatchProposalStatus.SUBMITTED);
    expect(result.checkResult!.allPassed).toBe(true);
  });

  it("approve moves to APPROVED", () => {
    const result = ppApprove(patchId, agent2Id, "LGTM");
    expect(result.status).toBe(PatchProposalStatus.APPROVED);
    expect(result.decisionSummary).toContain("LGTM");
  });

  it("apply moves to APPLIED (terminal)", () => {
    const result = ppApply(patchId);
    expect(result.status).toBe(PatchProposalStatus.APPLIED);
  });

  it("cannot apply again (terminal)", () => {
    expect(() => ppApply(patchId)).toThrow(/Cannot apply/);
  });
});

describe("PatchProposal rejection + resubmit", () => {
  let patchId: string;

  it("propose + submit", () => {
    const p = ppPropose({
      sessionId, taskId: task1Id, agentId: agent1Id,
      title: "Fix bug", patchText: SAMPLE_PATCH,
    });
    patchId = p.id;
    ppSubmit(patchId); // passes since agent1 already has claims
  });

  it("reject", () => {
    const result = ppReject(patchId, agent2Id, "Needs refactor");
    expect(result.status).toBe(PatchProposalStatus.REJECTED);
  });

  it("resubmit after rejection", () => {
    const result = ppSubmit(patchId);
    expect(result.proposal.status).toBe(PatchProposalStatus.SUBMITTED);
  });

  it("approve after resubmit", () => {
    const result = ppApprove(patchId, agent2Id);
    expect(result.status).toBe(PatchProposalStatus.APPROVED);
  });
});

describe("PatchProposal cancellation", () => {
  it("cancel from draft", () => {
    const p = ppPropose({
      sessionId, taskId: task1Id, agentId: agent1Id,
      title: "Cancelled patch", patchText: SAMPLE_PATCH,
    });
    const result = ppCancel(p.id, "No longer needed");
    expect(result.status).toBe(PatchProposalStatus.CANCELLED);
  });
});

describe("PatchProposal conflict detection", () => {
  it("detects conflict when other agent has exclusive claim", () => {
    // agent2 claims the same files exclusively
    const task2 = repo.createTask({ title: "Conflict task", description: "" });
    fcClaimFiles({
      agentId: agent2Id,
      taskId: task2.id,
      sessionId,
      paths: "src/auth.ts",
      mode: "exclusive",
      autoGate: false,
    });

    const p = ppPropose({
      sessionId, taskId: task1Id, agentId: agent1Id,
      title: "Conflicting patch", patchText: SAMPLE_PATCH,
    });
    const result = ppCheck(p.id);
    expect(result.checkResult!.allPassed).toBe(false);
    expect(result.checkResult!.conflictingClaims.length).toBeGreaterThan(0);
  });
});

describe("PatchProposal listing and status", () => {
  it("ppList returns all proposals", () => {
    const all = ppList();
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it("ppList filters by agent", () => {
    const filtered = ppList({ agentId: agent1Id });
    expect(filtered.length).toBeGreaterThanOrEqual(4);
    expect(filtered.every(p => p.agentId === agent1Id)).toBe(true);
  });

  it("ppStatus returns parsed check result", () => {
    const all = ppList();
    const result = ppStatus(all[0].id);
    expect(result.proposal).toBeTruthy();
  });
});

// ── P4B: Constraint Runtime enforcement ──────────────

describe("P4B: Constraint Runtime enforcement in ppCheck/ppSubmit", () => {
  it("patch touching do_not_touch protected file becomes CONFLICTING", () => {
    // Seed: create an approved do_not_touch memory for src/auth/
    const mem = pmAdd({
      category: "gotcha" as any,
      title: "Auth core protected",
      content: "Do not touch authentication core",
      createdBy: "architect",
      kind: MemoryKind.DO_NOT_TOUCH,
      appliesTo: { files: ["src/auth"] },
      global: true,
    } as any);
    pmApprove(mem.id, "architect");

    // Propose a patch that touches the protected file
    const proposal = ppPropose({
      sessionId,
      taskId: task1Id,
      agentId: agent1Id,
      title: "Modify auth core",
      patchText: SAMPLE_PATCH, // touches src/auth.ts
    });

    // Submit — should become CONFLICTING due to constraint violation
    const result = ppSubmit(proposal.id);
    expect(result.proposal.status).toBe(PatchProposalStatus.CONFLICTING);
    expect(result.checkResult!.constraintViolations).toBeDefined();
    expect(result.checkResult!.constraintViolations!.length).toBeGreaterThan(0);
    expect(result.checkResult!.constraintViolations![0].rule).toBe("do_not_touch_file_overlap");
    expect(result.checkResult!.constraintViolations![0].evidence).toContain("src/auth.ts");
  });

  it("ppCheck includes constraint violation check items", () => {
    const proposal = ppPropose({
      sessionId,
      taskId: task1Id,
      agentId: agent1Id,
      title: "Another auth change",
      patchText: SAMPLE_PATCH,
    });

    const result = ppCheck(proposal.id);
    const constraintItems = result.checkResult!.items.filter(
      i => i.check.startsWith("constraint:"),
    );
    expect(constraintItems.length).toBeGreaterThan(0);
    expect(constraintItems[0].passed).toBe(false);
    expect(constraintItems[0].check).toBe("constraint:do_not_touch_file_overlap");
  });

  it("patch NOT touching protected scope passes constraint checks", () => {
    const safePatch = `diff --git a/src/ui/button.tsx b/src/ui/button.tsx
--- a/src/ui/button.tsx
+++ b/src/ui/button.tsx
@@ -1,3 +1,4 @@
+import React from "react";
 export function Button() {
   return <button>Click</button>;
 }`;

    const proposal = ppPropose({
      sessionId,
      taskId: task1Id,
      agentId: agent1Id,
      title: "Safe UI change",
      patchText: safePatch,
    });

    const result = ppCheck(proposal.id);
    const constraintItems = result.checkResult!.items.filter(
      i => i.check.startsWith("constraint:"),
    );
    // No constraint violations for files outside protected scope
    expect(constraintItems).toHaveLength(0);
    expect(result.checkResult!.constraintViolations ?? []).toHaveLength(0);
  });

  it("constraint violation includes sourceMemoryId and projectionId", () => {
    const proposal = ppPropose({
      sessionId,
      taskId: task1Id,
      agentId: agent1Id,
      title: "Check traceability",
      patchText: SAMPLE_PATCH,
    });

    const result = ppCheck(proposal.id);
    const violations = result.checkResult!.constraintViolations!;
    expect(violations[0].sourceMemoryId).toBeTruthy();
    expect(violations[0].projectionId).toBeTruthy();
    expect(violations[0].message).toContain("src/auth.ts");
  });
});
