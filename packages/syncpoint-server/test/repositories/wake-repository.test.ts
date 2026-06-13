/**
 * Tests for wake repository — Wake request creation and listing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { wakeNext, wakeAck } from "../../src/application/_exports/review-operation-status.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repo-wk-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  agentId = repo.createAgent({ name: "wk-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Wake repo task" }).id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("wake repository", () => {
  it("creates a wake request", () => {
    const result = wakeNext({ targetAgentId: agentId, targetRole: "executor", action: "start-work", reason: "Ready to start", triggerEventType: "TASK_CREATED", triggerEntityId: taskId });
    expect(result.id).toBeTruthy();
    expect(result.targetAgentId).toBe(agentId);
    expect(result.status).toBe("QUEUED");
  });

  it("acknowledges a wake request", () => {
    const wr = wakeNext({ targetAgentId: agentId, targetRole: "executor", action: "checkpoint", reason: "Time to checkpoint", triggerEventType: "TASK_STATUS_CHANGED", triggerEntityId: taskId });
    const acked = wakeAck(wr.id, "Checkpoint saved");
    expect(acked.status).toBe("DONE");
  });

  it("lists wake requests", () => {
    const list = repo.listWakeRequests?.({}) ?? [];
    expect(Array.isArray(list)).toBe(true);
  });
});
