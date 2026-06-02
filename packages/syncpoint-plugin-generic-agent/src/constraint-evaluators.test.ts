/**
 * Tests for resource_forbidden ConstraintRuleEvaluator.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  evaluateConstraints,
  registerConstraintEvaluator,
  clearConstraintEvaluatorRegistry,
  registerScopeMatcher,
  clearScopeMatcherRegistry,
  buildRealityProjection,
} from "syncpoint-core";
import type {
  ConstraintInput,
  RealityProjection,
  ProjectedMemoryItem,
  ProjectionSource,
  MemoryProjectionInput,
  ProjectionContext,
} from "syncpoint-core";
import type { ResourceRef } from "syncpoint-core";
import { resourceForbiddenEvaluator } from "./constraint-evaluators.js";
import { resourcesScopeMatcher } from "./scope-matchers.js";

// ── Helpers ──────────────────────────────────────────

function toRefs(...locators: string[]): ResourceRef[] {
  return locators.map(l => ({ type: "artifact", locator: l, metadata: "", scope: "file" as const }));
}

function makeSource(id: string): ProjectionSource {
  return { sourceMemoryId: id, projectionReason: "test", confidence: "high" };
}

function makeItem(
  id: string,
  title: string,
  content: string,
  scope?: Record<string, string[]>,
): ProjectedMemoryItem {
  return {
    source: makeSource(id),
    title,
    content,
    kind: "hard_constraint",
    scope,
  };
}

function emptyProjection(overrides?: Partial<RealityProjection>): RealityProjection {
  return {
    projectionId: "proj_test",
    createdFrom: { taskId: "t1", memoryVersion: 1, generatedAt: "2024-01-01" },
    cacheKey: "ck_test",
    contextPatch: { verifiedFacts: [], activeConstraints: [], risks: [], doNotTouch: [] },
    protocolRules: [],
    constraintRules: [],
    conflicts: [],
    projectionValidity: "fresh",
    skippedStale: [],
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────

beforeEach(() => {
  clearConstraintEvaluatorRegistry();
  clearScopeMatcherRegistry();
  registerConstraintEvaluator(resourceForbiddenEvaluator);
  registerScopeMatcher({ field: "resources", findOverlaps: resourcesScopeMatcher });
});

// ── resource_forbidden evaluator ─────────────────────

describe("resource_forbidden evaluator", () => {
  it("blocks when touched resource overlaps forbidden scope", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_1", "Protected Asset", "Do not modify", {
            resources: ["artifact://landing-page"],
          }),
          validatorType: "resource_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("artifact://landing-page"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers).toHaveLength(1);
    expect(decision.blockers[0]!.rule).toBe("resource_forbidden");
    expect(decision.blockers[0]!.evidence).toContain("artifact://landing-page");
  });

  it("blocks on prefix overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_2", "Protected Namespace", "No changes to ui/", {
            resources: ["artifact://ui"],
          }),
          validatorType: "resource_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("artifact://ui/header"),
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.evidence).toContain("artifact://ui/header");
  });

  it("permits when no overlap", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_3", "Protected Asset", "No changes", {
            resources: ["artifact://landing-page"],
          }),
          validatorType: "resource_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: toRefs("artifact://checkout"),
    });
    expect(decision.permitted).toBe(true);
    expect(decision.blockers).toHaveLength(0);
  });

  it("permits when no touched resources", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_4", "Protected", "Locked", {
            resources: ["binary://brand-logo.png"],
          }),
          validatorType: "resource_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "resume",
      projection: proj,
    });
    expect(decision.permitted).toBe(true);
  });

  it("uses custom message from spec", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_5", "Brand Lock", "Brand assets locked", {
            resources: ["binary://brand-logo.png"],
          }),
          validatorType: "resource_forbidden",
          validatorConfig: '{"message":"Brand assets are frozen during launch"}',
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [{ type: "binary_asset", locator: "binary://brand-logo.png", metadata: "", scope: "file" as const }],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.message).toBe("Brand assets are frozen during launch");
  });

  it("blocks on binary asset path", () => {
    const proj = emptyProjection({
      constraintRules: [
        {
          ...makeItem("pm_6", "No Banner Edit", "Do not touch hero banner", {
            resources: ["binary://assets/hero-banner.png"],
          }),
          validatorType: "resource_forbidden",
        },
      ],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [{ type: "binary_asset", locator: "binary://assets/hero-banner.png", metadata: "", scope: "file" as const }],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.rule).toBe("resource_forbidden");
  });
});

// ── E2E: compileProjection → evaluateConstraints ─────

describe("E2E: projection + resource_forbidden", () => {
  it("do_not_touch with resources scope blocks via scope overlap", () => {
    const mem: MemoryProjectionInput = {
      id: "pm_dnt",
      category: "architecture",
      title: "Protected Brand Logo",
      content: "Never modify brand logo",
      fingerprint: "fp_dnt",
      kind: "do_not_touch",
      projectionTarget: null,
      appliesTo: JSON.stringify({ resources: ["binary://brand-logo.png"] }),
      severity: "blocking",
      validityStatus: "valid",
    };

    const ctx: ProjectionContext = {
      taskId: "t1",
      memoryVersion: 1,
      workingResources: ["binary://brand-logo.png"],
    };

    const projection = buildRealityProjection([mem], ctx);

    const decision = evaluateConstraints({
      action: "operation_submit",
      projection,
      touchedResources: [{ type: "binary_asset", locator: "binary://brand-logo.png", metadata: "", scope: "file" as const }],
    });

    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.rule).toBe("do_not_touch_scope_overlap");
  });
});
