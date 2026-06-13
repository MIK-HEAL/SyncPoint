import { describe, it, expect } from "vitest";
import * as kernel from "../src/index.js";

/**
 * Verify all expected kernel exports are present and properly typed.
 * This doubles as a smoke test for the barrel index.
 */
describe("kernel index exports", () => {
  it("exports ResourceClaim types", () => {
    expect(kernel.ResourceRefSchema).toBeDefined();
    expect(kernel.ResourceClaimSchema).toBeDefined();
    expect(kernel.ResourceClaimCreateSchema).toBeDefined();
    expect(kernel.ResourceScope).toBeDefined();
    expect(kernel.ResourceClaimStatus).toBeDefined();
    expect(kernel.ResourceClaimMode).toBeDefined();
    expect(kernel.resourceLocatorsOverlap).toBeTypeOf("function");
    expect(kernel.detectResourceClaimConflicts).toBeTypeOf("function");
    expect(kernel.registerResourceMatcher).toBeTypeOf("function");
  });

  it("exports path normalization", () => {
    expect(kernel.normalizeResourcePath).toBeTypeOf("function");
    expect(kernel.arePathsEquivalent).toBeTypeOf("function");
    expect(kernel.toResourceLocatorKey).toBeTypeOf("function");
  });

  it("exports SyncGate types", () => {
    expect(kernel.SyncGateStatus).toBeDefined();
    expect(kernel.SyncGateReason).toBeDefined();
    expect(kernel.SYNC_GATE_TRANSITIONS).toBeDefined();
    expect(kernel.validateSyncGateTransition).toBeTypeOf("function");
    expect(kernel.SyncGateSchema).toBeDefined();
    expect(kernel.GatePolicyKind).toBeDefined();
    expect(kernel.evaluateGateLiveness).toBeTypeOf("function");
    expect(kernel.computeAvailableActions).toBeTypeOf("function");
    expect(kernel.computeGateDetails).toBeTypeOf("function");
  });

  it("exports Operation types", () => {
    expect(kernel.OperationStatus).toBeDefined();
    expect(kernel.validateOperationTransition).toBeTypeOf("function");
    expect(kernel.OperationSchema).toBeDefined();
    expect(kernel.OperationCreateSchema).toBeDefined();
  });

  it("exports validators", () => {
    expect(kernel.registerOperationValidator).toBeTypeOf("function");
    expect(kernel.getValidatorsForOperation).toBeTypeOf("function");
    expect(kernel.runOperationValidation).toBeTypeOf("function");
    expect(kernel.clearValidatorRegistry).toBeTypeOf("function");
  });

  it("exports WritePermit types", () => {
    expect(kernel.WriteIntent).toBeDefined();
    expect(kernel.WritePermitStatus).toBeDefined();
    expect(kernel.WriteDecisionReason).toBeDefined();
    expect(kernel.WritePermitSchema).toBeDefined();
    expect(kernel.evaluateWriteDecision).toBeTypeOf("function");
  });

  it("exports error classes", () => {
    expect(kernel.SyncPointError).toBeDefined();
    expect(kernel.ResourceConflictError).toBeDefined();
    expect(kernel.ResourceNotFoundError).toBeDefined();
    expect(kernel.ConstraintViolationError).toBeDefined();
    expect(kernel.UnauthorizedError).toBeDefined();
    expect(kernel.ForbiddenError).toBeDefined();
    expect(kernel.InvalidStateTransitionError).toBeDefined();
    expect(kernel.ValidationError).toBeDefined();
    expect(kernel.DatabaseError).toBeDefined();
    expect(kernel.OperationTimeoutError).toBeDefined();
    expect(kernel.InternalError).toBeDefined();
  });

  it("exports Event types", () => {
    expect(kernel.EventType).toBeDefined();
    expect(kernel.EventSchema).toBeDefined();
  });

  it("exports ApprovalGate types", () => {
    expect(kernel.ApprovalGateStatus).toBeDefined();
  });

  it("exports RelationshipMode types", () => {
    expect(kernel.RelationshipMode).toBeDefined();
    expect(kernel.MODE_PHASE_FLOW).toBeDefined();
    expect(kernel.MODE_SYNC_RULES).toBeDefined();
    expect(kernel.isValidWakeVerb).toBeTypeOf("function");
    expect(kernel.getSyncRules).toBeTypeOf("function");
    expect(kernel.isModeActionAllowed).toBeTypeOf("function");
  });

  it("exports FileAudit types", () => {
    expect(kernel.FileAuditDecisionKind).toBeDefined();
    expect(kernel.evaluateFileAuditChange).toBeTypeOf("function");
    expect(kernel.gateMatchesResource).toBeTypeOf("function");
  });
});
