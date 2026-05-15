/**
 * E2E tests for CLI Agent Loop commands via tRPC.
 * Tests the full lifecycle: boot → checkpoint → resume → handoff → status.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E } from "./e2e-helper.ts";
import type { E2EContext } from "./e2e-helper.ts";

let e2e: E2EContext;
let agentA: any;
let agentB: any;
let taskId: string;

beforeAll(async () => {
  e2e = await startE2E();

  // Create two agents
  agentA = await e2e.rpc("agent.create", {
    name: "cursor",
    provider: "cursor",
    role: "frontend",
  }, "POST");

  agentB = await e2e.rpc("agent.create", {
    name: "codex",
    provider: "codex",
    role: "backend",
  }, "POST");

  // Create a task
  const task = await e2e.rpc("task.create", {
    title: "Build dashboard",
    description: "Full-stack dashboard feature",
  }, "POST") as any;
  taskId = task.id;
});

afterAll(async () => {
  await e2e.cleanup();
});

describe("loop lifecycle — single agent", () => {
  it("boot: assigns task and generates adapter instruction", async () => {
    // Assign task first (loop boot would do this)
    await e2e.rpc("task.assign", { taskId, agentId: agentA.id }, "POST");

    // Move to IN_PROGRESS
    await e2e.rpc("task.updateStatus", { taskId, status: "IN_PROGRESS" }, "POST");

    // Get resume context (adapter.boot equivalent)
    const instruction = await e2e.rpc("adapter.boot", {
      taskId,
      agentId: agentA.id,
      provider: "cursor",
      event: "boot",
    }, "GET") as any;

    expect(instruction.provider).toBe("cursor");
    expect(instruction.files).toHaveProperty(".cursorrules");
    expect(instruction.event).toBe("boot");

    // Verify task status
    const task = await e2e.rpc("task.get", { id: taskId }, "GET") as any;
    expect(task.status).toBe("IN_PROGRESS");
  });

  it("checkpoint: creates checkpoint + snapshot", async () => {
    // Create checkpoint
    const cp = await e2e.rpc("checkpoint.create", {
      taskId,
      agentId: agentA.id,
      summary: "Implemented header component",
      progress: "40%",
      nextSteps: "Add navigation",
    }, "POST") as any;
    expect(cp.id).toBeDefined();

    // Create snapshot
    const snapshot = await e2e.rpc("contextSnapshot.create", {
      taskId,
      agentId: agentA.id,
      checkpointId: cp.id,
      summary: "Build dashboard UI",
      payloadJson: JSON.stringify({
        goal: "Build dashboard UI",
        currentPhase: "implementation",
        workingResources: ["src/Dashboard.tsx"],
        completedWork: "Header component",
        remainingWork: "Navigation, widgets",
        nextSteps: ["Add navigation menu"],
        resumePrompt: "Continue building dashboard. Header is done. Add nav next.",
      }),
    }, "POST") as any;
    expect(snapshot.id).toBeDefined();

    // Verify adapter boot now includes snapshot content
    const instruction = await e2e.rpc("adapter.boot", {
      taskId,
      agentId: agentA.id,
      provider: "cursor",
      event: "checkpoint",
    }, "GET") as any;

    expect(instruction.files[".cursorrules"]).toContain("Build dashboard UI");
    expect(instruction.files[".cursorrules"]).toContain("Navigation, widgets");
    expect(instruction.files[".cursorrules"]).toContain("Add navigation menu");
    expect(instruction.ready).toBe(true);
  });

  it("resume: enforces context and returns resume prompt", async () => {
    const ctx = await e2e.rpc("resumeContext.get", {
      taskId,
      agentId: agentA.id,
    }, "GET") as any;

    expect(ctx.ready).toBe(true);
    expect(ctx.latestSnapshot).toBeDefined();
    const snapshotPayload = JSON.parse(ctx.latestSnapshot.payloadJson);
    expect(snapshotPayload.goal).toBe("Build dashboard UI");
    // P3B: ctx.resumePrompt is stripped at transport (contains baked-in raw PM)
    // Resume instructions live in latestSnapshot.resumePrompt
    expect(snapshotPayload.resumePrompt).toContain("Continue building dashboard");

    // Enforce policy
    const policy = await e2e.rpc("resumeContext.enforce", {
      taskId,
      agentId: agentA.id,
    }, "GET") as any;
    expect(policy.ready).toBe(true);
  });

  it("status: shows full agent+task overview", async () => {
    const task = await e2e.rpc("task.get", { id: taskId }, "GET") as any;
    const agent = await e2e.rpc("agent.get", { id: agentA.id }, "GET") as any;
    const checkpoints = await e2e.rpc("checkpoint.list", { taskId }, "GET") as any;
    const snapshot = await e2e.rpc("contextSnapshot.getLatest", { taskId, agentId: agentA.id }, "GET") as any;

    expect(task.status).toBe("IN_PROGRESS");
    expect(agent.id).toBe(agentA.id);
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(snapshot).toBeDefined();
    expect(JSON.parse(snapshot.payloadJson).goal).toBe("Build dashboard UI");
  });
});

describe("loop lifecycle — handoff between agents", () => {
  it("handoff: sender saves snapshot, creates handoff, receiver gets context", async () => {
    // Sender creates final checkpoint + snapshot
    const cp = await e2e.rpc("checkpoint.create", {
      taskId,
      agentId: agentA.id,
      summary: "Handoff to codex: need API endpoints",
      nextSteps: "Handoff to codex",
    }, "POST") as any;

    await e2e.rpc("contextSnapshot.create", {
      taskId,
      agentId: agentA.id,
      checkpointId: cp.id,
      summary: "Build dashboard UI",
      payloadJson: JSON.stringify({
        goal: "Build dashboard UI",
        currentPhase: "handoff",
        completedWork: "Header + nav done",
        remainingWork: "API integration",
        nextSteps: ["Handoff to codex for backend work"],
        resumePrompt: "Need API endpoints for dashboard widgets",
      }),
    }, "POST");

    // Create handoff
    const handoff = await e2e.rpc("handoff.create", {
      taskId,
      fromAgentId: agentA.id,
      toAgentId: agentB.id,
      contextSummary: "Need API endpoints for dashboard widgets",
    }, "POST") as any;
    expect(handoff.id).toBeDefined();
    expect(handoff.status).toBe("PENDING");

    // Accept handoff
    const accepted = await e2e.rpc("handoff.accept", { id: handoff.id }, "POST") as any;
    expect(accepted.status).toBe("ACCEPTED");

    // Receiver gets adapter instruction
    const instruction = await e2e.rpc("adapter.boot", {
      taskId,
      agentId: agentB.id,
      provider: "codex",
      event: "handoff",
    }, "GET") as any;

    expect(instruction.provider).toBe("codex");
    expect(instruction.files).toHaveProperty("AGENTS.md");
    expect(instruction.event).toBe("handoff");
  });

  it("receiver can create own checkpoint after handoff", async () => {
    const cp = await e2e.rpc("checkpoint.create", {
      taskId,
      agentId: agentB.id,
      summary: "Started backend API for dashboard",
      nextSteps: "Implement GET /widgets endpoint",
    }, "POST") as any;
    expect(cp.id).toBeDefined();

    const snapshot = await e2e.rpc("contextSnapshot.create", {
      taskId,
      agentId: agentB.id,
      checkpointId: cp.id,
      summary: "Build dashboard API",
      payloadJson: JSON.stringify({
        goal: "Build dashboard API",
        currentPhase: "implementation",
        workingResources: ["src/api/widgets.ts"],
        nextSteps: ["Implement GET /widgets"],
        resumePrompt: "Implement GET /widgets endpoint returning dashboard data",
      }),
    }, "POST") as any;
    expect(snapshot.id).toBeDefined();

    // Verify receiver's resume context
    const ctx = await e2e.rpc("resumeContext.get", {
      taskId,
      agentId: agentB.id,
    }, "GET") as any;
    expect(ctx.ready).toBe(true);
    expect(JSON.parse(ctx.latestSnapshot.payloadJson).goal).toBe("Build dashboard API");
  });
});

describe("loop lifecycle — context policy enforcement", () => {
  it("enforce fails when agent has no snapshot for a new task", async () => {
    // Create new task without snapshot
    const newTask = await e2e.rpc("task.create", {
      title: "Orphan task",
    }, "POST") as any;
    await e2e.rpc("task.assign", { taskId: newTask.id, agentId: agentA.id }, "POST");

    const policy = await e2e.rpc("resumeContext.enforce", {
      taskId: newTask.id,
      agentId: agentA.id,
    }, "GET") as any;

    expect(policy.ready).toBe(false);
    expect(policy.warnings.length).toBeGreaterThan(0);
  });
});
