/**
 * P0 Security Tests — authorization, caller identity enforcement, export path containment.
 *
 * P0 Hardening: protectedProcedure requires x-caller-id header.
 * Tests verify unauthenticated callers are rejected, authenticated callers succeed,
 * and audit fields are derived from context.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { startE2E, type E2EContext } from "./e2e-helper.ts";
import { authorize, type TRPCContext } from "../../src/routers/_trpc.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("P0: Unauthenticated callers cannot mutate", () => {
  // Pass empty string to bypass default callerId; trpcFetch won't send header for falsy callerId
  const NO_AUTH = "";

  it("create rejects without x-caller-id header", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "overview",
        title: "No Auth",
        content: "This should fail.",
      }, undefined, /* callerId */ NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("update rejects without x-caller-id header", async () => {
    // Create with auth first
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Valid Entry",
      content: "Test content.",
    })) as any;

    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        content: "Updated without identity",
      }, undefined, NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("approve rejects without x-caller-id header", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Approve Test No Auth",
      content: "Test.",
    })) as any;

    try {
      await ctx.rpc("projectMemory.approve", { id: m.id }, undefined, NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("deprecate rejects without x-caller-id header", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Deprecate Test No Auth",
      content: "Test.",
    })) as any;
    await ctx.rpc("projectMemory.approve", { id: m.id });

    try {
      await ctx.rpc("projectMemory.deprecate", { id: m.id }, undefined, NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("export rejects without x-caller-id header", async () => {
    try {
      await ctx.rpc("projectMemory.export", {}, undefined, NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("supersede rejects without x-caller-id header", async () => {
    try {
      await ctx.rpc("projectMemory.supersede", {
        newId: "fake-new",
        oldId: "fake-old",
      }, undefined, NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });

  it("projection rejects without x-caller-id header", async () => {
    try {
      await ctx.rpc("projectMemory.projection", { taskId: "t-1" }, "GET", NO_AUTH);
      expect.fail("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("Authentication required");
    }
  });
});

describe("P0: Authenticated callers succeed and audit fields are derived", () => {
  it("create derives createdBy from context", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Auth Create",
      content: "Created with auth.",
    }, undefined, "auth-user-1")) as any;
    expect(m.createdBy).toBe("auth-user-1");
  });

  it("update derives updatedBy from context", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Auth Update",
      content: "To update.",
    }, undefined, "auth-user-1")) as any;
    const updated = (await ctx.rpc("projectMemory.update", {
      id: m.id,
      content: "Updated content.",
    }, undefined, "auth-user-2")) as any;
    expect(updated.updatedBy).toBe("auth-user-2");
  });

  it("approve derives updatedBy from context", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Auth Approve",
      content: "To approve.",
    })) as any;
    const approved = (await ctx.rpc("projectMemory.approve", { id: m.id }, undefined, "approver-1")) as any;
    expect(approved.updatedBy).toBe("approver-1");
    expect(approved.status).toBe("approved");
  });
});

describe("P0: Agent Token validation", () => {
  it("invalid token is rejected with UNAUTHORIZED", async () => {
    // Set a shared secret so token validation is enforced
    process.env.SYNCPOINT_SHARED_SECRET = "test-secret-123";
    try {
      // Provide caller-id but with a wrong token
      const result = ctx.rpc("projectMemory.create", {
        category: "overview",
        title: "Token Test",
        content: "Should fail with bad token.",
      }, undefined, { callerId: "agent-1", agentToken: "wrong-token" });
      await expect(result).rejects.toThrow("Invalid agent token");
    } finally {
      delete process.env.SYNCPOINT_SHARED_SECRET;
    }
  });

  it("valid token with caller-id succeeds", async () => {
    process.env.SYNCPOINT_SHARED_SECRET = "test-secret-123";
    try {
      const m = await ctx.rpc("projectMemory.create", {
        category: "overview",
        title: "Valid Token",
        content: "Should succeed with valid token.",
      }, undefined, { callerId: "agent-1", agentToken: "test-secret-123" }) as any;
      expect(m.createdBy).toBe("agent-1");
    } finally {
      delete process.env.SYNCPOINT_SHARED_SECRET;
    }
  });

  it("no token with caller-id succeeds when no shared secret configured", async () => {
    // Without SYNCPOINT_SHARED_SECRET, any non-empty token is accepted
    const m = await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "No Token No Secret",
      content: "Should succeed.",
    }, undefined, "agent-no-token") as any;
    expect(m.createdBy).toBe("agent-no-token");
  });
});

describe("P0: authorize() role enforcement", () => {
  it("agent cannot createConstraint", () => {
    const agentCtx: TRPCContext = { callerId: "agent-1", callerRole: "agent", callerToken: null };
    expect(() => authorize(agentCtx, "createConstraint")).toThrow("not authorized");
  });

  it("admin can createConstraint", () => {
    const adminCtx: TRPCContext = { callerId: "admin-1", callerRole: "admin", callerToken: null };
    expect(() => authorize(adminCtx, "createConstraint")).not.toThrow();
  });

  it("non-owner agent cannot releaseResource owned by another", () => {
    const agentCtx: TRPCContext = { callerId: "agent-1", callerRole: "agent", callerToken: null };
    expect(() => authorize(agentCtx, "releaseResource", "agent-2")).toThrow("Only the resource owner");
  });

  it("owner can releaseResource owned by themselves", () => {
    const agentCtx: TRPCContext = { callerId: "agent-1", callerRole: "agent", callerToken: null };
    expect(() => authorize(agentCtx, "releaseResource", "agent-1")).not.toThrow();
  });

  it("admin can releaseResource owned by anyone", () => {
    const adminCtx: TRPCContext = { callerId: "admin-1", callerRole: "admin", callerToken: null };
    expect(() => authorize(adminCtx, "releaseResource", "agent-2")).not.toThrow();
  });

  it("undefined operation is rejected (default-deny)", () => {
    const adminCtx: TRPCContext = { callerId: "admin-1", callerRole: "admin", callerToken: null };
    expect(() => authorize(adminCtx, "someUnknownOperation")).toThrow("not authorized");
  });
});

describe("P0: Read operations remain public", () => {
  it("list does not require x-caller-id", async () => {
    // Ensure at least one memory exists
    await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Public Read Test",
      content: "Should be readable without caller.",
    });

    // list — no callerId
    const all = (await ctx.rpc("projectMemory.list", {}, "GET", undefined as any)) as any[];
    expect(all.length).toBeGreaterThan(0);
  });

  it("search does not require x-caller-id", async () => {
    const results = (await ctx.rpc("projectMemory.search", { query: "Public" }, "GET", undefined as any)) as any[];
    expect(results).toBeDefined();
  });

  it("get does not require x-caller-id", async () => {
    const all = (await ctx.rpc("projectMemory.list", {}, "GET", undefined as any)) as any[];
    const m = (await ctx.rpc("projectMemory.get", { id: all[0].id }, "GET", undefined as any)) as any;
    expect(m.id).toBe(all[0].id);
  });

  it("version does not require x-caller-id", async () => {
    const v = (await ctx.rpc("projectMemory.version", undefined, "GET", undefined as any)) as any;
    expect(v.memoryVersion).toBeDefined();
  });

  it("checkDuplicate does not require x-caller-id", async () => {
    const r = (await ctx.rpc("projectMemory.checkDuplicate", {
      category: "overview",
      title: "nonexistent",
      content: "xyz",
    }, "GET", undefined as any)) as any;
    expect(r).toBeDefined();
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
