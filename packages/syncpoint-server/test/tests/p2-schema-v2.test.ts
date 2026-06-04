/**
 * P2 Schema V2 Tests — kind, projectionTarget, severity, validity, appliesTo,
 * projection guard, export metadata, and normalized defaults.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "../../src/tests/e2e-helper.js";

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
      validatorType: "custom",
      appliesTo: { files: ["src/**/*.js"] },
      validity: { status: "fresh" },
    })) as any;
    expect(m.kind).toBe("hard_constraint");
    expect(m.projectionTarget).toBe("protocol_gate");
    expect(m.severity).toBe("blocking");
    expect(m.validityStatus).toBe("fresh");
    expect(m.appliesTo.files?.[0]).toContain("src/**/*.js");
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
  it("rejects hard_constraint targeting context_snapshot", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "Bad Projection HC",
        content: "This should fail.",
        createdBy: "test-user",
        kind: "hard_constraint",
        projectionTarget: "context_snapshot",
      });
      expect.fail("Should have thrown InvalidProjectionError");
    } catch (e: any) {
      expect(e.message || e.toString()).toContain("cannot project");
    }
  });

  it("rejects protocol_rule targeting context_snapshot", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "Bad Projection PR",
        content: "This should also fail.",
        createdBy: "test-user",
        kind: "protocol_rule",
        projectionTarget: "context_snapshot",
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

  it("allows fact targeting context_snapshot", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "Fact Context Snapshot P2",
      content: "Facts can go to context_snapshot.",
      createdBy: "test-user",
      kind: "fact",
      projectionTarget: "context_snapshot",
    })) as any;
    expect(m.projectionTarget).toBe("context_snapshot");
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

    // P4: blocking hard_constraint requires validatorType
    const updated = (await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      kind: "hard_constraint",
      severity: "blocking",
      validatorType: "custom",
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
  it("rejects update that changes kind to hard_constraint when existing target is context_snapshot", async () => {
    // Create with kind=fact, target=context_snapshot (valid)
    const m = (await ctx.rpc("projectMemory.create", {
      category: "overview",
      title: "P2 Guard Bypass Kind",
      content: "This is a fact targeting context_snapshot.",
      createdBy: "test-user",
      kind: "fact",
      projectionTarget: "context_snapshot",
    })) as any;
    // Now update kind to hard_constraint — should fail because final state is hard_constraint+context_snapshot
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

  it("rejects update that changes target to context_snapshot when existing kind is hard_constraint", async () => {
    // Create with kind=hard_constraint, target=protocol_gate (valid)
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P2 Guard Bypass Target",
      content: "This is a constraint targeting gate.",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
    })) as any;
    // Now update target to context_snapshot — should fail because final state is hard_constraint+context_snapshot
    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        updatedBy: "test-user",
        projectionTarget: "context_snapshot",
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
    // P4: blocking hard_constraint requires validatorType
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "Export V2 Metadata Test",
      content: "Must not use eval().",
      createdBy: "test-user",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      severity: "blocking",
      validatorType: "file_forbidden",
      appliesTo: { files: ["src/main.js"], modules: ["core"] },
    })) as any;
    await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });

    const result = (await ctx.rpc("projectMemory.export", {
      callerBy: "test-user",
    })) as any;

    expect(result.content).toContain("Kind: hard_constraint");
    expect(result.content).toContain("Severity: blocking");
    expect(result.content).toContain("Projection: protocol_gate");
    expect(result.content).toContain("src/main.js");
    expect(result.content).toContain("Modules: core");
  });
});

describe("P2: Normalized defaults when optional typed fields are omitted", () => {
  it("create without optional typed fields still gets normalized defaults", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "glossary",
      title: "Normalized Default Test",
      content: "Create without optional typed fields.",
      createdBy: "test-user",
    })) as any;
    expect(m.kind).toBe("fact");
    expect(m.severity).toBe("info");
    expect(m.validityStatus).toBe("fresh");
    expect(m.projectionTarget).toBeNull();
    expect(m.appliesTo).toEqual({});
  });

  it("get returns normalized typed fields on stored memories", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "architecture",
      title: "Normalized Get Test",
      content: "Architecture note.",
      createdBy: "test-user",
    })) as any;

    const fetched = (await ctx.rpc("projectMemory.get", { id: m.id }, "GET")) as any;
    expect(fetched.kind).toBe("fact");
    expect(fetched.severity).toBe("info");
    expect(fetched.validityStatus).toBe("fresh");
  });
});

// ── P4: Hard constraint validator policy ──────────────

describe("P4: Blocking hard_constraint requires validatorType", () => {
  it("rejects create of blocking hard_constraint without validatorType", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "P4 No Validator",
        content: "Block without validator.",
        createdBy: "test-user",
        kind: "hard_constraint",
        severity: "blocking",
        projectionTarget: "protocol_gate",
      });
      expect.fail("Should have thrown MissingValidatorError");
    } catch (e: any) {
      expect(e.message).toContain("requires a validatorType");
    }
  });

  it("allows create of blocking hard_constraint WITH validatorType", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P4 With Validator",
      content: "Block with validator.",
      createdBy: "test-user",
      kind: "hard_constraint",
      severity: "blocking",
      projectionTarget: "protocol_gate",
      validatorType: "file_forbidden",
      validatorConfig: { pattern: "src/legacy/**" },
    })) as any;
    expect(m.kind).toBe("hard_constraint");
    expect(m.severity).toBe("blocking");
    expect(m.validatorType).toBe("file_forbidden");
    expect(m.validatorConfig).toEqual({ pattern: "src/legacy/**" });
  });

  it("allows non-blocking hard_constraint without validatorType (advisory)", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P4 Advisory Constraint",
      content: "Advisory, not blocking.",
      createdBy: "test-user",
      kind: "hard_constraint",
      severity: "warning",
      projectionTarget: "protocol_gate",
    })) as any;
    expect(m.kind).toBe("hard_constraint");
    expect(m.severity).toBe("warning");
  });

  it("rejects update that makes hard_constraint blocking without validatorType", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P4 Update Escalation",
      content: "Start as warning.",
      createdBy: "test-user",
      kind: "hard_constraint",
      severity: "warning",
      projectionTarget: "protocol_gate",
    })) as any;

    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        updatedBy: "test-user",
        severity: "blocking",
      });
      expect.fail("Should have thrown MissingValidatorError");
    } catch (e: any) {
      expect(e.message).toContain("requires a validatorType");
    }
  });

  it("allows update to blocking when validatorType is provided simultaneously", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P4 Upgrade Valid",
      content: "Start as warning, upgrade to blocking.",
      createdBy: "test-user",
      kind: "hard_constraint",
      severity: "warning",
      projectionTarget: "protocol_gate",
    })) as any;

    const updated = (await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      severity: "blocking",
      validatorType: "require_review",
    })) as any;
    expect(updated.severity).toBe("blocking");
    expect(updated.validatorType).toBe("require_review");
  });

  it("rejects unknown validatorType on create", async () => {
    try {
      await ctx.rpc("projectMemory.create", {
        category: "decision",
        title: "P4 Unknown Validator",
        content: "Unknown validator type.",
        createdBy: "test-user",
        kind: "hard_constraint",
        severity: "blocking",
        projectionTarget: "protocol_gate",
        validatorType: "forbidden_file",
      });
      expect.fail("Should have thrown UnknownValidatorTypeError");
    } catch (e: any) {
      expect(e.message).toContain("Unknown validatorType");
      expect(e.message).toContain("forbidden_file");
    }
  });

  it("rejects unknown validatorType on update", async () => {
    const m = (await ctx.rpc("projectMemory.create", {
      category: "decision",
      title: "P4 Update Unknown Validator",
      content: "Start advisory.",
      createdBy: "test-user",
      kind: "hard_constraint",
      severity: "warning",
      projectionTarget: "protocol_gate",
    })) as any;

    try {
      await ctx.rpc("projectMemory.update", {
        id: m.id,
        updatedBy: "test-user",
        severity: "blocking",
        validatorType: "custom_rule",
      });
      expect.fail("Should have thrown UnknownValidatorTypeError");
    } catch (e: any) {
      expect(e.message).toContain("Unknown validatorType");
      expect(e.message).toContain("custom_rule");
    }
  });
});
