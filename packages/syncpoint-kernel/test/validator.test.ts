import { describe, it, expect, beforeEach } from "vitest";
import {
  registerOperationValidator,
  getValidatorsForOperation,
  runOperationValidation,
  clearValidatorRegistry,
} from "../src/validator.js";
import type { OperationValidator, OperationValidationContext } from "../src/validator.js";
import { OperationStatus } from "../src/operation.js";
import type { Operation, OperationCheckItem } from "../src/operation.js";

// ── Helpers ──────────────────────────────────────────────

function makeOp(overrides: Partial<Operation> = {}): Operation {
  return {
    id: "op-1",
    type: "code_patch",
    actorId: "agent-1",
    taskId: "task-1",
    sessionId: "",
    title: "test",
    summary: "test",
    targetResources: [{ type: "file", locator: "src/a.ts", scope: "file", metadata: "" }],
    payloadRef: "",
    status: OperationStatus.DRAFT,
    checkResult: null,
    decisionSummary: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Validator Registry ────────────────────────────────────

describe("validator registry", () => {
  beforeEach(() => {
    clearValidatorRegistry();
  });

  const mockValidator: OperationValidator = {
    name: "test_validator",
    operationTypes: ["code_patch"],
    resourceTypes: [],
    validate: () => [{ check: "basic_check", passed: true, detail: "ok" }],
  };

  it("registers validators", () => {
    registerOperationValidator(mockValidator);
    const results = getValidatorsForOperation("code_patch");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("test_validator");
  });

  it("filters validators by operation type", () => {
    const general: OperationValidator = {
      name: "general",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [],
    };
    const specific: OperationValidator = {
      name: "specific",
      operationTypes: ["image_edit"],
      resourceTypes: [],
      validate: () => [],
    };
    registerOperationValidator(general);
    registerOperationValidator(specific);

    const results = getValidatorsForOperation("code_patch");
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("general");
  });

  it("filters by resource type when provided", () => {
    const fileOnly: OperationValidator = {
      name: "file_only",
      operationTypes: [],
      resourceTypes: ["file"],
      validate: () => [],
    };
    const imageOnly: OperationValidator = {
      name: "image_only",
      operationTypes: [],
      resourceTypes: ["image"],
      validate: () => [],
    };
    registerOperationValidator(fileOnly);
    registerOperationValidator(imageOnly);

    const results = getValidatorsForOperation("code_patch", ["file"]);
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("file_only");
  });

  it("empty operationTypes matches everything", () => {
    const general: OperationValidator = {
      name: "general",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [],
    };
    registerOperationValidator(general);
    expect(getValidatorsForOperation("any_type")).toHaveLength(1);
  });

  it("returns empty array when no validators match", () => {
    expect(getValidatorsForOperation("unknown_type")).toEqual([]);
  });
});

// ── runOperationValidation ────────────────────────────────

describe("runOperationValidation", () => {
  beforeEach(() => {
    clearValidatorRegistry();
  });

  it("runs all applicable validators on an operation", () => {
    let called = false;
    const v: OperationValidator = {
      name: "checker",
      operationTypes: ["code_patch"],
      resourceTypes: [],
      validate: () => {
        called = true;
        return [{ check: "works", passed: true, detail: "" }];
      },
    };
    registerOperationValidator(v);

    const ctx: OperationValidationContext = {
      operation: makeOp({ type: "code_patch" }),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    expect(called).toBe(true);
    expect(items).toHaveLength(1);
    expect(items[0]!.check).toBe("works");
  });

  it("aggregates results from multiple validators", () => {
    const v1: OperationValidator = {
      name: "v1",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [{ check: "a", passed: true, detail: "" }],
    };
    const v2: OperationValidator = {
      name: "v2",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [{ check: "b", passed: false, detail: "fail" }],
    };
    registerOperationValidator(v1);
    registerOperationValidator(v2);

    const ctx: OperationValidationContext = {
      operation: makeOp(),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    expect(items).toHaveLength(2);
  });

  it("skips validators with non-matching operation types", () => {
    const v: OperationValidator = {
      name: "image_only",
      operationTypes: ["image_edit"],
      resourceTypes: [],
      validate: () => [{ check: "nope", passed: true, detail: "" }],
    };
    registerOperationValidator(v);

    const ctx: OperationValidationContext = {
      operation: makeOp({ type: "code_patch" }),
      actorClaims: [],
      allActiveClaims: [],
    };
    const items = runOperationValidation(ctx);
    expect(items).toHaveLength(0);
  });

  it("clearValidatorRegistry removes all validators", () => {
    registerOperationValidator({ name: "v", operationTypes: [], resourceTypes: [], validate: () => [] });
    expect(getValidatorsForOperation("any")).toHaveLength(1);
    clearValidatorRegistry();
    expect(getValidatorsForOperation("any")).toHaveLength(0);
  });
});
