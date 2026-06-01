/**
 * E2E: Memory Switch Engine — resume context, quality checks, pinned memory.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Memory Switch Engine", () => {
  let agentId: string;
  let taskId: string;
  let checkpointId: string;
  let contractId: string;

  it("setup: create agent, task, assign, checkpoint, contract, snapshot", async () => {
    const a = (await ctx.rpc("agent.create", { name: "codex", provider: "codex", role: "backend" })) as any;
    agentId = a.id;
    const t = (await ctx.rpc("task.create", { title: "Build auth" })) as any;
    taskId = t.id;
    await ctx.rpc("task.assign", { taskId, agentId });
    const cp = (await ctx.rpc("checkpoint.create", { taskId, agentId, summary: "Started auth work", progress: "50%", risks: "", blockers: "" })) as any;
    checkpointId = cp.id;
    const c = (await ctx.rpc("contract.create", { taskId, title: "Auth contract", scope: "auth module", responsibilities: ["backend: API"], interfaceSpec: ["POST /login"], resourceBoundaries: ["src/auth/*"] })) as any;
    contractId = c.id;
    await ctx.rpc("contract.updateStatus", { id: contractId, status: "REVIEWING" });
    await ctx.rpc("contract.updateStatus", { id: contractId, status: "APPROVED" });
    await ctx.rpc("contextSnapshot.create", {
      taskId, agentId, checkpointId,
      summary: "Implement auth API",
      payload: {
        goal: "Implement auth API",
        currentPhase: "implementation",
        confirmedDecisions: ["JWT auth"],
        workingResources: ["src/auth/login.ts"],
        completedWork: "Schema defined",
        remainingWork: "Implement handler",
        nextSteps: ["Write login endpoint"],
        resumePrompt: "Continue implementing POST /login with JWT.",
      },
    });
  });

  it("getResumeContext returns structured context", async () => {
    const rc = (await ctx.rpc("resumeContext.get", { taskId, agentId }, "GET")) as any;
    expect(rc.ready).toBe(true);
    expect(rc.taskId).toBe(taskId);
    expect(rc.agentId).toBe(agentId);

    // Task metadata
    expect(rc.task.title).toBe("Build auth");
    expect(rc.agent.name).toBe("codex");

    // Contract
    expect(rc.approvedContract).not.toBeNull();
    expect(rc.approvedContract.title).toBe("Auth contract");
    expect(rc.approvedContract.scope).toBe("auth module");
    expect(rc.approvedContract.interfaceSpec).toContain("POST /login");
    expect(rc.approvedContract.resourceBoundaries).toContain("src/auth/*");

    // Snapshot
    expect(rc.latestSnapshot).not.toBeNull();
    const snapshotPayload = rc.latestSnapshot.payload;
    expect(snapshotPayload.goal).toBe("Implement auth API");
    expect(snapshotPayload.resumePrompt).toContain("POST /login");

    // Checkpoint
    expect(rc.latestCheckpoint).not.toBeNull();
    expect(rc.latestCheckpoint.summary).toBe("Started auth work");

    // P3B: resumePrompt is stripped at transport (contains baked-in raw PM)
    // Verify structured fields carry the content instead
    expect(snapshotPayload.goal).toContain("Implement auth API");
    expect(rc.approvedContract.interfaceSpec).toContain("POST /login");

    // Quality checks all pass
    expect(rc.checks.length).toBeGreaterThan(0);
    expect(rc.warnings.length).toBe(0);
  });

  it("resume context does NOT include other agent's snapshot", async () => {
    const a2 = (await ctx.rpc("agent.create", { name: "claude", provider: "claude-code", role: "frontend" })) as any;
    const rc = (await ctx.rpc("resumeContext.get", { taskId, agentId: a2.id }, "GET")) as any;
    // Should NOT have a snapshot (no snapshot for a2)
    expect(rc.latestSnapshot).toBeNull();
    expect(rc.ready).toBe(false);
    expect(rc.warnings.length).toBeGreaterThan(0);
    expect(rc.warnings[0]).toContain("No context snapshot");
  });

  it("resume context warns when contract not approved", async () => {
    const t2 = (await ctx.rpc("task.create", { title: "Build UI" })) as any;
    await ctx.rpc("task.assign", { taskId: t2.id, agentId });
    const c2 = (await ctx.rpc("contract.create", { taskId: t2.id, title: "UI contract" })) as any;
    const cp2 = (await ctx.rpc("checkpoint.create", { taskId: t2.id, agentId, summary: "UI start" })) as any;
    await ctx.rpc("contextSnapshot.create", {
      taskId: t2.id,
      agentId,
      checkpointId: cp2.id,
      summary: "Build UI",
      payload: { goal: "Build UI" },
    });

    const rc = (await ctx.rpc("resumeContext.get", { taskId: t2.id, agentId }, "GET")) as any;
    expect(rc.ready).toBe(false);
    const approvalCheck = rc.checks.find((c: any) => c.name === "Approval");
    expect(approvalCheck.status).toBe("FAIL");
    expect(rc.warnings.some((w: string) => w.includes("not APPROVED"))).toBe(true);
  });

  it("pinned memories are included in resume context", async () => {
    await ctx.rpc("pinnedMemory.create", { key: "code-style", content: "Use TypeScript strict mode", scope: "project" });
    await ctx.rpc("pinnedMemory.create", { key: "auth-rule", content: "Always use JWT", scope: "task", taskId });

    const rc = (await ctx.rpc("resumeContext.get", { taskId, agentId }, "GET")) as any;
    expect(rc.pinnedMemories.length).toBeGreaterThanOrEqual(2);
    expect(rc.pinnedMemories.some((m: any) => m.key === "code-style")).toBe(true);
    expect(rc.pinnedMemories.some((m: any) => m.key === "auth-rule")).toBe(true);

    // P3B: resumePrompt stripped at transport, but pinnedMemories still present in ctx
    expect(rc.pinnedMemories.some((m: any) => m.content === "Use TypeScript strict mode")).toBe(true);
  });

  it("enforceContextPolicy returns ready + warnings", async () => {
    const policy = (await ctx.rpc("resumeContext.enforce", { taskId, agentId }, "GET")) as any;
    expect(typeof policy.ready).toBe("boolean");
    expect(Array.isArray(policy.warnings)).toBe(true);
  });

  it("pinnedMemory CRUD works", async () => {
    const m = (await ctx.rpc("pinnedMemory.create", { key: "test-rule", content: "Test content" })) as any;
    expect(m.key).toBe("test-rule");
    expect(m.content).toBe("Test content");

    const updated = (await ctx.rpc("pinnedMemory.update", { id: m.id, content: "Updated content" })) as any;
    expect(updated.content).toBe("Updated content");

    const list = (await ctx.rpc("pinnedMemory.list", {}, "GET")) as any[];
    expect(list.some((x: any) => x.key === "test-rule")).toBe(true);

    await ctx.rpc("pinnedMemory.delete", { id: m.id });
    const list2 = (await ctx.rpc("pinnedMemory.list", {}, "GET")) as any[];
    expect(list2.some((x: any) => x.key === "test-rule")).toBe(false);
  });
});
