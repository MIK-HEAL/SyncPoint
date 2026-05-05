import { describe, it, expect, beforeEach } from "vitest";
import {
  clearValidatorRegistry,
  registerOperationValidator,
  runOperationValidation,
  OperationStatus,
  getResourceMatcher,
  clearResourceMatcherRegistry,
} from "syncpoint-core";
import type { Operation, ResourceClaim, OperationValidationContext } from "syncpoint-core";
import { ResourceClaimMode, ResourceClaimStatus } from "syncpoint-core";
import {
  registerCodePlugin,
  _resetCodePlugin,
  codePatchFormatValidator,
  codePatchClaimCoverageValidator,
  codePatchNoHardConflictValidator,
} from "./index.js";

function makeOp(overrides?: Partial<Operation>): Operation {
  return {
    id: "op1",
    type: "code_patch",
    actorId: "a1",
    taskId: "t1",
    sessionId: "s1",
    title: "test",
    summary: "",
    targetResources: [{ type: "file", locator: "src/auth.ts", metadata: "" }],
    payloadRef: "",
    status: OperationStatus.SUBMITTED,
    checkResult: "",
    decisionSummary: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

function makeClaim(id: string, actorId: string, locator: string, mode = "exclusive"): ResourceClaim {
  return {
    id,
    actorId,
    taskId: "t1",
    sessionId: "s1",
    resources: [{ type: "file", locator, metadata: "" }],
    mode: mode === "exclusive" ? ResourceClaimMode.EXCLUSIVE : ResourceClaimMode.SHARED,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "",
    releasedAt: "",
  };
}

beforeEach(() => {
  clearValidatorRegistry();
  clearResourceMatcherRegistry();
  _resetCodePlugin();
});

describe("registerCodePlugin", () => {
  it("registers validators that run on code_patch operations", () => {
    registerCodePlugin();

    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "a1", "src/*")],
      allActiveClaims: [makeClaim("c1", "a1", "src/*")],
    };

    const items = runOperationValidation(ctx);
    const names = items.map(i => i.check);
    expect(names).toContain("code_patch_format");
    expect(names).toContain("code_patch_claim_coverage");
    expect(names).toContain("code_patch_no_hard_conflict");
  });

  it("is idempotent", () => {
    registerCodePlugin();
    registerCodePlugin();

    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [],
      allActiveClaims: [],
    };

    const items = runOperationValidation(ctx);
    // Should not duplicate validators
    const formatChecks = items.filter(i => i.check === "code_patch_format");
    expect(formatChecks).toHaveLength(1);
  });

  it("re-registers validators after the core registry is cleared", () => {
    registerCodePlugin();
    clearValidatorRegistry();
    registerCodePlugin();

    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [],
      allActiveClaims: [],
    };

    const items = runOperationValidation(ctx);
    const formatChecks = items.filter(i => i.check === "code_patch_format");
    expect(formatChecks).toHaveLength(1);
  });

  it("registers file ResourceMatcher", () => {
    expect(getResourceMatcher("file")).toBeUndefined();
    registerCodePlugin();
    const matcher = getResourceMatcher("file");
    expect(matcher).toBeDefined();
    expect(matcher!.locatorsOverlap("src/auth", "src/auth/session.ts")).toBe(true);
    expect(matcher!.locatorsOverlap("src/auth.ts", "lib/utils.ts")).toBe(false);
  });

  it("does not fire on non-code_patch operations", () => {
    registerCodePlugin();

    const ctx: OperationValidationContext = {
      operation: makeOp({ type: "image_edit", targetResources: [{ type: "image", locator: "logo.png", metadata: "" }] }),
      actorClaims: [],
      allActiveClaims: [],
    };

    const items = runOperationValidation(ctx);
    const codeChecks = items.filter(i => i.check.startsWith("code_patch_"));
    expect(codeChecks).toHaveLength(0);
  });
});

describe("codePatchClaimCoverageValidator", () => {
  it("passes when files are covered", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "a1", "src/*")],
      allActiveClaims: [makeClaim("c1", "a1", "src/*")],
    };
    const items = codePatchClaimCoverageValidator.validate(ctx);
    expect(items[0].passed).toBe(true);
  });

  it("fails when files are not covered", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "a1", "lib/*")],
      allActiveClaims: [makeClaim("c1", "a1", "lib/*")],
    };
    const items = codePatchClaimCoverageValidator.validate(ctx);
    expect(items[0].passed).toBe(false);
    expect(items[0].detail).toContain("src/auth.ts");
  });
});

describe("codePatchNoHardConflictValidator", () => {
  it("passes when no conflicts", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "a1", "src/*")],
      allActiveClaims: [makeClaim("c1", "a1", "src/*")],
    };
    const items = codePatchNoHardConflictValidator.validate(ctx);
    expect(items[0].passed).toBe(true);
  });

  it("fails when other agent has exclusive conflict", () => {
    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [makeClaim("c1", "a1", "src/*")],
      allActiveClaims: [
        makeClaim("c1", "a1", "src/*"),
        makeClaim("c2", "a2", "src/auth.ts"),
      ],
    };
    const items = codePatchNoHardConflictValidator.validate(ctx);
    expect(items[0].passed).toBe(false);
    expect(items[0].detail).toContain("c2");
  });
});
