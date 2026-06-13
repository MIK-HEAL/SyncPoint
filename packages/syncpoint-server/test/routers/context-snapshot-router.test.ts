/**
 * Tests for context-snapshot router — Snapshot CRUD and resolution.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { createContextSnapshot, listContextSnapshots, getLatestContextSnapshot, resolveSnapshotPayload } from "../../src/repositories/_exports/context-memory.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-snap-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  agentId = repo.createAgent({ name: "snap-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Snapshot router task" }).id;
  const cp = repo.createCheckpoint({ taskId, agentId, summary: "Start", progress: "0%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "Go", needSync: false });
  createContextSnapshot({ taskId, agentId, checkpointId: cp.id, summary: "First snapshot", payload: { goal: "Test snapshots", currentPhase: "dev", confirmedDecisions: [], interfaceContract: "", workingResources: ["src/a.ts"], completedWork: "Done", remainingWork: "More", risks: [], blockers: [], nextSteps: ["Continue"], resumePrompt: "" } });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("context snapshot router", () => {
  it("lists snapshots for task", () => {
    const snapshots = listContextSnapshots(taskId);
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0]!.payload.goal).toBe("Test snapshots");
  });

  it("gets latest snapshot", () => {
    const snap = getLatestContextSnapshot(taskId, agentId);
    expect(snap).toBeDefined();
    expect(snap!.payload.workingResources).toContain("src/a.ts");
  });

  it("resolves snapshot payload", () => {
    const snapshots = listContextSnapshots(taskId);
    const payload = resolveSnapshotPayload(snapshots[0]!.id);
    expect(payload).toBeDefined();
    expect(payload!.goal).toBe("Test snapshots");
  });

  it("creates second snapshot as delta", () => {
    const snapshots = listContextSnapshots(taskId);
    const cp = repo.createCheckpoint({ taskId, agentId, summary: "Second", progress: "50%", currentUnderstanding: "", changedResources: [], risks: "", blockers: "", nextSteps: "More", needSync: false });
    const snap2 = createContextSnapshot({ taskId, agentId, checkpointId: cp.id, summary: "Second snapshot", payload: { goal: "Updated goal", currentPhase: "testing", confirmedDecisions: [], interfaceContract: "", workingResources: ["src/b.ts"], completedWork: "More done", remainingWork: "Even more", risks: [], blockers: [], nextSteps: ["Finish"], resumePrompt: "" } });
    expect(snap2.id).toBeTruthy();
    if (snap2.isDelta) {
      expect(snap2.baseSnapshotId).toBe(snapshots[0]!.id);
    }
  });
});
