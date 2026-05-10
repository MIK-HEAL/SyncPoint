/**
 * P3A — Projection Service integration tests.
 * Tests buildProjection through tRPC, verifying end-to-end:
 *   kind→bucket, appliesTo filter, validity gate, conflict, cacheKey stability.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

async function createAndApprove(fields: Record<string, unknown>) {
  const m = (await ctx.rpc("projectMemory.create", {
    createdBy: "test-user",
    ...fields,
  })) as any;
  await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });
  return m;
}

describe("P3A: Projection — kind→bucket mapping", () => {
  it("projects approved memories into correct buckets", async () => {
    await createAndApprove({ category: "overview", title: "P3A fact", content: "A fact", kind: "fact" });
    await createAndApprove({ category: "convention", title: "P3A conv", content: "A convention", kind: "soft_convention" });
    await createAndApprove({ category: "risk", title: "P3A risk", content: "A risk", kind: "risk" });
    await createAndApprove({ category: "gotcha", title: "P3A dnt", content: "Dont touch", kind: "do_not_touch" });
    await createAndApprove({ category: "decision", title: "P3A hc", content: "Hard constraint", kind: "hard_constraint", projectionTarget: "protocol_gate" });
    await createAndApprove({ category: "decision", title: "P3A pr", content: "Protocol rule", kind: "protocol_rule", projectionTarget: "protocol_gate" });

    const r = (await ctx.rpc("projectMemory.projection", { taskId: "task-1" }, "GET")) as any;

    expect(r.contextPatch.verifiedFacts.length).toBeGreaterThanOrEqual(1);
    expect(r.contextPatch.activeConstraints.length).toBeGreaterThanOrEqual(1);
    expect(r.contextPatch.risks.length).toBeGreaterThanOrEqual(1);
    expect(r.contextPatch.doNotTouch.length).toBeGreaterThanOrEqual(1);
    expect(r.constraintRules.length).toBeGreaterThanOrEqual(1);
    expect(r.protocolRules.length).toBeGreaterThanOrEqual(1);
  });
});

describe("P3A: Projection — traceability", () => {
  it("every projected item has sourceMemoryId and projectionReason", async () => {
    const r = (await ctx.rpc("projectMemory.projection", { taskId: "task-1" }, "GET")) as any;

    for (const item of r.contextPatch.verifiedFacts) {
      expect(item.source.sourceMemoryId).toBeTruthy();
      expect(item.source.projectionReason).toBeTruthy();
    }
    for (const item of r.constraintRules) {
      expect(item.source.sourceMemoryId).toBeTruthy();
    }
  });

  it("createdFrom contains taskId and memoryVersion", async () => {
    const r = (await ctx.rpc("projectMemory.projection", { taskId: "task-1" }, "GET")) as any;
    expect(r.createdFrom.taskId).toBe("task-1");
    expect(r.createdFrom.memoryVersion).toBeGreaterThanOrEqual(0);
    expect(r.createdFrom.generatedAt).toBeTruthy();
  });

  it("projectionId is present", async () => {
    const r = (await ctx.rpc("projectMemory.projection", { taskId: "task-1" }, "GET")) as any;
    expect(r.projectionId).toBeTruthy();
    expect(r.projectionId.length).toBeGreaterThan(0);
  });
});

describe("P3A: Projection — appliesTo filtering", () => {
  it("excludes memories scoped to non-matching files", async () => {
    await createAndApprove({
      category: "decision",
      title: "P3A file-scoped",
      content: "Only for test dir",
      kind: "fact",
      appliesTo: { files: ["test/**"] },
    });

    const r = (await ctx.rpc("projectMemory.projection", {
      taskId: "task-1",
      workingResources: ["src/main.ts"],
    }, "GET")) as any;

    const titles = r.contextPatch.verifiedFacts.map((i: any) => i.title);
    expect(titles).not.toContain("P3A file-scoped");
  });

  it("includes memories scoped to matching files", async () => {
    await createAndApprove({
      category: "decision",
      title: "P3A src-scoped",
      content: "For src dir",
      kind: "fact",
      appliesTo: { files: ["src/**"] },
    });

    const r = (await ctx.rpc("projectMemory.projection", {
      taskId: "task-1",
      workingResources: ["src/main.ts"],
    }, "GET")) as any;

    const titles = r.contextPatch.verifiedFacts.map((i: any) => i.title);
    expect(titles).toContain("P3A src-scoped");
  });
});

describe("P3A: Projection — validity gating", () => {
  it("stale memories are skipped, not projected", async () => {
    const m = await createAndApprove({
      category: "decision",
      title: "P3A stale mem",
      content: "This is stale",
      kind: "fact",
    });
    // Mark as stale via update
    await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      validityStatus: "stale",
      validityStaleReason: "outdated evidence",
    });

    const r = (await ctx.rpc("projectMemory.projection", { taskId: "task-1" }, "GET")) as any;

    const factTitles = r.contextPatch.verifiedFacts.map((i: any) => i.title);
    expect(factTitles).not.toContain("P3A stale mem");
    expect(r.skippedStale.some((s: any) => s.sourceMemoryId === m.id)).toBe(true);
  });
});

describe("P3A: Projection — cacheKey stability", () => {
  it("same inputs produce same cacheKey", async () => {
    const r1 = (await ctx.rpc("projectMemory.projection", { taskId: "task-stable" }, "GET")) as any;
    const r2 = (await ctx.rpc("projectMemory.projection", { taskId: "task-stable" }, "GET")) as any;
    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  it("memoryVersion change alters cacheKey", async () => {
    const r1 = (await ctx.rpc("projectMemory.projection", { taskId: "task-cache" }, "GET")) as any;

    // Create + approve a new memory (bumps memoryVersion via approve)
    await createAndApprove({
      category: "decision",
      title: "P3A cache bump",
      content: "New memory for cache test",
      kind: "fact",
    });

    const r2 = (await ctx.rpc("projectMemory.projection", { taskId: "task-cache" }, "GET")) as any;
    expect(r2.cacheKey).not.toBe(r1.cacheKey);
  });
});

describe("P3A: Projection — read-only", () => {
  it("projection does not modify any memories", async () => {
    const before = (await ctx.rpc("projectMemory.list", {}, "GET")) as any[];
    await ctx.rpc("projectMemory.projection", { taskId: "task-ro" }, "GET");
    const after = (await ctx.rpc("projectMemory.list", {}, "GET")) as any[];
    expect(after.length).toBe(before.length);
  });
});
