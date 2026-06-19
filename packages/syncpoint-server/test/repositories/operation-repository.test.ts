/**
 * Tests for operation repository — Operation CRUD and validation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { createOperation, getOperation, listOperations, submitOperation, runOperationChecks } from "../../src/application/_exports/review-operation-status.js";
import { OperationStatus } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repo-op-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agentId = repo.createAgent({ name: "op-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Op repo task" }).id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("operation repo", () => {
  let opId: string;

  it("creates an operation", () => {
    const op = createOperation({ actorId: agentId, taskId, title: "Refactor module", description: "Split large file" });
    expect(op.id).toBeTruthy();
    expect(op.title).toBe("Refactor module");
    expect(op.status).toBe(OperationStatus.DRAFT);
    opId = op.id;
  });

  it("gets operation by ID", () => {
    const op = getOperation(opId);
    expect(op.title).toBe("Refactor module");
  });

  it("submits operation for validation", () => {
    const op = submitOperation(opId);
    expect(op.status).toBe(OperationStatus.SUBMITTED);
  });

  it("runs operation checks", () => {
    const result = runOperationChecks(opId);
    expect(result.passed).toBeDefined();
  });

  it("lists operations", () => {
    const ops = listOperations({ actorId: agentId });
    expect(ops.length).toBeGreaterThanOrEqual(1);
  });
});
