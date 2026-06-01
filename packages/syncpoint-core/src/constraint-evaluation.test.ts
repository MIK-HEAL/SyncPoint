/**
 * Constraint Evaluation tests.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateConstraints,
  buildConstraintManifest,
  resolveRuntimeSpec,
  registerConstraintEvaluator,
  clearConstraintEvaluatorRegistry,
} from "./constraint-evaluation.js";
import type { ConstraintInput, ConstraintViolation } from "./constraint-evaluation.js";
import { buildRealityProjection, registerScopeMatcher, clearScopeMatcherRegistry } from "./reality-projection.js";
import type { RealityProjection, MemoryProjectionInput, ProjectionContext, ProjectedMemoryItem, ProjectionSource } from "./reality-projection.js";
import type { ResourceRef } from "./resource.js";

/** Convert locator strings to ResourceRef[] for testing. */
function toRefs(...locators: string[]): ResourceRef[] {
  return locators.map(loc => ({ type: "test", locator: loc, metadata: "" }));
}

// ── Test scope matcher (prefix/glob, generic test helper) ─────

function prefixFindOverlaps(patterns: string[], targets: string[]): string[] {
  return targets.filter(t =>
    patterns.some(p => {
      const prefix = p.replace(/\*\*?\/?$/, "");
      return t === p || t.startsWith(prefix);
    }),
  );
}

// ── Setup: register test scope matchers + generic test evaluator ──
// Core tests use a generic "test_forbidden" evaluator to prove the dispatch
// mechanism. Real file_forbidden/module_forbidden evaluators live in
// syncpoint-plugin-code.

beforeEach(() => {
  clearScopeMatcherRegistry();
  clearConstraintEvaluatorRegistry();

  // Register scope matchers for testing (in production, code plugin does this)
  registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps });
  registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps });

  // Register generic test_forbidden evaluator — proves dispatch works
  registerConstraintEvaluator({
    ruleType: "test_forbidden",
    evaluate(input, item, spec): ConstraintViolation | null {
      const locators = (input.touchedResources ?? []).map(r => r.locator);
      if (!locators.length) return null;
      // Check all scope fields for overlaps
      const allOverlaps: string[] = [];
      for (const [field, patterns] of Object.entries(item.scope ?? {})) {
        if (!patterns?.length) continue;
        allOverlaps.push(...prefixFindOverlaps(patterns, locators));
      }
      if (allOverlaps.length === 0) return null;
      return {
        rule: "hard_constraint_test_forbidden",
        sourceMemoryId: item.source.sourceMemoryId,
        projectionId: input.projection.projectionId,
        message: spec.message ?? `Constraint "${item.title}" forbids resources: ${allOverlaps.join(", ")}`,
        evidence: allOverlaps,
      };
    },
  });
});

// ── Helpers ──────────────────────────────────────────────

function makeSource(id: string): ProjectionSource {
  return { sourceMemoryId: id, projectionReason: "test", confidence: "high" };
}

function makeItem(id: string, title: string, content: string, scope?: { files?: string[]; modules?: string[] }): ProjectedMemoryItem {
  return { source: makeSource(id), title, content, scope };
}

/** Create a do_not_touch constraint rule (dual-written with P4 enforcement reason). */
function makeDntRule(id: string, title: string, content: string, scope?: { files?: string[]; modules?: string[] }): ProjectedMemoryItem {
  return {
    source: { sourceMemoryId: id, projectionReason: "do_not_touch → constraintRules (P4 enforcement)", confidence: "high" },
    title, content, scope,
  };
}

function emptyProjection(overrides?: Partial<RealityProjection>): RealityProjection {
  return {
    projectionId: "prj_test",
    createdFrom: { taskId: "t1", memoryVersion: 1, generatedAt: new Date().toISOString() },
    cacheKey: "key",
    contextPatch: { verifiedFacts: [], activeConstraints: [], risks: [], doNotTouch: [] },
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

  it("do_not_touch + touchedResources overlap => blocked", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_1", "Auth core", "Do not touch auth core", { files: ["src/auth/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/auth/session.ts"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].rule).toBe("do_not_touch_scope_overlap");
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
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/ui/button.tsx"),
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("do_not_touch + no touchedResources => permitted", () => {
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
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("packages/db/schema/users.sql"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].evidence).toContain("packages/db/schema/users.sql");
  });

  // ── do_not_touch resource-type filtering ─────────────────

  it("do_not_touch with resourceTypes filter skips non-matching resources", () => {
    // Re-register "files" matcher WITH resourceTypes: ["file"]
    clearScopeMatcherRegistry();
    registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });
    registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });

    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_rt", "Auth core", "Do not touch auth", { files: ["src/auth/"] }),
      ],
    });

    // binary_asset with overlapping locator text should NOT trigger
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [{ type: "binary_asset", locator: "src/auth/logo.png", metadata: "" }],
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("do_not_touch with resourceTypes filter still blocks matching type", () => {
    clearScopeMatcherRegistry();
    registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });

    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_rt2", "Auth core", "Do not touch auth", { files: ["src/auth/"] }),
      ],
    });

    // file type DOES trigger
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [{ type: "file", locator: "src/auth/session.ts", metadata: "" }],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].evidence).toContain("src/auth/session.ts");
  });

  it("do_not_touch with mixed resource types only blocks matching types", () => {
    clearScopeMatcherRegistry();
    registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });

    const proj = emptyProjection({
      constraintRules: [
        makeDntRule("pm_rt3", "Auth core", "Do not touch auth", { files: ["src/auth/"] }),
      ],
    });

    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [
        { type: "file", locator: "src/auth/session.ts", metadata: "" },
        { type: "binary_asset", locator: "src/auth/logo.png", metadata: "" },
      ],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    // Only the file resource appears in evidence, not the binary_asset
    expect(decision.blockers[0].evidence).toEqual(["src/auth/session.ts"]);
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
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/foo.ts"),
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
        kind: "scope_collision",
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
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/api/routes.ts"),
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
      protocolGateBlockers: ["Contract not approved", "Missing snapshot"],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(2);
    expect(decision.blockers[0].rule).toBe("protocol_gate_blocked");
    expect(decision.blockers[1].rule).toBe("protocol_gate_blocked");
  });

  // ── snapshot locked mode ────────────────────────────────

  it("snapshotValid = false => blocked", () => {
    const decision = evaluateConstraints({
      action: "resume",
      projection: emptyProjection(),
      snapshotValid: false,
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("snapshot_locked_invalid");
  });

  it("snapshotValid = true => permitted", () => {
    const decision = evaluateConstraints({
      action: "resume",
      projection: emptyProjection(),
      snapshotValid: true,
    });
    expect(decision.permitted).toBe(true);
  });

  // ── combined scenario ──────────────────────────────────

  it("multiple blockers combine", () => {
    const proj = emptyProjection({
      projectionValidity: "invalid",
      conflicts: [{
        kind: "scope_collision",
        itemA: makeSource("a"),
        itemB: makeSource("b"),
        description: "scope collision",
      }],
      constraintRules: [
        makeDntRule("pm_99", "Core", "No touch", { files: ["src/core/"] }),
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/core/engine.ts"),
      snapshotValid: false,
      protocolGateBlockers: ["Gate block"],
    });
    expect(decision.permitted).toBe(false);
    // projection_invalid + projection_conflict + do_not_touch + protocol_gate + snapshot_locked
    expect(decision.blockers.length).toBeGreaterThanOrEqual(5);
  });

  it("empty projection + no constraints => permitted with no warnings", () => {
    const decision = evaluateConstraints(makeInput());
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    expect(decision.warnings).toHaveLength(0);
  });
});

// ── Projection routing integration ────────────────────

describe("Projection routing — do_not_touch and constraintRules", () => {

  function makeMemory(overrides: Partial<MemoryProjectionInput>): MemoryProjectionInput {
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

  it("do_not_touch memory appears in doNotTouch only (no dual-write)", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_dnt",
        kind: "do_not_touch",
        title: "Auth Core",
        content: "Do not touch authentication",
        appliesTo: JSON.stringify({ files: ["src/auth/"] }),
      }),
    ], { ...ctx, workingResources: ["src/auth/session.ts"] });

    expect(projection.contextPatch.doNotTouch).toHaveLength(1);
    expect(projection.contextPatch.doNotTouch[0].title).toBe("Auth Core");
    expect(projection.contextPatch.doNotTouch[0].scope?.files).toEqual(["src/auth/"]);

    // No dual-write: not in constraintRules
    expect(projection.constraintRules.some(
      cr => cr.source.sourceMemoryId === "pm_dnt",
    )).toBe(false);
  });

  it("hard_constraint enters constraintRules only (not doNotTouch)", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_hc",
        kind: "hard_constraint",
        title: "Use strict TS",
        content: "Always use strict TypeScript",
      }),
    ], ctx);

    expect(projection.constraintRules).toHaveLength(1);
    expect(projection.constraintRules[0].title).toBe("Use strict TS");
    expect(projection.contextPatch.doNotTouch).toHaveLength(0);
  });

  it("do_not_touch with projectionTarget=constraint_runtime enters constraintRules", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_scoped",
        kind: "do_not_touch",
        title: "DB Schema",
        content: "Do not touch DB schema",
        appliesTo: JSON.stringify({ files: ["db/schema/"], modules: ["database"] }),
        projectionTarget: "constraint_runtime",
      }),
    ], { ...ctx, workingResources: ["db/schema/users.sql"] });

    const crEntry = projection.constraintRules.find(
      cr => cr.source.sourceMemoryId === "pm_scoped",
    );
    expect(crEntry).toBeDefined();
    expect(crEntry!.scope?.files).toEqual(["db/schema/"]);
    expect(crEntry!.scope?.modules).toEqual(["database"]);
  });

  it("ProjectedMemoryItem carries scope from appliesTo", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_fact",
        kind: "fact",
        title: "Scoped fact",
        content: "Some fact",
        appliesTo: JSON.stringify({ files: ["src/utils/"], modules: ["utils"] }),
      }),
    ], { ...ctx, workingResources: ["src/utils/helpers.ts"] });

    expect(projection.contextPatch.verifiedFacts).toHaveLength(1);
    expect(projection.contextPatch.verifiedFacts[0].scope?.files).toEqual(["src/utils/"]);
    expect(projection.contextPatch.verifiedFacts[0].scope?.modules).toEqual(["utils"]);
  });

  it("ProjectedMemoryItem without appliesTo has no scope", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_unscoped",
        kind: "fact",
        title: "Global fact",
        content: "Applies everywhere",
      }),
    ], ctx);

    expect(projection.contextPatch.verifiedFacts[0].scope).toBeUndefined();
  });
});

// ── End-to-end: projection + runtime ─────────────────────

describe("E2E: buildRealityProjection → evaluateConstraints", () => {

  function makeMemory(overrides: Partial<MemoryProjectionInput>): MemoryProjectionInput {
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
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_protect",
        kind: "do_not_touch",
        title: "Protected Auth",
        content: "Never modify auth core",
        fingerprint: "fp_protect",
        appliesTo: JSON.stringify({ files: ["src/auth/"] }),
      }),
    ], { ...ctx, workingResources: ["src/auth/login.ts"] });

    const decision = evaluateConstraints({
      action: "operation_submit",
      projection,
      touchedResources: toRefs("src/auth/login.ts"),
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("do_not_touch_scope_overlap");
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_protect");
    expect(decision.blockers[0].evidence).toContain("src/auth/login.ts");
  });

  it("hard_constraint alone permits with advisory warning", () => {
    const projection = buildRealityProjection([
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

  it("do_not_touch + explicit projectionTarget=constraint_runtime blocks on overlap", () => {
    // Regression: explicit target should still be identified as do_not_touch by kind
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_explicit_rt",
        kind: "do_not_touch",
        title: "Protected Config",
        content: "Never modify config files",
        fingerprint: "fp_explicit_rt",
        appliesTo: JSON.stringify({ files: ["src/config/"] }),
        projectionTarget: "constraint_runtime",
      }),
    ], { ...ctx, workingResources: ["src/config/app.ts"] });

    // Should route to constraintRules only (not doNotTouch)
    expect(projection.contextPatch.doNotTouch).toHaveLength(0);
    expect(projection.constraintRules).toHaveLength(1);
    expect(projection.constraintRules[0].kind).toBe("do_not_touch");

    const decision = evaluateConstraints({
      action: "operation_submit",
      projection,
      touchedResources: toRefs("src/config/app.ts"),
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("do_not_touch_scope_overlap");
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_explicit_rt");
    // Should NOT appear as hard_constraint_advisory warning
    expect(decision.warnings.some(w => w.sourceMemoryId === "pm_explicit_rt")).toBe(false);
  });

  it("non-overlapping do_not_touch permits patch", () => {
    const projection = buildRealityProjection([
      makeMemory({
        id: "pm_db",
        kind: "do_not_touch",
        title: "DB Layer",
        content: "Do not modify database layer",
        fingerprint: "fp_db",
        appliesTo: JSON.stringify({ files: ["src/db/"] }),
      }),
    ], { ...ctx, workingResources: ["src/db/schema.ts"] });

    const decision = evaluateConstraints({
      action: "operation_submit",
      projection,
      touchedResources: toRefs("src/ui/component.tsx"),
    });

    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });
});

// ── PR4: Typed Hard Constraint Validators ─────────────────

describe("PR4: resolveRuntimeSpec", () => {
  it("returns spec from validatorType field (primary path)", () => {
    const item: ProjectedMemoryItem = {
      ...makeItem("pm_x", "Auth Guard", "No auth changes", { files: ["src/auth/"] }),
      kind: "hard_constraint",
      validatorType: "test_forbidden",
      validatorConfig: '{"message":"Auth locked"}',
    };
    const spec = resolveRuntimeSpec(item);
    expect(spec!.rule).toBe("test_forbidden");
    expect(spec!.message).toBe("Auth locked");
  });

  it("returns null when validatorType is empty (no embedded fallback)", () => {
    const item: ProjectedMemoryItem = {
      ...makeItem("pm_x", "Auth Guard", 'No auth changes', { files: ["src/auth/"] }),
      kind: "hard_constraint",
    };
    const spec = resolveRuntimeSpec(item);
    expect(spec).toBeNull();
  });

  it("does NOT infer from scope alone — hard_constraint with file scope but no validator stays null", () => {
    const item: ProjectedMemoryItem = {
      ...makeItem("pm_x", "Guard", "Protect files", { files: ["src/core/"] }),
      kind: "hard_constraint",
    };
    const spec = resolveRuntimeSpec(item);
    expect(spec).toBeNull();
  });

  it("returns null for hard_constraint without validator", () => {
    const item: ProjectedMemoryItem = {
      ...makeItem("pm_x", "Rule", "General rule"),
      kind: "hard_constraint",
    };
    const spec = resolveRuntimeSpec(item);
    expect(spec).toBeNull();
  });

  it("parses actions from validatorConfig", () => {
    const item: ProjectedMemoryItem = {
      ...makeItem("pm_x", "Lock", "Locked"),
      kind: "hard_constraint",
      validatorType: "test_forbidden",
      validatorConfig: '{"actions":["operation_submit","operation_apply"]}',
    };
    const spec = resolveRuntimeSpec(item);
    expect(spec!.rule).toBe("test_forbidden");
    expect(spec!.actions).toEqual(["operation_submit", "operation_apply"]);
  });
});

describe("PR4: Typed hard constraint evaluation", () => {

  // ── test_forbidden via validatorType (proves dispatch mechanism) ──────────────────

  it("hard_constraint with validatorType=test_forbidden blocks on scope overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_typed_1", "Protect Auth", "No changes", { files: ["src/auth/"] }), kind: "hard_constraint", validatorType: "test_forbidden" },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/auth/login.ts"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].rule).toBe("hard_constraint_test_forbidden");
    expect(decision.blockers[0].evidence).toContain("src/auth/login.ts");
    // Should NOT also appear as advisory
    expect(decision.warnings.some(w => w.sourceMemoryId === "pm_typed_1")).toBe(false);
  });

  it("test_forbidden permits when no overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_typed_2", "Protect Auth", "No changes", { files: ["src/auth/"] }), kind: "hard_constraint", validatorType: "test_forbidden" },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/ui/button.tsx"),
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    // Typed constraint was evaluated but didn't fire → still excluded from advisory
    expect(decision.warnings.some(w => w.sourceMemoryId === "pm_typed_2")).toBe(false);
  });

  it("hard_constraint with validatorType test_forbidden blocks", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_typed_3", "Config Lock", 'Do not modify', { files: ["config/"] }),
          kind: "hard_constraint",
          validatorType: "test_forbidden",
          validatorConfig: '{"message":"Config locked"}',
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("config/app.json"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("hard_constraint_test_forbidden");
    expect(decision.blockers[0].message).toBe("Config locked");
  });

  it("hard_constraint with file scope but NO validatorType stays advisory", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_no_vt", "Protect Core", "Guard core files", { files: ["src/core/"] }), kind: "hard_constraint" },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/core/engine.ts"),
    });
    // Without validatorType, hard_constraint stays advisory — does NOT block
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0].rule).toBe("hard_constraint_advisory");
  });

  // ── test_forbidden with modules scope ────────────────

  it("test_forbidden blocks on module scope overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_mod_1", "No Payment Changes", "Frozen", { modules: ["payments"] }), kind: "hard_constraint", validatorType: "test_forbidden" },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
      touchedResources: toRefs("payments/gateway.ts"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("hard_constraint_test_forbidden");
    expect(decision.blockers[0].evidence).toContain("payments/gateway.ts");
  });

  it("test_forbidden permits when no module scope overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_mod_2", "No Payment Changes", "Frozen", { modules: ["payments"] }), kind: "hard_constraint", validatorType: "test_forbidden" },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
      touchedResources: toRefs("billing/invoice.ts"),
    });
    expect(decision.permitted).toBe(true);
  });

  // ── require_review ────────────────────────────────────

  it("require_review blocks operation_submit", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_rev_1", "Review Required", 'Review required before submit'),
          kind: "hard_constraint",
          validatorType: "require_review",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0].rule).toBe("hard_constraint_require_review");
  });

  it("require_review does not block resume action", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_rev_2", "Review Required", 'Review required before submit'),
          kind: "hard_constraint",
          validatorType: "require_review",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
    // Typed constraint was resolved but didn't fire for resume → excluded from advisory
    expect(decision.warnings.some(w => w.sourceMemoryId === "pm_rev_2")).toBe(false);
  });

  // ── action allowlist ──────────────────────────────────

  it("test_forbidden with actions allowlist only blocks listed actions", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_act", "Scoped Lock", "Lock for submit only", { files: ["src/core/"] }),
          kind: "hard_constraint",
          validatorType: "test_forbidden",
          validatorConfig: '{"actions":["operation_submit"]}',
        },
      ],
    });
    // Should block operation_submit with overlap
    const d1 = evaluateConstraints({ action: "operation_submit", projection: proj, touchedResources: toRefs("src/core/x.ts") });
    expect(d1.permitted).toBe(false);
    expect(d1.blockers[0].rule).toBe("hard_constraint_test_forbidden");

    // Should NOT block resume even with overlap — action not in allowlist
    const d2 = evaluateConstraints({ action: "resume", projection: proj, touchedResources: toRefs("src/core/x.ts") });
    expect(d2.permitted).toBe(true);
    // Not blocked, not claimed → falls to advisory
    expect(d2.warnings).toHaveLength(1);
    expect(d2.warnings[0].rule).toBe("hard_constraint_advisory");
  });

  // ── custom rule (advisory, not silent) ────────────────

  it("custom rule type falls through to advisory (not silently dropped)", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_custom", "Custom Rule", 'A custom rule'),
          kind: "hard_constraint",
          validatorType: "custom",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/anything.ts"),
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
    // Custom is NOT claimed → falls through to advisory
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0].sourceMemoryId).toBe("pm_custom");
    expect(decision.warnings[0].rule).toBe("hard_constraint_advisory");
  });

  // ── fallback advisory ─────────────────────────────────

  it("hard_constraint without validator or spec stays advisory", () => {
    const proj = emptyProjection({
      constraintRules: [
        makeItem("pm_plain", "General Rule", "Always follow coding standards"),
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0].rule).toBe("hard_constraint_advisory");
    expect(decision.warnings[0].sourceMemoryId).toBe("pm_plain");
  });

  // ── mixed typed + untyped ─────────────────────────────

  it("mix of typed blocker + untyped advisory", () => {
    const proj = emptyProjection({
      constraintRules: [
        { ...makeItem("pm_typed", "Auth Lock", "No auth", { files: ["src/auth/"] }), kind: "hard_constraint", validatorType: "test_forbidden" },
        makeItem("pm_untyped", "Code Style", "Follow style guide"),
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/auth/session.ts"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0].sourceMemoryId).toBe("pm_typed");
    expect(decision.warnings).toHaveLength(1);
    expect(decision.warnings[0].sourceMemoryId).toBe("pm_untyped");
    expect(decision.warnings[0].rule).toBe("hard_constraint_advisory");
  });
});

// ── ConstraintManifest ────────────────────────────────

describe("buildConstraintManifest", () => {
  it("builds a manifest with correct fields from decision + input", () => {
    const proj = emptyProjection({
      constraintRules: [makeDntRule("dnt1", "Frozen", "Do not touch core", { files: ["src/core"] })],
    });
    const input: ConstraintInput = {
      action: "resume",
      projection: proj,
      touchedResources: toRefs("src/core/index.ts"),
    };
    const decision = evaluateConstraints(input);
    expect(decision.permitted).toBe(false);

    const manifest = buildConstraintManifest(input, decision);
    expect(manifest.projectionId).toBe(proj.projectionId);
    expect(manifest.memoryVersion).toBe(proj.createdFrom.memoryVersion);
    expect(manifest.action).toBe("resume");
    expect(manifest.permitted).toBe(false);
    expect(manifest.blockerCount).toBeGreaterThan(0);
    expect(manifest.touchedResources).toContain("src/core/index.ts");
    expect(manifest.hash).toBeTruthy();
    expect(manifest.evaluatedAt).toBeTruthy();
    expect(manifest.evaluatedRules.length).toBe(manifest.blockerCount + manifest.warningCount);
  });

  it("manifest hash changes when decision changes", () => {
    const proj = emptyProjection({
      constraintRules: [makeDntRule("dnt1", "Frozen", "Do not touch core", { files: ["src/core"] })],
    });
    // Permitted decision (no overlap)
    const inputSafe: ConstraintInput = {
      action: "resume",
      projection: proj,
      touchedResources: toRefs("src/other/file.ts"),
    };
    const dSafe = evaluateConstraints(inputSafe);
    const mSafe = buildConstraintManifest(inputSafe, dSafe);
    expect(mSafe.permitted).toBe(true);

    // Blocked decision (overlap)
    const inputBlocked: ConstraintInput = {
      action: "resume",
      projection: proj,
      touchedResources: toRefs("src/core/index.ts"),
    };
    const dBlocked = evaluateConstraints(inputBlocked);
    const mBlocked = buildConstraintManifest(inputBlocked, dBlocked);
    expect(mBlocked.permitted).toBe(false);

    expect(mSafe.hash).not.toBe(mBlocked.hash);
  });
});
