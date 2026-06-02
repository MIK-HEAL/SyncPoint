/**
 * E2E: Contract lifecycle drives task status transitions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.js";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Contract → TaskStatus", () => {
  it("full contract lifecycle: ASSIGNED → NEEDS_CONTRACT → CONTRACT_REVIEW → READY_TO_WORK → IN_PROGRESS", async () => {
    const a = (await ctx.rpc("agent.create", { name: "codex", provider: "codex", role: "backend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Build feature" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a.id });

    let task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.status).toBe("ASSIGNED");

    // Draft contract
    const c = (await ctx.rpc("contract.create", { taskId: t.id, title: "Feature contract" })) as any;
    task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.status).toBe("NEEDS_CONTRACT");

    // Review
    await ctx.rpc("contract.updateStatus", { id: c.id, status: "REVIEWING" });
    task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.status).toBe("CONTRACT_REVIEW");

    // Approve
    await ctx.rpc("contract.updateStatus", { id: c.id, status: "APPROVED" });
    task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.status).toBe("READY_TO_WORK");

    // Start work
    task = (await ctx.rpc("task.updateStatus", { taskId: t.id, status: "IN_PROGRESS" })) as any;
    expect(task.status).toBe("IN_PROGRESS");
  });

  it("contract reject cycles back to NEEDS_CONTRACT", async () => {
    const a = (await ctx.rpc("agent.create", { name: "cx", provider: "codex", role: "backend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Rejected feature" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a.id });

    const c = (await ctx.rpc("contract.create", { taskId: t.id, title: "Bad contract" })) as any;
    await ctx.rpc("contract.updateStatus", { id: c.id, status: "REVIEWING" });
    await ctx.rpc("contract.updateStatus", { id: c.id, status: "REJECTED" });

    const task = (await ctx.rpc("task.get", { id: t.id }, "GET")) as any;
    expect(task.status).toBe("NEEDS_CONTRACT");
  });
});
