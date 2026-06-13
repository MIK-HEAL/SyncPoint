/**
 * CLI loop command tests — Loop resume, checkpoint, handoff operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { loopResume, loopCheckpoint, loopHandoff } from "syncpoint-server/application";

let tmpDir: string;
let agentId: string;
let taskId: string;
let agent2Id: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-loop-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a = repo.createAgent({ name: "loop-agent", provider: "cursor", role: "frontend" });
  agentId = a.id;
  const a2 = repo.createAgent({ name: "loop-agent-2", provider: "claude-code", role: "backend" });
  agent2Id = a2.id;
  const t = repo.createTask({ title: "Loop test task", description: "Task for loop tests" });
  taskId = t.id;
  // Create initial snapshot needed for resume
  repo.createContextSnapshot({
    taskId,
    agentId,
    checkpointId: repo.createCheckpoint({
      taskId, agentId,
      summary: "Initial state",
      progress: "0%",
      currentUnderstanding: "",
      changedResources: [],
      risks: "", blockers: "",
      nextSteps: "Start work",
      needSync: false,
    }).id,
    summary: "Loop test snapshot",
    payload: {
      goal: "Implement loop handler",
      currentPhase: "development",
      confirmedDecisions: [],
      interfaceContract: "",
      workingResources: ["src/loop.ts"],
      completedWork: "",
      remainingWork: "Add loop resume logic",
      risks: [],
      blockers: [],
      nextSteps: ["Implement resume"],
      resumePrompt: "",
    },
  });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("loop resume", () => {
  it("resumes task with default format", () => {
    const result = loopResume({
      agentId,
      taskId,
      format: "system-prompt",
    });
    expect(result.ready).toBeDefined();
    expect(result.prompt).toBeTruthy();
    expect(result.prompt).toContain("Implement loop handler");
  });

  it("resume returns task and agent info", () => {
    const result = loopResume({ agentId, taskId, format: "system-prompt" });
    expect(result.task.title).toBe("Loop test task");
    expect(result.agent.name).toBe("loop-agent");
  });

  it("returns warnings when blocked", () => {
    // Without proper setup (session, contracts), may produce warnings
    const result = loopResume({ agentId, taskId, format: "system-prompt" });
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});

describe("loop checkpoint", () => {
  it("creates a checkpoint with snapshot", () => {
    const result = loopCheckpoint({
      agentId,
      taskId,
      summary: "Loop logic implemented",
      progress: "50%",
      goal: "Implement loop handler",
      phase: "development",
      completedWork: "Resume logic done",
      remainingWork: "Checkpoint logic",
      nextSteps: "Add tests",
      workingResources: ["src/loop.ts"],
    });
    expect(result.ok).toBe(true);
    expect(result.checkpointId).toBeTruthy();
    expect(result.snapshotId).toBeTruthy();
  });

  it("checkpoint preserves structured fields", () => {
    const result = loopCheckpoint({
      agentId,
      taskId,
      summary: "Structured checkpoint",
      progress: "75%",
      goal: "Complete loop",
      phase: "testing",
      nextSteps: "Run CI",
      risks: "Flaky test",
      blockers: "Review pending",
    });
    expect(result.ok).toBe(true);
    // Verify snapshot was created
    const snapshot = repo.getLatestContextSnapshot(taskId, agentId);
    expect(snapshot).toBeDefined();
  });
});

describe("loop handoff", () => {
  it("creates a handoff between agents", () => {
    const result = loopHandoff({
      fromAgentId: agentId,
      toAgentId: agent2Id,
      taskId,
      summary: "Handoff: implement loop handler",
      progress: "60%",
      goal: "Implement loop handler",
      phase: "development",
      completedWork: "Resume done",
      remainingWork: "Checkpoint + handoff logic",
      workingResources: ["src/loop.ts"],
      risks: "None",
    });
    expect(result.ok).toBe(true);
    expect(result.handoffId).toBeTruthy();
  });

  it("handoff references both agents", () => {
    const result = loopHandoff({
      fromAgentId: agentId,
      toAgentId: agent2Id,
      taskId,
      summary: "Second handoff",
      progress: "80%",
    });
    expect(result.ok).toBe(true);
    // Verify handoff exists
    const handoffs = repo.listPendingHandoffs();
    expect(handoffs.some((h: any) => h.fromAgentId === agentId)).toBe(true);
  });
});
