/**
 * P4A — Constraint Runtime tests.
 */

import { describe, it, expect } from "vitest";
import { evaluateConstraints } from "./constraint-runtime.js";
import { compileProjection } from "./projection.js";
import type { ProjectedReality, ProjectionInput, ProjectionContext, ProjectionItem, ProjectionSource } from "./projection.js";
import type { ConstraintInput } from "./constraint-runtime.js";

// ── Helpers ──────────────────────────────────────────────

function makeSource(id: string): ProjectionSource {
  return { sourceMemoryId: id, projectionReason: "test", confidence: "high" };
}

function makeItem(id: string, title: string, content: string, scope?: { files?: string[]; modules?: string[] }): ProjectionItem {
  return { source: makeSource(id), title, content, scope };
}

/** Create a do_not_touch constraint rule (dual-written with P4 enforcement reason). */
function makeDntRule(id: string, title: string, content: string, scope?: { files?: string[]; modules?: string[] }): ProjectionItem {
  return {
    source: { sourceMemoryId: id, projectionReason: "do_not_touch → constraintRules (P4 enforcement)", confidence: "high" },
    title, content, scope,
  };
}

function emptyProjection(overrides?: Partial<ProjectedReality>): ProjectedReality {
  return {
    projectionId: "prj_test",
    createdFrom: { taskId: "t1", memoryVersion: 1, generatedAt: new Date().toISOString() },
    cacheKey: "key",
    capsulePatch: { verifiedFacts: [], activeConstraints: [], risks: [], doNotTouch: [] },
    protocolRules: [],
    constraintRules: [],
    conflicts: [],
    projectionValidity: "fresh",
    skippedStale: [],
    ...overrides,
  };
}

function makeInput(overrides?: Partial<ConstraintInput>): ConstraintInput {
  return {
    action: "resume",
    projection: emptyProjection(),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────

describe("Constraint Runtime — evaluateConstraints", () => {

  // ── do_not_touch ───────────────────────────────────────

  it("do_not_touch + touchedFiles overlap => blocked", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_1", "Auth core", "Do not touch auth core", { files: ["src/auth/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["src/auth/session.ts"],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].rule).toBe("do_not_touch_file_overlap");
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_1");
    expect(decision.blockers[0].evidence).toContain("src/auth/session.ts");
  });

  it("do_not_touch + no overlap => permitted", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_1", "Auth core", "Do not touch auth core", { files: ["src/auth/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["src/ui/button.tsx"],
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("do_not_touch + no touchedFiles => permitted", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_1", "Auth core", "Do not touch auth core", { files: ["src/auth/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
  });

  it("do_not_touch with glob pattern matches nested file", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_2", "Database core", "Do not touch DB", { files: ["packages/db/**"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["packages/db/schema/users.sql"],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].evidence).toContain("packages/db/schema/users.sql");
  });

  // ── hard_constraint advisory ───────────────────────────

  it("hard_constraint without runtimeSpec => warning/advisory, not blocked", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeItem("pm_3", "Use TypeScript strict", "Always enable strict mode"),
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0].rule).toBe("hard_constraint_advisory");
    expect(decision.warnings[0].sourceMemoryId).toBe("pm_3");
  });

  it("hard_constraint existence alone does NOT block (multiple)", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeItem("pm_a", "Rule A", "Always do X"),
        makeItem("pm_b", "Rule B", "Always do Y"),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["src/foo.ts"],
    });
    expect(decision.permitted).toBe(true);
    expect(decision.warnings).toHaveLength(2);
  });

  // ── projection invalid ─────────────────────────────────

  it("invalid projection => blocked", () => {
    const proj = emptyProjection({ projectionValidity: "invalid" });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].rule).toBe("projection_invalid");
  });

  it("fresh projection => permitted", () => {
    const decision = evaluateConstraints(makeInput());
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("needs_revalidation projection => permitted (not blocked)", () => {
    const proj = emptyProjection({ projectionValidity: "needs_revalidation" });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
  });

  // ── projection conflict ────────────────────────────────

  it("projection conflict => blocked", () => {
    const proj = emptyProjection({
      conflicts: [{
        kind: "file_scope_collision",
        itemA: makeSource("pm_x"),
        itemB: makeSource("pm_y"),
        description: "Overlapping scope in auth module",
      }],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].rule).toBe("projection_conflict");
    expect(decision.blockers[0].evidence).toContain("pm_x");
    expect(decision.blockers[0].evidence).toContain("pm_y");
  });

  // ── violation traceability ─────────────────────────────

  it("violation includes sourceMemoryId and projectionId", () => {
    const proj = emptyProjection({
      projectionId: "prj_abc123",
      constraintRules: [
        makeDntRule("pm_42", "Protected API", "Do not touch API", { files: ["src/api/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["src/api/routes.ts"],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_42");
    expect(decision.blockers[0].projectionId).toBe("prj_abc123");
  });

  // ── protocol gate passthrough ──────────────────────────

  it("protocol gate blockers pass through as blockers", () => {
    const decision = evaluateConstraints({
      action: "resume",
      projection: emptyProjection(),
      protocolGateBlockers: ["Contract not approved", "Missing capsule"],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(2);
    expect(decision.blockers[0].rule).toBe("protocol_gate_blocked");
    expect(decision.blockers[1].rule).toBe("protocol_gate_blocked");
  });

  // ── capsule locked mode ────────────────────────────────

  it("capsuleValid = false => blocked", () => {
    const decision = evaluateConstraints({
      action: "resume",
      projection: emptyProjection(),
      capsuleValid: false,
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("capsule_locked_invalid");
  });

  it("capsuleValid = true => permitted", () => {
    const decision = evaluateConstraints({
      action: "resume",
      projection: emptyProjection(),
      capsuleValid: true,
    });
    expect(decision.permitted).toBe(true);
  });

  // ── combined scenario ──────────────────────────────────

  it("multiple blockers combine", () => {
    const proj = emptyProjection({
      projectionValidity: "invalid",
      conflicts: [{
        kind: "file_scope_collision",
        itemA: makeSource("a"),
        itemB: makeSource("b"),
        description: "scope collision",
      }],
      constraintRules: [
        makeDntRule("pm_99", "Core", "No touch", { files: ["src/core/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "patch_submit",
      projection: proj,
      touchedFiles: ["src/core/engine.ts"],
      capsuleValid: false,
      protocolGateBlockers: ["Gate block"],
    });
    expect(decision.permitted).toBe(false);
    // projection_invalid + projection_conflict + do_not_touch + protocol_gate + capsule_locked
    expect(decision.blockers.length).toBeGreaterThanOrEqual(5);
  });

  it("empty projection + no constraints => permitted with no warnings", () => {
    const decision = evaluateConstraints(makeInput());
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    expect(decision.warnings).toHaveLength(0);
  });
});

// ── Projection dual-write integration ────────────────────

describe("Projection dual-write — do_not_touch enters constraintRules", () => {

  function makeMemory(overrides: Partial<ProjectionInput>): ProjectionInput {
    return {
      id: "mem_1",
      category: "architecture",
      title: "Test",
      content: "Test content",
      fingerprint: "fp_1",
      kind: "fact",
      projectionTarget: null,
      appliesTo: "",
      severity: "blocking",
      validityStatus: "valid",
      ...overrides,
    };
  }

  const ctx: ProjectionContext = {
    taskId: "t1",
    memoryVersion: 1,
  };

  it("do_not_touch memory appears in both doNotTouch and constraintRules", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_dnt",
        kind: "do_not_touch",
        title: "Auth Core",
        content: "Do not touch authentication",
        appliesTo: JSON.stringify({ files: ["src/auth/"] }),
      }),
    ], { ...ctx, workingFiles: ["src/auth/session.ts"] });

    expect(projection.capsulePatch.doNotTouch).toHaveLength(1);
    expect(projection.capsulePatch.doNotTouch[0].title).toBe("Auth Core");
    expect(projection.capsulePatch.doNotTouch[0].scope?.files).toEqual(["src/auth/"]);

    // Dual-write: also in constraintRules
    expect(projection.constraintRules.some(
      cr => cr.source.sourceMemoryId === "pm_dnt" && cr.source.projectionReason.includes("P4 enforcement"),
    )).toBe(true);
  });

  it("hard_constraint enters constraintRules only (not doNotTouch)", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_hc",
        kind: "hard_constraint",
        title: "Use strict TS",
        content: "Always use strict TypeScript",
      }),
    ], ctx);

    expect(projection.constraintRules).toHaveLength(1);
    expect(projection.constraintRules[0].title).toBe("Use strict TS");
    expect(projection.capsulePatch.doNotTouch).toHaveLength(0);
  });

  it("do_not_touch dual-write carries scope to constraintRules entry", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_scoped",
        kind: "do_not_touch",
        title: "DB Schema",
        content: "Do not touch DB schema",
        appliesTo: JSON.stringify({ files: ["db/schema/"], modules: ["database"] }),
      }),
    ], { ...ctx, workingFiles: ["db/schema/users.sql"] });

    const crEntry = projection.constraintRules.find(
      cr => cr.source.sourceMemoryId === "pm_scoped",
    );
    expect(crEntry).toBeDefined();
    expect(crEntry!.scope?.files).toEqual(["db/schema/"]);
    expect(crEntry!.scope?.modules).toEqual(["database"]);
  });

  it("ProjectionItem carries scope from appliesTo", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_fact",
        kind: "fact",
        title: "Scoped fact",
        content: "Some fact",
        appliesTo: JSON.stringify({ files: ["src/utils/"], modules: ["utils"] }),
      }),
    ], { ...ctx, workingFiles: ["src/utils/helpers.ts"] });

    expect(projection.capsulePatch.verifiedFacts).toHaveLength(1);
    expect(projection.capsulePatch.verifiedFacts[0].scope?.files).toEqual(["src/utils/"]);
    expect(projection.capsulePatch.verifiedFacts[0].scope?.modules).toEqual(["utils"]);
  });

  it("ProjectionItem without appliesTo has no scope", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_unscoped",
        kind: "fact",
        title: "Global fact",
        content: "Applies everywhere",
      }),
    ], ctx);

    expect(projection.capsulePatch.verifiedFacts[0].scope).toBeUndefined();
  });
});

// ── End-to-end: projection + runtime ─────────────────────

describe("E2E: compileProjection → evaluateConstraints", () => {

  function makeMemory(overrides: Partial<ProjectionInput>): ProjectionInput {
    return {
      id: "mem_1",
      category: "architecture",
      title: "Test",
      content: "Test content",
      fingerprint: "fp_1",
      kind: "fact",
      projectionTarget: null,
      appliesTo: "",
      severity: "blocking",
      validityStatus: "valid",
      ...overrides,
    };
  }

  const ctx: ProjectionContext = {
    taskId: "t1",
    memoryVersion: 1,
  };

  it("do_not_touch file overlap blocks patch via full pipeline", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_protect",
        kind: "do_not_touch",
        title: "Protected Auth",
        content: "Never modify auth core",
        fingerprint: "fp_protect",
        appliesTo: JSON.stringify({ files: ["src/auth/"] }),
      }),
    ], { ...ctx, workingFiles: ["src/auth/login.ts"] });

    const decision = evaluateConstraints({
      action: "patch_submit",
      projection,
      touchedFiles: ["src/auth/login.ts"],
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("do_not_touch_file_overlap");
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_protect");
    expect(decision.blockers[0].evidence).toContain("src/auth/login.ts");
  });

  it("hard_constraint alone permits with advisory warning", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_strict",
        kind: "hard_constraint",
        title: "Use strict mode",
        content: "TypeScript strict enabled",
        fingerprint: "fp_strict",
      }),
    ], ctx);

    const decision = evaluateConstraints({
      action: "resume",
      projection,
    });

    expect(decision.permitted).toBe(true);
    expect(decision.warnings.some(w => w.rule === "hard_constraint_advisory")).toBe(true);
  });

  it("non-overlapping do_not_touch permits patch", () => {
    const projection = compileProjection([
      makeMemory({
        id: "pm_db",
        kind: "do_not_touch",
        title: "DB Layer",
        content: "Do not modify database layer",
        fingerprint: "fp_db",
        appliesTo: JSON.stringify({ files: ["src/db/"] }),
      }),
    ], { ...ctx, workingFiles: ["src/db/schema.ts"] });

    const decision = evaluateConstraints({
      action: "patch_submit",
      projection,
      touchedFiles: ["src/ui/component.tsx"],
    });

    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });
});
