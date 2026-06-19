/**
 * Tests for checkpoint repository — Checkpoint CRUD.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repo-cp-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agentId = repo.createAgent({ name: "cp-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "CP repo task" }).id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("checkpoint repo", () => {
  it("creates checkpoint", () => {
    const cp = repo.createCheckpoint({ taskId, agentId, summary: "First CP", progress: "10%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "Continue", needSync: false });
    expect(cp.id).toBeTruthy();
    expect(cp.summary).toBe("First CP");
    expect(cp.progress).toBe("10%");
  });

  it("creates checkpoint with all fields", () => {
    const cp = repo.createCheckpoint({ taskId, agentId, summary: "Full CP", progress: "50%", currentUnderstanding: "Architecture clear", changedResources: ["src/a.ts"], risks: "Flaky test", blockers: "Review pending", nextSteps: "Fix tests", needSync: true });
    expect(cp.needSync).toBe(true);
    expect(cp.risks).toBe("Flaky test");
  });

  it("lists checkpoints for task", () => {
    const cps = repo.listCheckpoints(taskId);
    expect(cps.length).toBeGreaterThanOrEqual(2);
  });

  it("gets checkpoint by ID", () => {
    const cp = repo.createCheckpoint({ taskId, agentId, summary: "Gettable", progress: "20%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "Go", needSync: false });
    const found = repo.getCheckpoint(cp.id);
    expect(found.summary).toBe("Gettable");
  });
});
