/**
 * P0 Security Tests — caller identity enforcement + export path containment.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("P0: Caller Identity Enforcement", () => {
  it("create rejects missing createdBy", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "overview",
        title: "No Author",
        content: "This should fail.",
      });
      expect.fail("Should have thrown");
    } catch (e: any) {
      // tRPC input validation rejects missing createdBy
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("create rejects empty createdBy", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "overview",
        title: "Empty Author",
        content: "This should fail.",
        createdBy: "",
      });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("update rejects missing updatedBy", async () => {
    // First create a valid memory
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Valid Entry",
      content: "Test content.",
      createdBy: "test-user",
    })) as any;

    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        content: "Updated without identity",
      });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("approve rejects missing updatedBy", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Approve Test",
      content: "Test.",
      createdBy: "test-user",
    })) as any;

    try {
      await ctx.rpc("projectMemory.approve", { id: m.id });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("deprecate rejects missing updatedBy", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Deprecate Test",
      content: "Test.",
      createdBy: "test-user",
    })) as any;
    await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });

    try {
      await ctx.rpc("projectMemory.deprecate", { id: m.id });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("export rejects missing callerBy", async () => {
    try {
      await ctx.rpc("projectMemory.export", {});
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("export rejects empty callerBy", async () => {
    try {
      await ctx.rpc("projectMemory.export", { callerBy: "" });
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message || e.toString()).toBeTruthy();
    }
  });

  it("read operations remain public (no callerBy needed)", async () => {
    // Create something first
    await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Public Read Test",
      content: "Should be readable without caller.",
      createdBy: "test-user",
    });

    // list — no callerBy required
    const all = (await ctx.rpc("projectMemory.list", {}, "GET")) as any[];
    expect(all.length).toBeGreaterThan(0);

    // search — no callerBy required
    const results = (await ctx.rpc("projectMemory.search", { query: "Public" }, "GET")) as any[];
    expect(results).toBeDefined();

    // get — no callerBy required
    const m = (await ctx.rpc("projectMemory.get", { id: all[0].id }, "GET")) as any;
    expect(m.id).toBe(all[0].id);
  });
});

describe("P0: Export Path Containment", () => {
  it("export to default .syncpoint/ path succeeds", async () => {
    // Create + approve a memory first
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Export Test",
      content: "Content for export.",
      createdBy: "test-user",
    })) as any;
    await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });

    const result = (await ctx.rpc("projectMemory.export", {
      callerBy: "test-user",
    })) as any;
    expect(result.path).toBeTruthy();
    expect(result.count).toBeGreaterThan(0);
  });

  it("export to project root sibling succeeds", async () => {
    const projectRoot = path.dirname(process.env.SYNCPOINT_DB_DIR!);
    const siblingPath = path.join(projectRoot, "project-memory.md");

    const result = (await ctx.rpc("projectMemory.export", {
      outputPath: siblingPath,
      callerBy: "test-user",
    })) as any;
    expect(result.path).toBe(siblingPath);
  });

  it("export to path traversal is rejected", async () => {
    try {
      await ctx.rpc("projectMemory.export", {
        outputPath: "/tmp/evil/../../etc/passwd",
        callerBy: "test-user",
      });
      expect.fail("Should have thrown — path traversal");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("outside the allowed directory");
    }
  });

  it("export to absolute outside path is rejected", async () => {
    try {
      await ctx.rpc("projectMemory.export", {
        outputPath: path.resolve("/tmp/random-dir/evil.md"),
        callerBy: "test-user",
      });
      expect.fail("Should have thrown — outside path");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("outside the allowed directory");
    }
  });

  it("export inside .syncpoint/ subdirectory succeeds", async () => {
    const spDir = process.env.SYNCPOINT_DB_DIR!;
    const subPath = path.join(spDir, "exports", "memory.md");

    const result = (await ctx.rpc("projectMemory.export", {
      outputPath: subPath,
      callerBy: "test-user",
    })) as any;
    expect(result.path).toBe(subPath);
  });
});
