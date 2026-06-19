/**
 * Tests for loop router — Loop resume, checkpoint, handoff.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { loopResume, loopCheckpoint } from "../../src/application/_exports/review-operation-status.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-loop-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agentId = repo.createAgent({ name: "loop-rtr-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Loop router task" }).id;
  // Seed snapshot for resume
  const cp = repo.createCheckpoint({ taskId, agentId, summary: "Start", progress: "0%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "Start work", needSync: false });
  repo.createContextSnapshot({ taskId, agentId, checkpointId: cp.id, summary: "Seed", payload: { goal: "Test", currentPhase: "dev", confirmedDecisions: [], interfaceContract: "", workingResources: ["src/test.ts"], completedWork: "", remainingWork: "Add tests", risks: [], blockers: [], nextSteps: ["Run"], resumePrompt: "" } });
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loop router — resume", () => {
  it("resumes with system-prompt format", () => {
    const result = loopResume({ agentId, taskId, format: "system-prompt" });
    expect(result.ready).toBeDefined();
    expect(result.prompt).toBeTruthy();
  });

  it("resume returns task info", () => {
    const result = loopResume({ agentId, taskId, format: "system-prompt" });
    expect(result.task.title).toBe("Loop router task");
    expect(result.agent.name).toBe("loop-rtr-agent");
  });
});

describe("loop router — checkpoint", () => {
  it("creates checkpoint", () => {
    const result = loopCheckpoint({ agentId, taskId, summary: "Router test checkpoint", progress: "30%" });
    expect(result.ok).toBe(true);
    expect(result.checkpointId).toBeTruthy();
  });
});
