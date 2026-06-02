/**
 * Unit tests for Validator — generic operation validator protocol.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerOperationValidator,
  getValidatorsForOperation,
  runOperationValidation,
  clearValidatorRegistry,
} from "./validator.js";
import type { OperationValidator, OperationValidationContext } from "./validator.js";
import { OperationStatus } from "./operation.js";
import type { Operation } from "./operation.js";
import { ResourceClaimMode, ResourceClaimStatus } from "./resource.js";
import type { ResourceRef } from "./resource.js";

function makeOperation(type: string, targetResources?: ResourceRef[]): Operation {
  return {
    id: "op1",
    type,
    actorId: "a1",
    taskId: "t1",
    sessionId: "s1",
    title: "test op",
    summary: "",
    targetResources: targetResources ?? [{ type: "file", locator: "src/auth.ts", metadata: "", scope: "file" as const }],
    payloadRef: "",
    status: OperationStatus.SUBMITTED,
    checkResult: null,
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  };
}

describe("Validator registry", () => {
  beforeEach(() => {
    clearValidatorRegistry();
  });

  it("registers and retrieves validators by operation type", () => {
    const v: OperationValidator = {
      name: "test_validator",
      operationTypes: ["code_patch"],
      resourceTypes: [],
      validate: () => [{ check: "test", passed: true, detail: "ok" }],
    };
    registerOperationValidator(v);
    expect(getValidatorsForOperation("code_patch")).toHaveLength(1);
    expect(getValidatorsForOperation("image_edit")).toHaveLength(0);
  });

  it("wildcard validator applies to all operation types", () => {
    const v: OperationValidator = {
      name: "universal",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [{ check: "universal", passed: true, detail: "ok" }],
    };
    registerOperationValidator(v);
    expect(getValidatorsForOperation("code_patch")).toHaveLength(1);
    expect(getValidatorsForOperation("image_edit")).toHaveLength(1);
  });

  it("runOperationValidation collects results from all applicable validators", () => {
    registerOperationValidator({
      name: "v1",
      operationTypes: ["code_patch"],
      resourceTypes: [],
      validate: () => [{ check: "format", passed: true, detail: "ok" }],
    });
    registerOperationValidator({
      name: "v2",
      operationTypes: ["code_patch"],
      resourceTypes: [],
      validate: () => [{ check: "coverage", passed: false, detail: "uncovered" }],
    });
    registerOperationValidator({
      name: "v3",
      operationTypes: ["image_edit"],
      resourceTypes: [],
      validate: () => [{ check: "irrelevant", passed: true, detail: "not called" }],
    });

    const ctx: OperationValidationContext = {
      operation: makeOperation("code_patch"),
      actorClaims: [],
      allActiveClaims: [],
    };

    const items = runOperationValidation(ctx);
    expect(items).toHaveLength(2);
    expect(items[0].check).toBe("format");
    expect(items[1].check).toBe("coverage");
  });

  it("runOperationValidation filters validators by target resource type", () => {
    registerOperationValidator({
      name: "file_only",
      operationTypes: [],
      resourceTypes: ["file"],
      validate: () => [{ check: "file", passed: true, detail: "file ok" }],
    });
    registerOperationValidator({
      name: "image_only",
      operationTypes: [],
      resourceTypes: ["image"],
      validate: () => [{ check: "image", passed: true, detail: "image ok" }],
    });
    registerOperationValidator({
      name: "universal",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [{ check: "universal", passed: true, detail: "universal ok" }],
    });

    const ctx: OperationValidationContext = {
      operation: makeOperation("image_edit", [
        { type: "image", locator: "assets/logo.png", metadata: "", scope: "file" as const },
      ]),
      actorClaims: [],
      allActiveClaims: [],
    };

    const items = runOperationValidation(ctx);
    expect(items.map(i => i.check)).toEqual(["image", "universal"]);
  });

  it("clearValidatorRegistry removes all validators", () => {
    registerOperationValidator({
      name: "v",
      operationTypes: [],
      resourceTypes: [],
      validate: () => [],
    });
    expect(getValidatorsForOperation("any")).toHaveLength(1);
    clearValidatorRegistry();
    expect(getValidatorsForOperation("any")).toHaveLength(0);
  });
});
