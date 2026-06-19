import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {  } from "../../src/db.js";
import * as repo from "../../src/repositories/index.js";
import { RelationshipMode } from "syncpoint-adapters";
import { ResourceClaimMode, SyncGateReason, WriteIntent } from "syncpoint-kernel";
import { rcClaim } from "../../src/application/resource-claim-service.js";
import { writePrepare, writeApply } from "../../src/application/write-permit-service.js";
import { reconcileBackingStore, __clearReconciliationStateForTest } from "../../src/application/backing-store-reconciliation-service.js";
import { resetPathResolverCache } from "../../src/application/path-resolver.js";

let tmpDir: string;
let agentA: string;
let taskA: string;
let sessionId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-reconcile-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  resetPathResolverCache();
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  defaultContext.db;

  agentA = repo.createAgent({ name: "agent-a", provider: "cursor", role: "backend" }).id;
  taskA = repo.createTask({ title: "Task A", description: "" }).id;
  sessionId = repo.createSession({
    title: "Reconcile session",
    description: "",
    relationshipMode: RelationshipMode.PEER_CONTRACT,
    architectId: null,
    createdBy: agentA,
  }).id;

  __clearReconciliationStateForTest();
});

afterEach(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  delete process.env.SYNCPOINT_PROJECT_ROOT;
  resetPathResolverCache();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __clearReconciliationStateForTest();
});

describe("backing store reconciliation", () => {
  it("does not raise a gate when file is written through writeApply", () => {
    const locator = "src/reconciled.js";
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

    // First reconcile to establish baseline
    reconcileBackingStore({ taskId: taskA, sessionId });

    // Write through SyncPoint (authorized)
    const { permit } = writePrepare({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      intent: WriteIntent.MODIFY,
    });
    writeApply({ permitId: permit.id, mutations: [{ resource: { type: "file", scope: "file", locator, metadata: "" }, content: "modified" }] });

    // Reconcile — should see no bypass
    const result = reconcileBackingStore({ taskId: taskA, sessionId });
    expect(result.bypassesDetected).toBe(0);
    expect(result.gatesCreated).toHaveLength(0);
  });

  it("raises a BACKING_STORE_BYPASS gate when file is directly written", () => {
    const locator = "src/bypassed.js";
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

    // First reconcile to establish baseline
    reconcileBackingStore({ taskId: taskA, sessionId });

    // Direct write (bypassing SyncPoint)
    fs.writeFileSync(filePath, "sneaky change");

    // Reconcile — should detect bypass and create gate
    const result = reconcileBackingStore({ taskId: taskA, sessionId });
    expect(result.bypassesDetected).toBe(1);
    expect(result.gatesCreated).toHaveLength(1);

    const gates = repo.listActiveSyncGates({ taskId: taskA, sessionId });
    expect(gates).toHaveLength(1);
    expect(gates[0]!.reason).toBe(SyncGateReason.BACKING_STORE_BYPASS);
    expect(gates[0]!.description).toContain("bypassed.js");
    expect(gates[0]!.description).toContain("outside SyncPoint");
  });

  it("reuses an existing bypass gate for repeated direct writes", () => {
    const locator = "src/repeated.js";
    const filePath = path.join(tmpDir, locator);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "v1");

    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", scope: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    reconcileBackingStore({ taskId: taskA, sessionId });

    fs.writeFileSync(filePath, "v2-bypass");
    const first = reconcileBackingStore({ taskId: taskA, sessionId });
    expect(first.gatesCreated).toHaveLength(1);

    fs.writeFileSync(filePath, "v3-bypass-again");
    const second = reconcileBackingStore({ taskId: taskA, sessionId });
    expect(second.bypassesDetected).toBe(1);
    expect(second.gatesReused).toHaveLength(1);
    expect(second.gatesReused[0]).toBe(first.gatesCreated[0]);
    expect(second.gatesCreated).toHaveLength(0);

    // Only one gate total
    const gates = repo.listActiveSyncGates({ taskId: taskA, sessionId });
    expect(gates).toHaveLength(1);
  });
});
