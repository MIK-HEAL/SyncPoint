/**
 * E2E: Handoff transfers task ownership between agents.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "../../src/tests/e2e-helper.js";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Handoff ownership", () => {
  it("transfers task ownership on handoff accept", async () => {
    const a1 = (await ctx.rpc("agent.create", { name: "codex", provider: "codex", role: "backend" })) as any;
    const a2 = (await ctx.rpc("agent.create", { name: "claude", provider: "claude-code", role: "frontend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Build UI" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a1.id });

    // Verify initial ownership
    let task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.ownerAgentId).toBe(a1.id);

    // Create and accept handoff
    const h = (await ctx.rpc("handoff.create", {
      taskId: t.id, fromAgentId: a1.id, toAgentId: a2.id,
      contextSummary: "Passing UI work",
    })) as any;
    expect(h.status).toBe("PENDING");

    const accepted = (await ctx.rpc("handoff.accept", { id: h.id })) as any;
    expect(accepted.status).toBe("ACCEPTED");

    // Verify ownership transferred
    task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.ownerAgentId).toBe(a2.id);

    // Verify agent currentTaskId updated
    const agent1 = (await ctx.rpc("agent.get", { id: a1.id }, "GET")) as any;
    expect(agent1.currentTaskId).toBeNull();
    const agent2 = (await ctx.rpc("agent.get", { id: a2.id }, "GET")) as any;
    expect(agent2.currentTaskId).toBe(t.id);
  });

  it("reject handoff keeps ownership unchanged", async () => {
    const a1 = (await ctx.rpc("agent.create", { name: "c1", provider: "codex", role: "backend" })) as any;
    const a2 = (await ctx.rpc("agent.create", { name: "c2", provider: "claude-code", role: "frontend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Build DB" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a1.id });

    const h = (await ctx.rpc("handoff.create", {
      taskId: t.id, fromAgentId: a1.id, toAgentId: a2.id,
      contextSummary: "Trying to pass",
    })) as any;

    const rejected = (await ctx.rpc("handoff.reject", { id: h.id })) as any;
    expect(rejected.status).toBe("REJECTED");

    // Ownership unchanged
    const task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.ownerAgentId).toBe(a1.id);
  });
});
