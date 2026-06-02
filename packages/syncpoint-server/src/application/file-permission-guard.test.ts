import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import { RelationshipMode, ResourceClaimMode, WriteIntent } from "syncpoint-core";
import { rcClaim } from "./resource-claim-service.js";
import { writePrepare, writeApply } from "./write-permit-service.js";
import { guardCreateSession, guardRevokeSession, __clearGuardSessionsForTest } from "./guard-session-service.js";
import { __clearFilePermissionGuardsForTest } from "./file-permission-guard.js";
import { __clearReconciliationStateForTest } from "./backing-store-reconciliation-service.js";
import { resetPathResolverCache } from "./path-resolver.js";

let tmpDir: string;
let agentA: string;
let taskA: string;
let sessionId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-guard-perm-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  resetPathResolverCache();
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  agentA = repo.createAgent({ name: "agent-a", provider: "cursor", role: "backend" }).id;
  taskA = repo.createTask({ title: "Task A", description: "" }).id;
  sessionId = repo.createSession({
    title: "Guard perm session",
    description: "",
    relationshipMode: RelationshipMode.PEER_CONTRACT,
    architectId: null,
    createdBy: agentA,
  }).id;

  __clearGuardSessionsForTest();
  __clearFilePermissionGuardsForTest();
  __clearReconciliationStateForTest();
});

afterEach(() => {
  __clearGuardSessionsForTest();
  __clearFilePermissionGuardsForTest();
  __clearReconciliationStateForTest();
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  resetPathResolverCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("file permission guard", () => {
  it("strict guard session makes claimed files read-only and blocks direct writes", () => {
    const locator = "src/guarded.js";
    const filePath = path.join(tmpDir, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "original");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    guardCreateSession({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      mode: "strict",
    });

    // File should now be read-only
    const stat = fs.statSync(filePath);
    const isReadOnly = (stat.mode & 0o200) === 0;
    expect(isReadOnly).toBe(true);

    // Direct write should fail with EACCES (or EPERM on some systems)
    expect(() => fs.writeFileSync(filePath, "direct write attempt")).toThrow();

    // File content should remain original
    expect(fs.readFileSync(filePath, "utf8")).toBe("original");
  });

  it("writeApply still succeeds through temporary unlock", () => {
    const locator = "src/writable.js";
    const filePath = path.join(tmpDir, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "original");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    guardCreateSession({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      mode: "strict",
    });

    // writeApply should succeed even though file is read-only
    const { permit } = writePrepare({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      intent: WriteIntent.MODIFY,
    });

    const result = writeApply({
      permitId: permit.id,
      mutations: [{ resource: { type: "file", scope: "file", locator, metadata: "" }, content: "modified via SyncPoint" }],
    });

    expect(result.applied).toHaveLength(1);
    expect(fs.readFileSync(filePath, "utf8")).toBe("modified via SyncPoint");

    // File should be re-locked after write
    const stat = fs.statSync(filePath);
    const isReadOnly = (stat.mode & 0o200) === 0;
    expect(isReadOnly).toBe(true);
  });

  it("revoking guard session restores file permissions", () => {
    const locator = "src/restored.js";
    const filePath = path.join(tmpDir, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "original");

    const originalStat = fs.statSync(filePath);
    const originalWritable = (originalStat.mode & 0o200) !== 0;
    expect(originalWritable).toBe(true);

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    const guardSession = guardCreateSession({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      mode: "strict",
    });

    // File is read-only
    expect((fs.statSync(filePath).mode & 0o200) === 0).toBe(true);

    // Revoke session
    guardRevokeSession(guardSession.id);

    // Permissions should be restored — file writable again
    const restoredStat = fs.statSync(filePath);
    const restoredWritable = (restoredStat.mode & 0o200) !== 0;
    expect(restoredWritable).toBe(true);

    // Direct write should now succeed
    fs.writeFileSync(filePath, "direct write after revoke");
    expect(fs.readFileSync(filePath, "utf8")).toBe("direct write after revoke");
  });

  it("observe mode does NOT lock files", () => {
    const locator = "src/observed.js";
    const filePath = path.join(tmpDir, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "original");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    guardCreateSession({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      mode: "observe",
    });

    // File should remain writable
    const stat = fs.statSync(filePath);
    expect((stat.mode & 0o200) !== 0).toBe(true);
    fs.writeFileSync(filePath, "direct write in observe mode");
    expect(fs.readFileSync(filePath, "utf8")).toBe("direct write in observe mode");
  });
});
