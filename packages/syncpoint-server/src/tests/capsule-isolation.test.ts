/**
 * E2E: Context capsules are isolated per task+agent.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Capsule isolation", () => {
  it("capsules are scoped to task+agent pair", async () => {
    const a1 = (await ctx.rpc("agent.create", { name: "codex", provider: "codex", role: "backend" })) as any;
    const a2 = (await ctx.rpc("agent.create", { name: "claude", provider: "claude-code", role: "frontend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Build API" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a1.id });

    const cp1 = (await ctx.rpc("checkpoint.create", { taskId: t.id, agentId: a1.id, summary: "a1 checkpoint" })) as any;
    const cp2 = (await ctx.rpc("checkpoint.create", { taskId: t.id, agentId: a2.id, summary: "a2 checkpoint" })) as any;

    // Create capsules for different agents on same task
    await ctx.rpc("capsule.create", {
      taskId: t.id,
      agentId: a1.id,
      checkpointId: cp1.id,
      summary: "a1 goal",
      payloadJson: JSON.stringify({ goal: "a1 goal" }),
    });
    await ctx.rpc("capsule.create", {
      taskId: t.id,
      agentId: a2.id,
      checkpointId: cp2.id,
      summary: "a2 goal",
      payloadJson: JSON.stringify({ goal: "a2 goal" }),
    });

    // getLatest should return the correct capsule for each agent
    const latest1 = (await ctx.rpc("capsule.getLatest", { taskId: t.id, agentId: a1.id }, "GET")) as any;
    expect(JSON.parse(latest1.payloadJson).goal).toBe("a1 goal");
    expect(latest1.agentId).toBe(a1.id);

    const latest2 = (await ctx.rpc("capsule.getLatest", { taskId: t.id, agentId: a2.id }, "GET")) as any;
    expect(JSON.parse(latest2.payloadJson).goal).toBe("a2 goal");
    expect(latest2.agentId).toBe(a2.id);
  });

  it("list capsules returns all capsules for a task", async () => {
    const a = (await ctx.rpc("agent.create", { name: "cx", provider: "codex", role: "backend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Test task" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a.id });
    const cp = (await ctx.rpc("checkpoint.create", { taskId: t.id, agentId: a.id, summary: "cp" })) as any;

    await ctx.rpc("capsule.create", {
      taskId: t.id,
      agentId: a.id,
      checkpointId: cp.id,
      summary: "v1",
      payloadJson: JSON.stringify({ goal: "v1" }),
    });
    await ctx.rpc("capsule.create", {
      taskId: t.id,
      agentId: a.id,
      checkpointId: cp.id,
      summary: "v2",
      payloadJson: JSON.stringify({ goal: "v2" }),
    });

    const capsules = (await ctx.rpc("capsule.list", { taskId: t.id }, "GET")) as any[];
    expect(capsules.length).toBeGreaterThanOrEqual(2);
  });
});
