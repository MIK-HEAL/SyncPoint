import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import { EventType, RelationshipMode, ResourceClaimMode, SyncGateReason } from "syncpoint-core";
import { rcClaim } from "./resource-claim-service.js";
import { sgRequest } from "./sync-gate-service.js";
import { auditFileChange } from "./file-audit-service.js";

let tmpDir: string;
let agentA: string;
let agentB: string;
let taskA: string;
let taskB: string;
let sessionId: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-file-audit-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  agentA = repo.createAgent({ name: "agent-a", provider: "cursor", role: "backend" }).id;
  agentB = repo.createAgent({ name: "agent-b", provider: "claude-code", role: "backend" }).id;
  taskA = repo.createTask({ title: "Task A", description: "" }).id;
  taskB = repo.createTask({ title: "Task B", description: "" }).id;
  sessionId = repo.createSession({
    title: "Audit session",
    description: "",
    relationshipMode: RelationshipMode.MANAGER_DELEGATE,
    architectId: null,
    createdBy: agentA,
  }).id;
});

afterEach(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("auditFileChange", () => {
  it("logs FILE_CHANGED and does not create a gate for unclaimed files", () => {
    const result = auditFileChange({
      actorId: agentB,
      taskId: taskB,
      sessionId,
      locator: "src/unclaimed.ts",
    });

    expect(result.eventType).toBe(EventType.FILE_CHANGED);
    expect(result.gateId).toBeUndefined();
    expect(repo.listActiveSyncGates({ taskId: taskB, sessionId })).toHaveLength(0);
    expect(repo.listEvents(5)[0].eventType).toBe(EventType.FILE_CHANGED);
  });

  it("creates a resource conflict gate and logs pollution for another agent's exclusive file claim", () => {
    const claimResult = rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    const result = auditFileChange({
      actorId: agentB,
      taskId: taskB,
      sessionId,
      locator: "src/auth.ts",
    });

    expect(result.eventType).toBe(EventType.FILE_POLLUTION_DETECTED);
    expect(result.gateId).toBeTruthy();
    expect(result.reusedGate).toBe(false);

    const gates = repo.listActiveSyncGates({ taskId: taskB, sessionId });
    expect(gates).toHaveLength(1);
    expect(gates[0].reason).toBe(SyncGateReason.RESOURCE_CONFLICT);
    expect(gates[0].relatedClaimIds).toEqual([claimResult.claim.id]);
    expect([...gates[0].requiredAgentIds].sort()).toEqual([agentA, agentB].sort());

    const latestEvent = repo.listEvents(5)[0];
    expect(latestEvent.eventType).toBe(EventType.FILE_POLLUTION_DETECTED);
    expect(latestEvent.entityType).toBe("file_audit");
  });

  it("logs pollution but does not create a gate in audit-only mode", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    const result = auditFileChange({
      actorId: agentB,
      taskId: taskB,
      sessionId,
      locator: "src/auth.ts",
      auditOnly: true,
    });

    expect(result.eventType).toBe(EventType.FILE_POLLUTION_DETECTED);
    expect(result.gateId).toBeUndefined();
    expect(repo.listActiveSyncGates({ taskId: taskB, sessionId })).toHaveLength(0);
  });

  it("does not update an existing blocking gate description in audit-only alert mode", () => {
    const gate = sgRequest({
      sessionId,
      taskId: taskB,
      requestedByAgentId: agentA,
      requiredAgentIds: [agentB],
      reason: SyncGateReason.RESOURCE_CONFLICT,
      description: "Initial blocking gate",
      relatedFiles: ["src/auth.ts"],
    }).gate;

    const result = auditFileChange({
      actorId: agentB,
      taskId: taskB,
      sessionId,
      locator: "src/auth.ts",
      auditOnly: true,
    });

    expect(result.eventType).toBe(EventType.FILE_AUDIT_ALERT);
    expect(result.gateId).toBeUndefined();
    expect(repo.getSyncGate(gate.id).description).toBe("Initial blocking gate");
  });

  it("reuses an existing pollution gate for repeated changes", () => {
    rcClaim({
      actorId: agentA,
      taskId: taskA,
      sessionId,
      resources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    const first = auditFileChange({ actorId: agentB, taskId: taskB, sessionId, locator: "src/auth.ts" });
    const second = auditFileChange({ actorId: agentB, taskId: taskB, sessionId, locator: "src/auth.ts" });

    expect(second.gateId).toBe(first.gateId);
    expect(second.reusedGate).toBe(true);
    expect(repo.listActiveSyncGates({ taskId: taskB, sessionId })).toHaveLength(1);
  });
});
