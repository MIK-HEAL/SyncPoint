import { z } from "zod";
import type { Operation } from "./operation.js";
import { OperationStatus } from "./operation.js";
import type { ResourceClaim, ResourceRef } from "./resource.js";
import { ResourceClaimMode, ResourceClaimStatus, ResourceRefSchema, resourceLocatorsOverlap } from "./resource.js";
import type { SyncGate } from "./sync-gate.js";
import { isGateBlocking, parseIdList } from "./sync-gate.js";

export enum WriteIntent {
  CREATE = "create",
  MODIFY = "modify",
  DELETE = "delete",
  RENAME = "rename",
  BULK = "bulk",
}

export enum WritePermitStatus {
  ISSUED = "issued",
  CONSUMED = "consumed",
  DENIED = "denied",
  EXPIRED = "expired",
  REVOKED = "revoked",
}

export enum WriteDecisionReason {
  OWNED_CLAIM = "owned_claim",
  SHARED_CLAIM = "shared_claim",
  APPROVED_OPERATION = "approved_operation",
  ADMIN_OVERRIDE = "admin_override",
  BLOCKED = "blocked",
}

export const WriteResourceHashSchema = z.object({
  resource: ResourceRefSchema,
  sha256: z.string().optional(),
  exists: z.boolean(),
});

export type WriteResourceHash = z.infer<typeof WriteResourceHashSchema>;

export const WriteDecisionBlockerSchema = z.object({
  type: z.string(),
  id: z.string(),
  message: z.string(),
});

export type WriteDecisionBlocker = z.infer<typeof WriteDecisionBlockerSchema>;

export const WriteDecisionWarningSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export type WriteDecisionWarning = z.infer<typeof WriteDecisionWarningSchema>;

export const WriteDecisionSchema = z.object({
  permitted: z.boolean(),
  reason: z.nativeEnum(WriteDecisionReason),
  blockers: z.array(WriteDecisionBlockerSchema),
  warnings: z.array(WriteDecisionWarningSchema),
});

export type WriteDecision = z.infer<typeof WriteDecisionSchema>;

export const WritePermitSchema = z.object({
  id: z.string(),
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().default(""),
  resources: z.array(ResourceRefSchema),
  intent: z.nativeEnum(WriteIntent),
  operationId: z.string().default(""),
  guardedRoot: z.string().default(""),
  baseHashes: z.array(WriteResourceHashSchema),
  expiresAt: z.string(),
  singleUse: z.boolean(),
  status: z.nativeEnum(WritePermitStatus),
  decision: WriteDecisionSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  consumedAt: z.string().default(""),
});

export type WritePermit = z.infer<typeof WritePermitSchema>;

export const WritePermitCreateSchema = z.object({
  actorId: z.string(),
  taskId: z.string(),
  sessionId: z.string().optional(),
  resources: z.array(ResourceRefSchema).min(1),
  intent: z.nativeEnum(WriteIntent),
  operationId: z.string().optional(),
  guardedRoot: z.string(),
  baseHashes: z.array(WriteResourceHashSchema).default([]),
  expiresAt: z.string(),
  singleUse: z.boolean().default(true),
  status: z.nativeEnum(WritePermitStatus),
  decision: WriteDecisionSchema,
});

export type WritePermitCreate = z.infer<typeof WritePermitCreateSchema>;

export interface WriteConstraintDecisionInput {
  permitted: boolean;
  blockers?: Array<{ rule?: string; sourceMemoryId?: string; projectionId?: string; message: string }>;
  runtimeUnavailable?: { message: string };
}

export interface WriteDecisionInput {
  actorId: string;
  taskId: string;
  sessionId?: string;
  resources: ResourceRef[];
  intent: WriteIntent;
  operation?: Operation;
  activeClaims: ResourceClaim[];
  activeGates: SyncGate[];
  constraintDecision?: WriteConstraintDecisionInput;
}

export function evaluateWriteDecision(input: WriteDecisionInput): WriteDecision {
  const blockers: WriteDecisionBlocker[] = [];
  const warnings: WriteDecisionWarning[] = [];

  if (input.resources.length === 0) {
    blockers.push({ type: "resource", id: "", message: "Write request must include at least one resource." });
  }

  for (const resource of input.resources) {
    const parsed = ResourceRefSchema.safeParse(resource);
    if (!parsed.success) {
      blockers.push({ type: "resource", id: resource.locator ?? "", message: "Target resource is not a valid ResourceRef." });
    }
  }

  for (const gate of relevantBlockingGates(input)) {
    blockers.push({ type: "sync_gate", id: gate.id, message: `Unresolved SyncGate blocks this write: ${gate.description || gate.reason}.` });
  }

  for (const claim of conflictingExclusiveClaims(input)) {
    blockers.push({ type: "resource_claim", id: claim.id, message: `Resource is covered by another active exclusive claim owned by ${claim.actorId}.` });
  }

  if (input.constraintDecision?.runtimeUnavailable) {
    blockers.push({ type: "constraint_runtime", id: "runtime_unavailable", message: `Constraint runtime unavailable: ${input.constraintDecision.runtimeUnavailable.message}` });
  } else if (input.constraintDecision && !input.constraintDecision.permitted) {
    for (const blocker of input.constraintDecision.blockers ?? []) {
      blockers.push({
        type: "constraint_runtime",
        id: blocker.sourceMemoryId || blocker.projectionId || blocker.rule || "constraint",
        message: blocker.message,
      });
    }
  }

  const operationAuthorized = isApprovedOperationAuthorized(input);
  const coveringClaims = claimsCoveringAllResources(input);

  if (!operationAuthorized && coveringClaims.length === 0) {
    blockers.push({ type: "authorization", id: input.operation?.id ?? "", message: "Actor must own a compatible active claim or reference an approved operation for all target resources." });
  }

  if (input.operation && !operationAuthorized) {
    blockers.push({ type: "operation", id: input.operation.id, message: "Referenced operation is not approved for this actor, task, session, and target resources." });
  }

  if (blockers.length > 0) {
    return { permitted: false, reason: WriteDecisionReason.BLOCKED, blockers, warnings };
  }

  if (operationAuthorized && coveringClaims.length === 0) {
    return { permitted: true, reason: WriteDecisionReason.APPROVED_OPERATION, blockers, warnings };
  }

  const hasExclusive = coveringClaims.some(claim => claim.mode === ResourceClaimMode.EXCLUSIVE);
  return {
    permitted: true,
    reason: hasExclusive ? WriteDecisionReason.OWNED_CLAIM : WriteDecisionReason.SHARED_CLAIM,
    blockers,
    warnings,
  };
}

function relevantBlockingGates(input: WriteDecisionInput): SyncGate[] {
  return input.activeGates.filter(gate => {
    if (!isGateBlocking(gate)) return false;
    if (gate.taskId && gate.taskId !== input.taskId) return false;
    if (input.sessionId && gate.sessionId && gate.sessionId !== input.sessionId) return false;
    if (parseIdList(gate.requiredAgentIds).includes(input.actorId)) return true;
    return input.resources.some(resource => gateOverlapsResource(gate, resource));
  });
}

function gateOverlapsResource(gate: SyncGate, resource: ResourceRef): boolean {
  const related = parseRelatedResources(gate.relatedResourcesJson);
  if (related.some(candidate => resourceLocatorsOverlap(candidate, resource))) return true;
  if (resource.type !== "file") return false;
  return parseRelatedFileLocators(gate.relatedFiles).some(locator => resourceLocatorsOverlap({ type: "file", locator, metadata: "" }, resource));
}

function parseRelatedResources(json: string): ResourceRef[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(candidate => ResourceRefSchema.safeParse(candidate).success) as ResourceRef[];
  } catch {
    return [];
  }
}

function parseRelatedFileLocators(value: string): string[] {
  return value
    .split(",")
    .flatMap(part => part.split("↔"))
    .map(part => part.trim())
    .filter(Boolean);
}

function conflictingExclusiveClaims(input: WriteDecisionInput): ResourceClaim[] {
  return activeClaimsInScope(input).filter(claim => {
    if (claim.actorId === input.actorId && claim.taskId === input.taskId) return false;
    if (claim.mode !== ResourceClaimMode.EXCLUSIVE) return false;
    return input.resources.some(resource => claim.resources.some(candidate => resourceLocatorsOverlap(candidate, resource)));
  });
}

function claimsCoveringAllResources(input: WriteDecisionInput): ResourceClaim[] {
  const actorClaims = activeClaimsInScope(input).filter(claim => claim.actorId === input.actorId && claim.taskId === input.taskId);
  if (input.resources.every(resource => actorClaims.some(claim => claim.resources.some(candidate => resourceLocatorsOverlap(candidate, resource))))) {
    return actorClaims.filter(claim => input.resources.some(resource => claim.resources.some(candidate => resourceLocatorsOverlap(candidate, resource))));
  }
  return [];
}

function activeClaimsInScope(input: WriteDecisionInput): ResourceClaim[] {
  return input.activeClaims.filter(claim => {
    if (claim.status !== ResourceClaimStatus.ACTIVE) return false;
    if (input.sessionId && claim.sessionId && claim.sessionId !== input.sessionId) return false;
    return true;
  });
}

function isApprovedOperationAuthorized(input: WriteDecisionInput): boolean {
  const operation = input.operation;
  if (!operation) return false;
  if (operation.status !== OperationStatus.APPROVED) return false;
  if (operation.actorId !== input.actorId) return false;
  if (operation.taskId !== input.taskId) return false;
  if (input.sessionId && operation.sessionId && operation.sessionId !== input.sessionId) return false;
  if (operation.targetResources.length === 0) return false;
  return input.resources.every(resource => operation.targetResources.some(candidate => resourceLocatorsOverlap(candidate, resource)));
}
