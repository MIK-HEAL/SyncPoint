/**
 * E2E: Full API flow — agent, task, checkpoint, contract, handoff, snapshot.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "../../src/tests/e2e-helper.js";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("API flow", () => {
  let agentId: string;
  let taskId: string;
  let checkpointId: string;
  let contractId: string;

  it("creates an agent", async () => {
    const agent = (await ctx.rpc("agent.create", {
      name: "codex", provider: "codex", role: "backend",
    })) as any;
    expect(agent.name).toBe("codex");
    agentId = agent.id;
  });

  it("creates a task", async () => {
    const task = (await ctx.rpc("task.create", {
      title: "Build API",
    })) as any;
    expect(task.status).toBe("OPEN");
    taskId = task.id;
  });

  it("assigns task to agent", async () => {
    const task = (await ctx.rpc("task.assign", {
      taskId, agentId,
    })) as any;
    expect(task.status).toBe("ASSIGNED");
    expect(task.ownerAgentId).toBe(agentId);
  });

  it("creates a checkpoint", async () => {
    const cp = (await ctx.rpc("checkpoint.create", {
      taskId, agentId, summary: "Started work",
    })) as any;
    expect(cp.summary).toBe("Started work");
    checkpointId = cp.id;
  });

  it("drafts a contract (task → NEEDS_CONTRACT)", async () => {
    const c = (await ctx.rpc("contract.create", {
      taskId, title: "API contract",
    })) as any;
    expect(c.status).toBe("DRAFT");
    contractId = c.id;
    // Verify task status changed
    const task = (await ctx.rpc("task.get", { id: taskId }, "GET")) as any;
    expect(task.status).toBe("NEEDS_CONTRACT");
  });

  it("reviews contract (task → CONTRACT_REVIEW)", async () => {
    await ctx.rpc("contract.updateStatus", { id: contractId, status: "REVIEWING" });
    const task = (await ctx.rpc("task.get", { id: taskId }, "GET")) as any;
    expect(task.status).toBe("CONTRACT_REVIEW");
  });

  it("approves contract (task → READY_TO_WORK)", async () => {
    await ctx.rpc("contract.updateStatus", { id: contractId, status: "APPROVED" });
    const task = (await ctx.rpc("task.get", { id: taskId }, "GET")) as any;
    expect(task.status).toBe("READY_TO_WORK");
  });

  it("moves task to IN_PROGRESS", async () => {
    const task = (await ctx.rpc("task.updateStatus", {
      taskId, status: "IN_PROGRESS",
    })) as any;
    expect(task.status).toBe("IN_PROGRESS");
  });

  it("creates a context snapshot", async () => {
    const snapshot = (await ctx.rpc("contextSnapshot.create", {
      taskId, agentId, checkpointId,
      summary: "Build REST API",
      payload: {
        goal: "Build REST API",
        currentPhase: "implementation",
      },
    })) as any;
    expect(snapshot.payload.goal).toBe("Build REST API");
  });

  it("lists events", async () => {
    const events = (await ctx.rpc("event.list", { limit: 100 }, "GET")) as any[];
    expect(events.length).toBeGreaterThan(0);
  });

  it("gets status endpoint", async () => {
    const r = await fetch(`${ctx.baseUrl}/status`);
    const json = await r.json() as any;
    expect(json.status).toBe("ok");
  });
});
