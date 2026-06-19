/**
 * Tests for code plugin constraint evaluators: file_forbidden + module_forbidden.
 *
 * These evaluators were previously inline test-only dummies in
 * syncpoint-core/constraint-runtime.test.ts. Now they are real production
 * code tested here.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateConstraints,
  registerConstraintEvaluator,
  getConstraintEvaluator,
  clearConstraintEvaluatorRegistry,
  registerScopeMatcher,
  clearScopeMatcherRegistry,
  buildRealityProjection,
  isConstraintRuleKnown,
} from "syncpoint-core";
import type {
  RealityProjection,
  ProjectedMemoryItem,
  ProjectionSource,
  MemoryProjectionInput,
  ProjectionContext,
  ResourceRef,
} from "syncpoint-core";
import {
  fileForbiddenEvaluator,
  moduleForbiddenEvaluator,
  prefixFindOverlaps,
} from "../src/constraint-evaluators.js";
import { registerCodePlugin } from "../src/index.js";

// ── Helpers ──────────────────────────────────────────────

function toRefs(...locators: string[]): ResourceRef[] {
  return locators.map(loc => ({ type: "file", locator: loc, metadata: "", scope: "file" as const }));
}

function toTypedRef(type: string, locator: string): ResourceRef {
  return { type, locator, metadata: "", scope: "file" as const };
}

function makeSource(id: string): ProjectionSource {
  return { sourceMemoryId: id, projectionReason: "test", confidence: "high" };
}

function makeItem(
  id: string,
  title: string,
  content: string,
  scope?: { files?: string[]; modules?: string[] },
): ProjectedMemoryItem {
  return { source: makeSource(id), title, content, scope };
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

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  clearConstraintEvaluatorRegistry();
  clearScopeMatcherRegistry();
  registerCodePlugin();
});

// ── file_forbidden evaluator ─────────────────────────────

describe("file_forbidden evaluator", () => {
  it("is registered by registerCodePlugin", () => {
    expect(getConstraintEvaluator("file_forbidden")).toBeDefined();
  });

  it("blocks when touched resources overlap with forbidden files", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_1", "Auth Lock", "No auth changes", { files: ["src/auth/"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("src/auth/login.js"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]!.rule).toBe("hard_constraint_file_forbidden");
    expect(decision.blockers[0]!.evidence).toContain("src/auth/login.js");
  });

  it("permits when no file overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_2", "Auth Lock", "No auth changes", { files: ["src/auth/"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
        },
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

  it("does not block non-file resources with overlapping locator text", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_non_file", "Auth Lock", "No auth changes", { files: ["src/auth/"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [toTypedRef("binary_asset", "src/auth/logo.png")],
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("uses custom message from validatorConfig", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_3", "Config Lock", "Do not modify", { files: ["config/"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
          validatorConfig: '{"message":"Config files are locked for release"}',
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("config/app.json"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.message).toBe("Config files are locked for release");
  });

  it("handles glob patterns in scope", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_4", "Vendor Lock", "No vendor changes", { files: ["vendor/**"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("vendor/lib/utils.js"),
    });
    expect(decision.permitted).toBe(false);
  });

  it("permits when no touchedResources", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_5", "Auth Lock", "No changes", { files: ["src/auth/"] }),
          kind: "hard_constraint",
          validatorType: "file_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
  });
});

// ── module_forbidden evaluator ───────────────────────────

describe("module_forbidden evaluator", () => {
  it("is registered by registerCodePlugin", () => {
    expect(getConstraintEvaluator("module_forbidden")).toBeDefined();
  });

  it("blocks when touched resource is under forbidden module", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_mod_1", "Payment Lock", "Frozen", { modules: ["payments"] }),
          kind: "hard_constraint",
          validatorType: "module_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
      touchedResources: toRefs("payments/gateway.js"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.rule).toBe("hard_constraint_module_forbidden");
    expect(decision.blockers[0]!.evidence).toContain("payments/gateway.js");
  });

  it("permits when resource not under forbidden module", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_mod_2", "Payment Lock", "Frozen", { modules: ["payments"] }),
          kind: "hard_constraint",
          validatorType: "module_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
      touchedResources: toRefs("billing/invoice.js"),
    });
    expect(decision.permitted).toBe(true);
  });

  it("does not block non-file resources with module-shaped locators", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_mod_non_file", "Payment Lock", "Frozen", { modules: ["payments"] }),
          kind: "hard_constraint",
          validatorType: "module_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
      touchedResources: [toTypedRef("artifact", "payments/gateway")],
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("permits when no touchedResources", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_mod_3", "Payment Lock", "Frozen", { modules: ["payments"] }),
          kind: "hard_constraint",
          validatorType: "module_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
  });

  it("blocks on exact module name match", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_mod_4", "Core Lock", "Frozen", { modules: ["core"] }),
          kind: "hard_constraint",
          validatorType: "module_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("core"),
    });
    expect(decision.permitted).toBe(false);
  });
});

// ── E2E: compileProjection + evaluateConstraints ─────────

describe("E2E: projection + file_forbidden", () => {
  it("do_not_touch with files scope blocks via scope overlap", () => {
    const mem: MemoryProjectionInput = {
      id: "pm_e2e",
      category: "architecture",
      title: "Protected Config",
      content: "Never modify config files",
      fingerprint: "fp_e2e",
      kind: "do_not_touch",
      projectionTarget: null,
      appliesTo: JSON.stringify({ files: ["config/"] }),
      severity: "blocking",
      validityStatus: "valid",
    };

    const ctx: ProjectionContext = {
      taskId: "t1",
      memoryVersion: 1,
      workingResources: ["config/app.json"],
    };

    const projection = buildRealityProjection([mem], ctx);
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection,
      touchedResources: toRefs("config/app.json"),
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.rule).toBe("do_not_touch_scope_overlap");
  });
});

// ── Prefix overlap helper ────────────────────────────────

describe("prefixFindOverlaps", () => {
  it("does not treat same-prefix siblings as overlap", () => {
    expect(prefixFindOverlaps(["src/auth"], ["src/auth2.js"])).toEqual([]);
  });

  it("matches exact paths, child paths, and simple globs", () => {
    expect(prefixFindOverlaps(["src/auth"], ["src/auth/login.js"])).toEqual(["src/auth/login.js"]);
    expect(prefixFindOverlaps(["vendor/**"], ["vendor/lib/utils.js"])).toEqual(["vendor/lib/utils.js"]);
  });
});

// ── isConstraintRuleKnown integration ────────────────────

describe("isConstraintRuleKnown", () => {
  it("returns true for file_forbidden after plugin registration", () => {
    expect(isConstraintRuleKnown("file_forbidden")).toBe(true);
  });

  it("returns true for module_forbidden after plugin registration", () => {
    expect(isConstraintRuleKnown("module_forbidden")).toBe(true);
  });

  it("returns true for core built-in require_review", () => {
    expect(isConstraintRuleKnown("require_review")).toBe(true);
  });

  it("returns true for core built-in custom", () => {
    expect(isConstraintRuleKnown("custom")).toBe(true);
  });

  it("returns false for unregistered type", () => {
    expect(isConstraintRuleKnown("image_semantic_forbidden")).toBe(false);
  });
});
