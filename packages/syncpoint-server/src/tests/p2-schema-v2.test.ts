/**
 * P2 Schema V2 Tests — kind, projectionTarget, severity, validity, appliesTo,
 * projection guard, export metadata, backward compat.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("P2: V2 fields on create", () => {
  it("creates with explicit V2 fields", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Use TypeScript",
      content: "All code must be TypeScript.",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      severity: "blocking",
      appliesTo: { files: ["src/**/*.ts"] },
      validity: { status: "fresh" },
    })) as any;
    expect(m.kind).toBe("hard_constraint");
    expect(m.projectionTarget).toBe("protocol_gate");
    expect(m.severity).toBe("blocking");
    expect(m.validityStatus).toBe("fresh");
    const at = JSON.parse(m.appliesTo);
    expect(at.files).toEqual(["src/**/*.ts"]);
  });

  it("defaults kind from category when not provided", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "risk",
      title: "Deployment Risk P2",
      content: "Deployment might fail on Windows.",
      createdBy: "test-user",
    })) as any;
    expect(m.kind).toBe("risk");
  });

  it("defaults to fact for overview category", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Project Overview P2",
      content: "SyncPoint overview text.",
      createdBy: "test-user",
    })) as any;
    expect(m.kind).toBe("fact");
    expect(m.severity).toBe("info");
    expect(m.validityStatus).toBe("fresh");
  });

  it("defaults to soft_convention for convention category", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "convention",
      title: "Convention P2",
      content: "Use camelCase.",
      createdBy: "test-user",
    })) as any;
    expect(m.kind).toBe("soft_convention");
  });
});

describe("P2: Projection guard", () => {
  it("rejects hard_constraint targeting capsule", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "Bad Projection HC",
        content: "This should fail.",
        createdBy: "test-user",
        kind: "hard_constraint",
        projectionTarget: "capsule",
      });
      expect.fail("Should have thrown InvalidProjectionError");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("cannot project");
    }
  });

  it("rejects protocol_rule targeting capsule", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "Bad Projection PR",
        content: "This should also fail.",
        createdBy: "test-user",
        kind: "protocol_rule",
        projectionTarget: "capsule",
      });
      expect.fail("Should have thrown InvalidProjectionError");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("cannot project");
    }
  });

  it("allows hard_constraint targeting protocol_gate", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Good Projection HC",
      content: "This should succeed.",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
    })) as any;
    expect(m.projectionTarget).toBe("protocol_gate");
  });

  it("allows fact targeting capsule", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Fact Capsule P2",
      content: "Facts can go to capsule.",
      createdBy: "test-user",
      kind: "fact",
      projectionTarget: "capsule",
    })) as any;
    expect(m.projectionTarget).toBe("capsule");
  });
});

describe("P2: V2 fields on update", () => {
  it("updates V2 fields", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Update V2 Test",
      content: "Original.",
      createdBy: "test-user",
    })) as any;

    const updated = (await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      kind: "hard_constraint",
      severity: "blocking",
      validityStatus: "needs_revalidation",
      validityStaleReason: "New evidence found",
    })) as any;

    expect(updated.kind).toBe("hard_constraint");
    expect(updated.severity).toBe("blocking");
    expect(updated.validityStatus).toBe("needs_revalidation");
    expect(updated.validityStaleReason).toBe("New evidence found");
  });
});

describe("P2: Projection guard on update (merged validation)", () => {
  it("rejects update that changes kind to hard_constraint when existing target is capsule", async () => {
    // Create with kind=fact, target=capsule (valid)
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "P2 Guard Bypass Kind",
      content: "This is a fact targeting capsule.",
      createdBy: "test-user",
      kind: "fact",
      projectionTarget: "capsule",
    })) as any;
    // Now update kind to hard_constraint — should fail because final state is hard_constraint+capsule
    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        updatedBy: "test-user",
        kind: "hard_constraint",
      });
      expect.fail("Should have thrown InvalidProjectionError");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("cannot project");
    }
  });

  it("rejects update that changes target to capsule when existing kind is hard_constraint", async () => {
    // Create with kind=hard_constraint, target=protocol_gate (valid)
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P2 Guard Bypass Target",
      content: "This is a constraint targeting gate.",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
    })) as any;
    // Now update target to capsule — should fail because final state is hard_constraint+capsule
    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        updatedBy: "test-user",
        projectionTarget: "capsule",
      });
      expect.fail("Should have thrown InvalidProjectionError");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("cannot project");
    }
  });

  it("allows valid update changing kind when target is compatible", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "convention",
      title: "P2 Guard Valid Update",
      content: "Convention targeting gate.",
      createdBy: "test-user",
      kind: "soft_convention",
      projectionTarget: "protocol_gate",
    })) as any;
    // Change kind to hard_constraint — still valid with protocol_gate
    const updated = (await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      kind: "hard_constraint",
    })) as any;
    expect(updated.kind).toBe("hard_constraint");
  });
});

describe("P2: Export preserves V2 metadata", () => {
  it("export includes kind and severity in markdown", async () => {
    // Create a hard_constraint with blocking severity and approve it
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Export V2 Metadata Test",
      content: "Must not use eval().",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      severity: "blocking",
      appliesTo: { files: ["src/main.ts"], modules: ["core"] },
    })) as any;
    await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });

    const result = (await ctx.rpc("projectMemory.export", {
      callerBy: "test-user",
    })) as any;

    expect(result.content).toContain("Kind: hard_constraint");
    expect(result.content).toContain("Severity: blocking");
    expect(result.content).toContain("Projection: protocol_gate");
    expect(result.content).toContain("Files: src/main.ts");
    expect(result.content).toContain("Modules: core");
  });
});

describe("P2: Backward compatibility", () => {
  it("old-style create without V2 fields still works", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "glossary",
      title: "Backward Compat Test",
      content: "Legacy style create.",
      createdBy: "test-user",
    })) as any;
    expect(m.kind).toBe("fact");
    expect(m.severity).toBe("info");
    expect(m.validityStatus).toBe("fresh");
    expect(m.projectionTarget).toBeNull();
    expect(m.appliesTo).toBe("");
  });

  it("get returns V2 fields on legacy memories", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "architecture",
      title: "Legacy Get Test",
      content: "Architecture note.",
      createdBy: "test-user",
    })) as any;

    const fetched = (await ctx.rpc("projectMemory.get", { id: m.id }, "GET")) as any;
    expect(fetched.kind).toBe("fact");
    expect(fetched.severity).toBe("info");
    expect(fetched.validityStatus).toBe("fresh");
  });
});
