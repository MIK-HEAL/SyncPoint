import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelationshipMode } from "syncpoint-adapters";
import { ResourceClaimMode, SyncGateStatus, WriteDecisionReason, WriteIntent } from "syncpoint-kernel";
import { closeDb, getDb } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import { ensureApplicationBootstrap } from "./bootstrap.js";
import { __clearReconciliationStateForTest } from "./backing-store-reconciliation-service.js";
import { __clearFilePermissionGuardsForTest } from "./file-permission-guard.js";
import { __clearGuardSessionsForTest, guardCreateSession, guardRevokeSession, guardStatus } from "./guard-session-service.js";
import { rcClaim, rcDetectConflicts, rcList, rcRelease } from "./resource-claim-service.js";
import { sgStatus } from "./sync-gate-service.js";
import { writePrepare } from "./write-permit-service.js";
import { resetPathResolverCache } from "./path-resolver.js";

let tmpDir: string;
let agentA: string;
let agentB: string;
let taskA: string;
let taskB: string;
let sessionA: string;
let sessionB: string;

function fileResource(locator: string) {
  return { type: "file", locator, metadata: "", scope: "file" as const };
}

function imageResource(locator: string) {
  return { type: "image", locator, metadata: "", scope: "file" as const };
}

function seedFile(locator: string, content = "original") {
  const filePath = path.join(tmpDir, locator);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  resetPathResolverCache();
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  ensureApplicationBootstrap();
  getDb();

  __clearGuardSessionsForTest();
  __clearFilePermissionGuardsForTest();
  __clearReconciliationStateForTest();

  agentA = repo.createAgent({ name: "agent-a", provider: "cursor", role: "backend" }).id;
  agentB = repo.createAgent({ name: "agent-b", provider: "cursor", role: "backend" }).id;
  taskA = repo.createTask({ title: "Task A", description: "" }).id;
  taskB = repo.createTask({ title: "Task B", description: "" }).id;
  sessionA = repo.createSession({
    title: "Session A",
    description: "",
    relationshipMode: RelationshipMode.PEER_CONTRACT,
    architectId: null,
    createdBy: agentA,
  }).id;
  sessionB = repo.createSession({
    title: "Session B",
    description: "",
    relationshipMode: RelationshipMode.PEER_CONTRACT,
    architectId: null,
    createdBy: agentA,
  }).id;
});

afterEach(() => {
  for (const session of guardStatus().activeSessions) {
    guardRevokeSession(session.id);
  }
  __clearGuardSessionsForTest();
  __clearFilePermissionGuardsForTest();
  __clearReconciliationStateForTest();
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  resetPathResolverCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resource claim service", () => {
  it("lists claims by actor, session, resource type, and status", () => {
    const fileClaim = rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });
    const imageClaim = rcClaim({
      actorId: agentA,
      taskId: taskB,
      sessionId: sessionB,
      resources: [imageResource("assets/logo.png")],
      mode: ResourceClaimMode.SHARED,
      autoGate: false,
    });

    rcRelease(imageClaim.claim.id);

    expect(rcList({ actorId: agentA }).map(claim => claim.id)).toEqual(
      expect.arrayContaining([fileClaim.claim.id, imageClaim.claim.id]),
    );
    expect(rcList({ sessionId: sessionA }).map(claim => claim.id)).toEqual([fileClaim.claim.id]);
    expect(rcList({ resourceType: "image" }).map(claim => claim.id)).toEqual([imageClaim.claim.id]);
    expect(rcList({ status: "ACTIVE" }).map(claim => claim.id)).toEqual([fileClaim.claim.id]);
    expect(rcList({ status: "RELEASED" }).map(claim => claim.id)).toEqual([imageClaim.claim.id]);
  });

  it("detects prefix-overlap file conflicts and auto-creates a sync gate", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    const result = rcClaim({
      actorId: agentB,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.isHardConflict).toBe(true);
    expect(result.conflicts[0]!.overlappingLocator).toContain("src");
    expect(result.gateId).toBeTruthy();
    expect(sgStatus(result.gateId!).gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
  });

  it("ignores duplicate overlapping claims from the same actor on the same task", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/**")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    const result = rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    expect(result.conflicts).toHaveLength(0);
    expect(result.gateId).toBeUndefined();
    expect(rcDetectConflicts({ sessionId: sessionA, resourceType: "file" })).toHaveLength(0);
  });

  it("returns soft conflicts for shared claims without creating a sync gate", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.SHARED,
      autoGate: false,
    });

    const result = rcClaim({
      actorId: agentB,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.SHARED,
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]!.isHardConflict).toBe(false);
    expect(result.gateId).toBeUndefined();
  });

  it("scopes conflict checks by session during claim creation", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    const result = rcClaim({
      actorId: agentB,
      taskId: taskA,
      sessionId: sessionB,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    expect(result.conflicts).toHaveLength(0);
    expect(result.gateId).toBeUndefined();
    expect(rcDetectConflicts({ sessionId: sessionA, resourceType: "file" })).toHaveLength(0);
    expect(rcDetectConflicts({ sessionId: sessionB, resourceType: "file" })).toHaveLength(0);
  });

  it("reconciles resource conflict gates when a conflicting claim is released", () => {
    const first = rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });
    const second = rcClaim({
      actorId: agentB,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    expect(second.gateId).toBeTruthy();
    expect(rcDetectConflicts({ sessionId: sessionA, resourceType: "file" })).toHaveLength(1);

    const released = rcRelease(first.claim.id);

    expect(released.status).toBe("RELEASED");
    expect(rcDetectConflicts({ sessionId: sessionA, resourceType: "file" })).toHaveLength(0);
    expect(sgStatus(second.gateId!).gate.status).toBe(SyncGateStatus.READY_TO_CONTINUE);
  });

  it("drives write-permit authorization from active claims", () => {
    seedFile("src/auth.js");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    const ownerDecision = writePrepare({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      intent: WriteIntent.MODIFY,
    });
    const otherDecision = writePrepare({
      actorId: agentB,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/auth.js")],
      intent: WriteIntent.MODIFY,
    });

    expect(ownerDecision.decision.permitted).toBe(true);
    expect(ownerDecision.decision.reason).toBe(WriteDecisionReason.OWNED_CLAIM);
    expect(otherDecision.decision.permitted).toBe(false);
    expect(otherDecision.decision.blockers.map(blocker => blocker.type)).toContain("resource_claim");
  });

  it("supplies claimed files to strict guard sessions", () => {
    const filePath = seedFile("src/guarded.js");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      resources: [fileResource("src/guarded.js")],
      mode: ResourceClaimMode.EXCLUSIVE,
      autoGate: false,
    });

    const guardSession = guardCreateSession({
      actorId: agentA,
      taskId: taskA,
      sessionId: sessionA,
      mode: "strict",
    });

    expect((fs.statSync(filePath).mode & 0o200) === 0).toBe(true);

    guardRevokeSession(guardSession.id);
  });
});
