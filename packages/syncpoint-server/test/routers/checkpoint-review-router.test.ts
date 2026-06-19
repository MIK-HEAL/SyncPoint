/**
 * Tests for checkpoint-review router.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { rwAddChecklistItem, rwUpdateChecklistItem, rwEvaluateGate } from "../../src/application/_exports/review-operation-status.js";
import { ChecklistItemStatus, ApprovalGateStatus } from "syncpoint-governance";

let tmpDir: string;
let agentId: string;
let taskId: string;
let reviewRequestId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-cr-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agentId = repo.createAgent({ name: "cr-agent", provider: "cursor", role: "reviewer" }).id;
  taskId = repo.createTask({ title: "CR router task" }).id;
  const s = repo.createSession({ title: "CR Session" });
  repo.assignRole(s.id, agentId, "executor", "");
  repo.assignTask(taskId, agentId);
  reviewRequestId = repo.requestReview(s.id, taskId, agentId, agentId, "full").id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkpoint-review router", () => {
  it("adds checklist item", () => {
    const item = rwAddChecklistItem({ reviewRequestId, title: "Tests pass", required: true });
    expect(item.status).toBe(ChecklistItemStatus.OPEN);
  });

  it("updates checklist to PASSED", () => {
    const item = rwAddChecklistItem({ reviewRequestId, title: "Build OK", required: true });
    const updated = rwUpdateChecklistItem(item.id, { status: ChecklistItemStatus.PASSED });
    expect(updated.status).toBe(ChecklistItemStatus.PASSED);
  });

  it("evaluates gate", () => {
    const result = rwEvaluateGate(reviewRequestId);
    expect(result.status).toBeDefined();
    expect(result.checklistTotal).toBeGreaterThanOrEqual(1);
  });
});
