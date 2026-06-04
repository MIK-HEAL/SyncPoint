/**
 * Integration tests — full plugin registration + E2E scenarios.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearValidatorRegistry,
  clearResourceMatcherRegistry,
  clearConstraintEvaluatorRegistry,
  clearScopeMatcherRegistry,
  runOperationValidation,
  resourceLocatorsOverlap,
  evaluateConstraints,
  getResourceMatcher,
  getValidatorsForOperation,
  getConstraintEvaluator,
  getScopeMatcher,
  OperationStatus,
  ResourceClaimStatus,
  ResourceClaimMode,
} from "syncpoint-core";
import type {
  OperationValidationContext,
  ResourceRef,
  ResourceClaim,
  Operation,
  RealityProjection,
  ProjectionSource,
} from "syncpoint-core";
import {
  registerGenericAgentPlugin,
  _resetGenericAgentPlugin,
  isGenericAgentPluginRegistered,
} from "../src/index.js";

// ── Helpers ──────────────────────────────────────────

function ref(type: string, locator: string): ResourceRef {
  return { type, locator, metadata: "", scope: "file" as const };
}

function makeOp(overrides?: Partial<Operation>): Operation {
  return {
    id: "op1",
    type: "artifact_update",
    actorId: "agent-a",
    taskId: "t1",
    sessionId: "s1",
    title: "Update landing page",
    summary: "",
    targetResources: [ref("artifact", "artifact://landing-page")],
    payloadRef: "ref-123",
    status: OperationStatus.SUBMITTED,
    checkResult: null,
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeClaim(
  id: string,
  actorId: string,
  type: string,
  locator: string,
  mode = ResourceClaimMode.EXCLUSIVE,
): ResourceClaim {
  return {
    id,
    actorId,
    taskId: "t1",
    sessionId: "s1",
    resources: [ref(type, locator)],
    mode,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "2024-01-01",
    releasedAt: "",
  };
}

function makeSource(id: string): ProjectionSource {
  return { sourceMemoryId: id, projectionReason: "test", confidence: "high" };
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
  clearValidatorRegistry();
  clearResourceMatcherRegistry();
  clearConstraintEvaluatorRegistry();
  clearScopeMatcherRegistry();
  _resetGenericAgentPlugin();
});

// ── Registration ─────────────────────────────────────

describe("registerGenericAgentPlugin", () => {
  it("registers all resource matchers", () => {
    registerGenericAgentPlugin();
    expect(getResourceMatcher("artifact")).toBeDefined();
    expect(getResourceMatcher("binary_asset")).toBeDefined();
    expect(getResourceMatcher("document")).toBeDefined();
    expect(getResourceMatcher("design_asset")).toBeDefined();
    expect(getResourceMatcher("dataset_slice")).toBeDefined();
  });

  it("registers operation validators", () => {
    registerGenericAgentPlugin();
    const vs = getValidatorsForOperation("artifact_update", ["artifact"]);
    const names = vs.map(v => v.name);
    expect(names).toContain("generic_claim_coverage");
    expect(names).toContain("generic_no_hard_conflict");
    expect(names).toContain("generic_payload_present");
  });

  it("registers validators for asset_update operation type", () => {
    registerGenericAgentPlugin();
    const vs = getValidatorsForOperation("asset_update", ["binary_asset"]);
    const names = vs.map(v => v.name);
    expect(names).toContain("generic_claim_coverage");
    expect(names).toContain("generic_no_hard_conflict");
    expect(names).toContain("generic_payload_present");
  });

  it("registers resource_forbidden evaluator", () => {
    registerGenericAgentPlugin();
    expect(getConstraintEvaluator("resource_forbidden")).toBeDefined();
  });

  it("registers scope matchers", () => {
    registerGenericAgentPlugin();
    expect(getScopeMatcher("resources")).toBeDefined();
    expect(getScopeMatcher("assetTypes")).toBeDefined();
  });

  it("is idempotent", () => {
    registerGenericAgentPlugin();
    registerGenericAgentPlugin();
    const vs = getValidatorsForOperation("artifact_update", ["artifact"]);
    const coverageChecks = vs.filter(v => v.name === "generic_claim_coverage");
    expect(coverageChecks).toHaveLength(1);
  });

  it("re-registers after registry clear", () => {
    registerGenericAgentPlugin();
    clearValidatorRegistry();
    clearResourceMatcherRegistry();
    _resetGenericAgentPlugin();
    registerGenericAgentPlugin();
    expect(getResourceMatcher("artifact")).toBeDefined();
    const vs = getValidatorsForOperation("artifact_update", ["artifact"]);
    expect(vs.some(v => v.name === "generic_claim_coverage")).toBe(true);
  });

  it("sets registered flag", () => {
    expect(isGenericAgentPluginRegistered()).toBe(false);
    registerGenericAgentPlugin();
    expect(isGenericAgentPluginRegistered()).toBe(true);
  });
});

// ── E2E: Claim conflict between two agents ───────────

describe("E2E: claim conflict", () => {
  it("detects overlap when two agents claim same artifact", () => {
    registerGenericAgentPlugin();
    const a = ref("artifact", "artifact://landing-page");
    const b = ref("artifact", "artifact://landing-page");
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("detects prefix overlap on binary_asset namespace", () => {
    registerGenericAgentPlugin();
    const a = ref("binary_asset", "binary://assets");
    const b = ref("binary_asset", "binary://assets/hero-banner.png");
    expect(resourceLocatorsOverlap(a, b)).toBe(true);
  });

  it("no overlap across different resource types", () => {
    registerGenericAgentPlugin();
    const a = ref("artifact", "artifact://shared");
    const b = ref("document", "doc://shared");
    expect(resourceLocatorsOverlap(a, b)).toBe(false);
  });
});

// ── E2E: Operation validation pipeline ───────────────

describe("E2E: operation validation", () => {
  it("full pass — claimed, no conflict, payload present", () => {
    registerGenericAgentPlugin();
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact", "artifact://landing-page")],
      payload: "new design content",
    };
    const items = runOperationValidation(ctx);
    expect(items.every(i => i.passed)).toBe(true);
  });

  it("fails claim_coverage + no_hard_conflict when unclaimed + exclusive other", () => {
    registerGenericAgentPlugin();
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [],
      allActiveClaims: [makeClaim("c2", "agent-b", "artifact", "artifact://landing-page")],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const coverage = items.find(i => i.check === "generic_claim_coverage");
    const conflict = items.find(i => i.check === "generic_no_hard_conflict");
    expect(coverage!.passed).toBe(false);
    expect(conflict!.passed).toBe(false);
  });
});

// ── E2E: Constraint runtime blocks on resource_forbidden ─

describe("E2E: constraint enforcement", () => {
  it("resource_forbidden blocks operation on protected resource", () => {
    registerGenericAgentPlugin();
    const proj = emptyProjection({
      constraintRules: [{
        source: makeSource("pm_brand"),
        title: "Brand Lock",
        content: "Brand assets frozen",
        kind: "hard_constraint",
        scope: { resources: ["binary://brand-logo.png"] },
        validatorType: "resource_forbidden",
      }],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [ref("binary_asset", "binary://brand-logo.png")],
    });
    expect(decision.permitted).toBe(false);
    expect(decision.blockers[0]!.rule).toBe("resource_forbidden");
    expect(decision.blockers[0]!.evidence).toContain("binary://brand-logo.png");
  });

  it("resource_forbidden permits when resource not touched", () => {
    registerGenericAgentPlugin();
    const proj = emptyProjection({
      constraintRules: [{
        source: makeSource("pm_brand"),
        title: "Brand Lock",
        content: "Brand assets frozen",
        kind: "hard_constraint",
        scope: { resources: ["binary://brand-logo.png"] },
        validatorType: "resource_forbidden",
      }],
    });
    const decision = evaluateConstraints({
      action: "operation_submit",
      projection: proj,
      touchedResources: [ref("binary_asset", "binary://other-asset.png")],
    });
    expect(decision.permitted).toBe(true);
  });
});

// ── Does not interfere with code plugin ──────────────

describe("isolation from code plugin", () => {
  it("generic validators do not fire on code_patch operations", () => {
    registerGenericAgentPlugin();
    const ctx: OperationValidationContext = {
      operation: makeOp({
        type: "code_patch",
        targetResources: [ref("file", "src/main.js")],
      }),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    const genericChecks = items.filter(i => i.check.startsWith("generic_"));
    expect(genericChecks).toHaveLength(0);
  });
});
