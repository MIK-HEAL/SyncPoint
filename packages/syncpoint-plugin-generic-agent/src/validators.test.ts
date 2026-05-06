/**
 * Tests for generic agent OperationValidators.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  clearValidatorRegistry,
  clearResourceMatcherRegistry,
  registerResourceMatcher,
  registerOperationValidator,
  runOperationValidation,
  OperationStatus,
  ResourceClaimStatus,
  ResourceClaimMode,
} from "syncpoint-core";
import type { OperationValidationContext, ResourceClaim, Operation } from "syncpoint-core";
import { GENERIC_RESOURCE_MATCHERS } from "./matchers.js";
import { GENERIC_VALIDATORS } from "./validators.js";

// ── Helpers ──────────────────────────────────────────

function makeOp(overrides?: Partial<Operation>): Operation {
  return {
    id: "op1",
    type: "artifact_update",
    actorId: "agent-a",
    taskId: "t1",
    sessionId: "s1",
    title: "Update artifact",
    summary: "",
    targetResources: [{ type: "artifact", locator: "artifact://landing-page", metadata: "" }],
    payloadRef: "ref-123",
    status: OperationStatus.SUBMITTED,
    checkResult: "",
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makeClaim(id: string, actorId: string, locator: string, type = "artifact", mode: ResourceClaimMode = ResourceClaimMode.EXCLUSIVE): ResourceClaim {
  return {
    id,
    actorId,
    taskId: "t1",
    sessionId: "s1",
    resources: [{ type, locator, metadata: "" }],
    mode,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "2024-01-01",
    releasedAt: "",
  };
}

// ── Setup ────────────────────────────────────────────

beforeEach(() => {
  clearValidatorRegistry();
  clearResourceMatcherRegistry();
  for (const m of GENERIC_RESOURCE_MATCHERS) {
    registerResourceMatcher(m);
  }
  for (const v of GENERIC_VALIDATORS) {
    registerOperationValidator(v);
  }
});

// ── generic_claim_coverage ───────────────────────────

describe("generic_claim_coverage", () => {
  it("passes when actor claims the target resource", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_claim_coverage");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(true);
  });

  it("fails when actor has no claim on target", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [],
      allActiveClaims: [],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_claim_coverage");
    expect(check).toBeDefined();
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain("artifact://landing-page");
  });

  it("passes when claim covers target via prefix overlap", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp({
        targetResources: [{ type: "artifact", locator: "artifact://ui/header", metadata: "" }],
      }),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://ui")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://ui")],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_claim_coverage");
    expect(check!.passed).toBe(true);
  });
});

// ── generic_no_hard_conflict ─────────────────────────

describe("generic_no_hard_conflict", () => {
  it("passes when no other actor claims the target", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_no_hard_conflict");
    expect(check!.passed).toBe(true);
  });

  it("fails when another actor has exclusive claim on same resource", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [
        makeClaim("c1", "agent-a", "artifact://landing-page"),
        makeClaim("c2", "agent-b", "artifact://landing-page"),
      ],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_no_hard_conflict");
    expect(check!.passed).toBe(false);
    expect(check!.detail).toContain("c2");
  });

  it("passes when other actor has shared claim (not exclusive)", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [
        makeClaim("c1", "agent-a", "artifact://landing-page"),
        makeClaim("c2", "agent-b", "artifact://landing-page", "artifact", ResourceClaimMode.SHARED),
      ],
      payload: "content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_no_hard_conflict");
    expect(check!.passed).toBe(true);
  });
});

// ── generic_payload_present ──────────────────────────

describe("generic_payload_present", () => {
  it("passes when payload is present", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      payload: "some content",
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_payload_present");
    expect(check!.passed).toBe(true);
  });

  it("passes when payloadRef is present (no inline payload)", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp({ payloadRef: "s3://bucket/artifact.zip" }),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_payload_present");
    expect(check!.passed).toBe(true);
  });

  it("fails when both payload and payloadRef are empty", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp({ payloadRef: "" }),
      actorClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
      allActiveClaims: [makeClaim("c1", "agent-a", "artifact://landing-page")],
    };
    const items = runOperationValidation(ctx);
    const check = items.find(i => i.check === "generic_payload_present");
    expect(check!.passed).toBe(false);
  });
});

// ── Non-generic operations should not trigger ────────

describe("validator scope isolation", () => {
  it("does not fire on code_patch operations", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp({
        type: "code_patch",
        targetResources: [{ type: "file", locator: "src/main.ts", metadata: "" }],
      }),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    const genericChecks = items.filter(i => i.check.startsWith("generic_"));
    expect(genericChecks).toHaveLength(0);
  });

  it("does not fire on image_edit operations (no image plugin registered)", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp({
        type: "image_edit",
        targetResources: [{ type: "image", locator: "image://hero", metadata: "" }],
      }),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    const genericChecks = items.filter(i => i.check.startsWith("generic_"));
    expect(genericChecks).toHaveLength(0);
  });
});
