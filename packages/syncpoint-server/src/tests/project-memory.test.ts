/**
 * E2E: Project Memory Layer — CRUD, lifecycle, and resume context integration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Project Memory Layer", () => {
  let memId: string;

  it("create project memory (defaults to draft)", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Project Overview",
      content: "SyncPoint is a multi-agent collaboration state layer.",
      tags: "core,overview",
      sourceType: "human",
    })) as any;
    memId = m.id;
    expect(m.id).toBeTruthy();
    expect(m.status).toBe("draft");
    expect(m.category).toBe("overview");
    expect(m.title).toBe("Project Overview");
    expect(m.content).toContain("multi-agent");
    expect(m.tags).toBe("core,overview");
  });

  it("list shows draft memories", async () => {
    const all = (await ctx.rpc("projectMemory.list", {}, "GET")) as any[];
    expect(all.some((m: any) => m.id === memId)).toBe(true);
  });

  it("list by status filter works", async () => {
    const drafts = (await ctx.rpc("projectMemory.list", { status: "draft" }, "GET")) as any[];
    expect(drafts.some((m: any) => m.id === memId)).toBe(true);
    const approved = (await ctx.rpc("projectMemory.list", { status: "approved" }, "GET")) as any[];
    expect(approved.some((m: any) => m.id === memId)).toBe(false);
  });

  it("update project memory fields", async () => {
    const updated = (await ctx.rpc("projectMemory.update", {
      id: memId,
      content: "SyncPoint is a local multi-agent collaboration state layer for AI editors.",
      updatedBy: "human",
    })) as any;
    expect(updated.content).toContain("AI editors");
    expect(updated.updatedBy).toBe("human");
  });

  it("approve promotes to approved", async () => {
    const m = (await ctx.rpc("projectMemory.approve", { id: memId })) as any;
    expect(m.status).toBe("approved");
  });

  it("approved memory appears in search", async () => {
    const results = (await ctx.rpc("projectMemory.search", { query: "multi-agent" }, "GET")) as any[];
    expect(results.some((m: any) => m.id === memId)).toBe(true);
  });

  it("approved memory is injected into resume context", async () => {
    // Setup: agent + task + checkpoint + capsule
    const a = (await ctx.rpc("agent.create", { name: "cursor", provider: "cursor", role: "backend" })) as any;
    const t = (await ctx.rpc("task.create", { title: "Test PM" })) as any;
    await ctx.rpc("task.assign", { taskId: t.id, agentId: a.id });
    const cp = (await ctx.rpc("checkpoint.create", { taskId: t.id, agentId: a.id, summary: "Init" })) as any;
    await ctx.rpc("capsule.create", { taskId: t.id, agentId: a.id, checkpointId: cp.id, goal: "Test" });

    const rc = (await ctx.rpc("resumeContext.get", { taskId: t.id, agentId: a.id }, "GET")) as any;
    expect(rc.projectMemories).toBeDefined();
    expect(rc.projectMemories.length).toBeGreaterThanOrEqual(1);
    expect(rc.projectMemories.some((m: any) => m.title === "Project Overview")).toBe(true);
    // Also appears in resume prompt text
    expect(rc.resumePrompt).toContain("Project Knowledge");
    expect(rc.resumePrompt).toContain("Project Overview");
  });

  it("deprecate removes from active context", async () => {
    const m = (await ctx.rpc("projectMemory.deprecate", { id: memId })) as any;
    expect(m.status).toBe("deprecated");

    const results = (await ctx.rpc("projectMemory.search", { query: "multi-agent" }, "GET")) as any[];
    expect(results.some((r: any) => r.id === memId)).toBe(false);
  });

  it("cannot approve deprecated memory", async () => {
    try {
      await ctx.rpc("projectMemory.approve", { id: memId });
      expect.fail("Should have thrown");
    } catch {
      // Expected
    }
  });

  it("create with different categories and scopes", async () => {
    const decision = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Use SQLite for local storage",
      content: "SQLite via better-sqlite3 is the single storage backend.",
      scope: "project",
      confidence: "high",
    })) as any;
    expect(decision.category).toBe("decision");
    expect(decision.confidence).toBe("high");

    const gotcha = (await ctx.rpc("projectMemory.create", {
      category: "gotcha",
      title: "Windows spawn EPERM",
      content: "Vitest on Windows may hit EPERM. Run with admin or adjust antivirus.",
      scope: "project",
    })) as any;
    expect(gotcha.category).toBe("gotcha");

    // Category filter
    const decisions = (await ctx.rpc("projectMemory.list", { category: "decision" }, "GET")) as any[];
    expect(decisions.some((m: any) => m.title.includes("SQLite"))).toBe(true);
  });
});
