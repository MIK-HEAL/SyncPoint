/**
 * PR3 — Projection Cache integration tests.
 * Tests read-through cache behavior: hit, miss, invalidation, stats, eviction.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

async function getCacheStats(): Promise<any> {
  // Access cache stats via the service — we import dynamically to use the same module state
  const { getProjectionCacheStats } = await import("../application/reality-projection-service.ts");
  return getProjectionCacheStats();
}

async function clearCache(): Promise<void> {
  const { clearProjectionCache } = await import("../application/reality-projection-service.ts");
  clearProjectionCache();
}

describe("PR3: Projection Cache", () => {
  beforeEach(async () => {
    await clearCache();
  });

  it("first call is a cache miss, second call is a cache hit", async () => {
    // Seed a memory so projection has something
    await createAndApprove({ category: "overview", title: "PR3 cache test", content: "Test", kind: "fact" });

    const r1 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-1" }, "GET")) as any;
    const stats1 = await getCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.hits).toBe(0);

    const r2 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-1" }, "GET")) as any;
    const stats2 = await getCacheStats();
    expect(stats2.misses).toBe(1);
    expect(stats2.hits).toBe(1);

    // Same cacheKey → same projection
    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  it("memoryVersion bump triggers lazy invalidation", async () => {
    const r1 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-2" }, "GET")) as any;
    const stats1 = await getCacheStats();
    expect(stats1.misses).toBe(1);
    expect(stats1.invalidations).toBe(0);

    // Approve a task-scoped memory for a DIFFERENT task.
    // This bumps memoryVersion but does NOT change the collected fingerprints
    // for "cache-task-2" → same lookup key, different memoryVersion → invalidation.
    await createAndApprove({
      category: "convention", title: "Unrelated task rule", content: "Only for other task",
      kind: "fact", scope: "task", taskId: "other-task-999",
    });

    const r2 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-2" }, "GET")) as any;
    const stats2 = await getCacheStats();
    // cacheKey changes (memoryVersion is part of projection's own cacheKey)
    expect(r2.cacheKey).not.toBe(r1.cacheKey);
    // Lookup key is the same → old entry found → memoryVersion mismatch → invalidation
    expect(stats2.invalidations).toBeGreaterThanOrEqual(1);
    expect(stats2.misses).toBe(2);
  });

  it("different taskId = different cache key = separate miss", async () => {
    const r1 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-a" }, "GET")) as any;
    const r2 = (await ctx.rpc("projectMemory.projection", { taskId: "cache-task-b" }, "GET")) as any;
    const stats = await getCacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);
    // Different tasks may produce different cache keys
    // (they share the same memories but taskId is part of the key)
  });

  it("cache stats reflect hit/miss/invalidation counts", async () => {
    const initial = await getCacheStats();
    expect(initial.size).toBe(0);
    expect(initial.hits).toBe(0);
    expect(initial.misses).toBe(0);

    // Miss
    await ctx.rpc("projectMemory.projection", { taskId: "stats-task" }, "GET");
    const after1 = await getCacheStats();
    expect(after1.misses).toBe(1);
    expect(after1.size).toBe(1);

    // Hit
    await ctx.rpc("projectMemory.projection", { taskId: "stats-task" }, "GET");
    const after2 = await getCacheStats();
    expect(after2.hits).toBe(1);
    expect(after2.misses).toBe(1);
    expect(after2.size).toBe(1);
  });

  it("clearProjectionCache resets all stats", async () => {
    await ctx.rpc("projectMemory.projection", { taskId: "clear-task" }, "GET");
    await ctx.rpc("projectMemory.projection", { taskId: "clear-task" }, "GET");

    const before = await getCacheStats();
    expect(before.size).toBeGreaterThan(0);
    expect(before.hits).toBeGreaterThan(0);

    await clearCache();

    const after = await getCacheStats();
    expect(after.size).toBe(0);
    expect(after.hits).toBe(0);
    expect(after.misses).toBe(0);
    expect(after.evictions).toBe(0);
    expect(after.invalidations).toBe(0);
  });

  it("LRU eviction when cache exceeds max size", async () => {
    const { setProjectionCacheMaxSize } = await import("../application/reality-projection-service.ts");
    setProjectionCacheMaxSize(2);

    // Fill cache with 3 entries → should evict oldest
    await ctx.rpc("projectMemory.projection", { taskId: "evict-1" }, "GET");
    await ctx.rpc("projectMemory.projection", { taskId: "evict-2" }, "GET");
    await ctx.rpc("projectMemory.projection", { taskId: "evict-3" }, "GET");

    const stats = await getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(2);
    expect(stats.evictions).toBeGreaterThanOrEqual(1);

    // Restore default
    setProjectionCacheMaxSize(64);
  });
});
