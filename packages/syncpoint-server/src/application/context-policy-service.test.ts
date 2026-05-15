/**
 * Tests for context-policy-service.ts — prepareContext, enforcePreparedContext.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import { pmAdd, pmApprove } from "./project-memory-service.js";
import { prepareContext, enforcePreparedContext, getContextPolicyInfo } from "./context-policy-service.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-cp-svc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  // Seed
  const agent = repo.createAgent({ name: "cursor", provider: "cursor", role: "frontend" });
  const task = repo.createTask({ title: "Build feature X", description: "Test task" });
  agentId = agent.id;
  taskId = task.id;
  repo.assignTask(taskId, agentId);

  // Checkpoint + snapshot
  const cp = repo.createCheckpoint({
    taskId, agentId,
    summary: "Initial work done",
    progress: "50%",
    currentUnderstanding: "",
    changedFiles: "",
    risks: "None",
    blockers: "",
    nextSteps: "Continue",
    needSync: false,
  });
  repo.createContextSnapshot({
    taskId, agentId,
    checkpointId: cp.id,
    summary: "Build feature X",
    payloadJson: JSON.stringify({
      goal: "Build feature X",
      currentPhase: "implementation",
      confirmedDecisions: [],
      interfaceContract: "",
      workingResources: ["src/main.ts"],
      completedWork: "Half done",
      remainingWork: "Other half",
      risks: [],
      blockers: [],
      nextSteps: ["Continue coding"],
      resumePrompt: "Continue building feature X",
    }),
  });

  // Project memory
  const mem = pmAdd({
    category: "architecture" as any,
    title: "Test Architecture",
    content: "We use a layered architecture.",
    scope: "project" as any,
    tags: "arch",
    sourceType: "human" as any,
    sourceRef: "",
    confidence: "high" as any,
    taskId: null,
    createdBy: "test",
    global: true,
  });
  pmApprove(mem.id, "test");

  // Draft memory (should NOT enter execute context)
  pmAdd({
    category: "decision" as any,
    title: "Draft Decision",
    content: "This is a draft and should not be in execution context.",
    scope: "project" as any,
    tags: "draft",
    sourceType: "human" as any,
    sourceRef: "",
    confidence: "medium" as any,
    taskId: null,
    createdBy: "test",
    global: true,
  });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("prepareContext", () => {
  it("execute — success with full context", () => {
    const ctx = prepareContext({ intent: "execute", role: "executor", taskId, agentId });
    expect(ctx.intent).toBe("execute");
    expect(ctx.role).toBe("executor");
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.ready).toBe(true);
    expect(ctx.missingSections).toHaveLength(0);
    expect(ctx.task).not.toBeNull();
    expect(ctx.agent).not.toBeNull();
    expect(ctx.resumeContext).not.toBeNull();
    expect(ctx.prompt).toContain("Build feature X");
  });

  it("execute — fails hard when snapshot missing", () => {
    // Create a task with no snapshot
    const t2 = repo.createTask({ title: "No snapshot task", description: "test" });
    const a2 = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
    repo.assignTask(t2.id, a2.id);

    const ctx = prepareContext({ intent: "execute", role: "executor", taskId: t2.id, agentId: a2.id });
    expect(ctx.ready).toBe(false);
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.missingSections).toContain("latest-snapshot");
    expect(ctx.missingSections).toContain("latest-checkpoint");
    expect(ctx.suggestedNextActions.length).toBeGreaterThan(0);
  });

  it("execute — fails hard when existing contract is not approved", () => {
    const a = repo.createAgent({ name: "contract-agent", provider: "codex", role: "backend" });
    const t = repo.createTask({ title: "Needs contract approval", description: "test" });
    repo.assignTask(t.id, a.id);
    const cp = repo.createCheckpoint({
      taskId: t.id,
      agentId: a.id,
      summary: "Ready to work",
      progress: "10%",
      currentUnderstanding: "",
      changedFiles: "",
      risks: "",
      blockers: "",
      nextSteps: "Wait for approval",
      needSync: false,
    });
    repo.createContextSnapshot({
      taskId: t.id,
      agentId: a.id,
      checkpointId: cp.id,
      summary: "Implement contract-gated work",
      payloadJson: JSON.stringify({
        goal: "Implement contract-gated work",
        currentPhase: "planning",
        confirmedDecisions: [],
        interfaceContract: "",
        workingResources: [],
        completedWork: "",
        remainingWork: "Implementation",
        risks: [],
        blockers: [],
        nextSteps: ["Approve contract"],
        resumePrompt: "Do not start until contract is approved.",
      }),
    });
    repo.createContract({
      taskId: t.id,
      title: "Draft contract",
      participants: "",
      scope: "Contract-gated scope",
      responsibilities: "",
      interfaceSpec: "",
      fileBoundaries: "",
      dependencies: "",
      testPlan: "",
      risks: "",
    });

    const ctx = prepareContext({ intent: "execute", role: "executor", taskId: t.id, agentId: a.id });
    expect(ctx.ready).toBe(false);
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.warnings.join("\n")).toContain("not APPROVED");
  });

  it("resume — same as execute, hard gate", () => {
    const ctx = prepareContext({ intent: "resume", role: "executor", taskId, agentId });
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.ready).toBe(true);
  });

  it("handoff-receive — hard gate with snapshot required", () => {
    const ctx = prepareContext({ intent: "handoff-receive", role: "handoff-receiver", taskId, agentId });
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.ready).toBe(true);
  });

  it("handoff-receive — can use sender snapshot and handoff context for a new receiver", () => {
    const from = repo.createAgent({ name: "sender", provider: "codex", role: "backend" });
    const to = repo.createAgent({ name: "receiver", provider: "claude-code", role: "frontend" });
    const t = repo.createTask({ title: "Handoff task", description: "test" });
    repo.assignTask(t.id, from.id);
    const cp = repo.createCheckpoint({
      taskId: t.id,
      agentId: from.id,
      summary: "Sender work done",
      progress: "70%",
      currentUnderstanding: "",
      changedFiles: "",
      risks: "",
      blockers: "",
      nextSteps: "Receiver continues",
      needSync: false,
    });
    repo.createContextSnapshot({
      taskId: t.id,
      agentId: from.id,
      checkpointId: cp.id,
      summary: "Finish handoff task",
      payloadJson: JSON.stringify({
        goal: "Finish handoff task",
        currentPhase: "handoff",
        confirmedDecisions: [],
        interfaceContract: "",
        workingResources: ["src/handoff.ts"],
        completedWork: "Backend portion",
        remainingWork: "Frontend portion",
        risks: [],
        blockers: [],
        nextSteps: ["Build UI"],
        resumePrompt: "Use sender snapshot to continue.",
      }),
    });
    const h = repo.createHandoff({
      taskId: t.id,
      fromAgentId: from.id,
      toAgentId: to.id,
      contextSummary: "Frontend should continue from backend handoff.",
    });

    const ctx = prepareContext({ intent: "handoff-receive", role: "handoff-receiver", taskId: t.id, agentId: to.id });
    expect(ctx.gateMode).toBe("hard");
    expect(ctx.ready).toBe(true);
    expect(ctx.handoffContext?.id).toBe(h.id);
    expect(ctx.prompt).toContain("Handoff Receive Context");
    expect(ctx.prompt).toContain("Frontend should continue");
    expect(ctx.prompt).toContain("Sender Context Snapshot");
  });

  it("review — soft gate, includes contract/checkpoint/snapshot", () => {
    const ctx = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
    expect(ctx.gateMode).toBe("soft");
    expect(ctx.ready).toBe(true);
    expect(ctx.prompt).toContain("Review Context");
    expect(ctx.prompt).toContain("Review Checklist");
  });

  it("architect-plan — soft gate, includes project memory", () => {
    const ctx = prepareContext({ intent: "architect-plan", role: "architect" });
    expect(ctx.gateMode).toBe("soft");
    expect(ctx.ready).toBe(true);
    expect(ctx.projectMemories.length).toBeGreaterThanOrEqual(1);
    expect(ctx.prompt).toContain("Architect Planning Context");
    expect(ctx.prompt).toContain("Test Architecture");
  });

  it("project-onboard — none gate, always ready", () => {
    const ctx = prepareContext({ intent: "project-onboard", role: "observer" });
    expect(ctx.gateMode).toBe("none");
    expect(ctx.ready).toBe(true);
    expect(ctx.prompt).toContain("Project Onboarding");
    expect(ctx.agentList.length).toBeGreaterThanOrEqual(1);
    expect(ctx.taskList.length).toBeGreaterThanOrEqual(1);
  });

  it("memory-review — none gate, lists all memory statuses", () => {
    const ctx = prepareContext({ intent: "memory-review", role: "architect" });
    expect(ctx.gateMode).toBe("none");
    expect(ctx.ready).toBe(true);
    expect(ctx.prompt).toContain("Project Memory Review");
    expect(ctx.draftMemories.length).toBeGreaterThanOrEqual(1);
    expect(ctx.projectMemories.length).toBeGreaterThanOrEqual(1);
  });

  it("draft memory should NOT appear in execute context projectMemories", () => {
    const ctx = prepareContext({ intent: "execute", role: "executor", taskId, agentId });
    // projectMemories should only contain approved memories
    for (const m of ctx.projectMemories) {
      expect(m.title).not.toBe("Draft Decision");
    }
  });

  it("draft memory SHOULD appear in memory-review draftMemories", () => {
    const ctx = prepareContext({ intent: "memory-review", role: "architect" });
    const draftTitles = ctx.draftMemories.map(m => m.title);
    expect(draftTitles).toContain("Draft Decision");
  });
});

describe("enforcePreparedContext", () => {
  it("should relay ready/warnings/missingSections", () => {
    const prepared = prepareContext({ intent: "execute", role: "executor", taskId, agentId });
    const result = enforcePreparedContext(prepared);
    expect(result.ready).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.missingSections).toHaveLength(0);
  });

  it("should report missing sections for incomplete context", () => {
    const t2 = repo.createTask({ title: "Missing task", description: "test" });
    const a2 = repo.listAgents().find(a => a.name === "codex")!;
    repo.assignTask(t2.id, a2.id);

    const prepared = prepareContext({ intent: "execute", role: "executor", taskId: t2.id, agentId: a2.id });
    const result = enforcePreparedContext(prepared);
    expect(result.ready).toBe(false);
    expect(result.missingSections.length).toBeGreaterThan(0);
  });
});

describe("P3B: prepareContext resume intents must not leak raw PM", () => {
  it("prepareContext(resume) — full JSON has no raw PM", () => {
    const result = prepareContext({ intent: "resume", role: "executor", taskId, agentId });
    const json = JSON.stringify(result);
    expect(result.prompt).not.toContain("## Project Knowledge");
    expect(result.projectMemories).toEqual([]);
    expect(result.resumeContext?.projectMemories ?? []).toEqual([]);
    expect(result.resumeContext?.resumePrompt ?? "").toBe("");
    expect(json).not.toContain("## Project Knowledge");
  });

  it("prepareContext(execute) — full JSON has no raw PM", () => {
    const result = prepareContext({ intent: "execute", role: "executor", taskId, agentId });
    const json = JSON.stringify(result);
    expect(result.prompt).not.toContain("## Project Knowledge");
    expect(result.projectMemories).toEqual([]);
    expect(result.resumeContext?.projectMemories ?? []).toEqual([]);
    expect(result.resumeContext?.resumePrompt ?? "").toBe("");
    expect(json).not.toContain("## Project Knowledge");
  });

  it("prepareContext(handoff-receive) — full JSON has no raw PM", () => {
    const result = prepareContext({ intent: "handoff-receive", role: "executor", taskId, agentId });
    const json = JSON.stringify(result);
    expect(result.prompt).not.toContain("## Project Knowledge");
    expect(result.projectMemories).toEqual([]);
    expect(result.resumeContext?.projectMemories ?? []).toEqual([]);
    expect(result.resumeContext?.resumePrompt ?? "").toBe("");
    expect(json).not.toContain("## Project Knowledge");
  });
});

describe("getContextPolicyInfo", () => {
  it("should list all intents, roles, and policies", () => {
    const info = getContextPolicyInfo();
    expect(info.intents).toHaveLength(7);
    expect(info.roles).toHaveLength(6);
    expect(info.policies).toHaveLength(7);
  });
});
