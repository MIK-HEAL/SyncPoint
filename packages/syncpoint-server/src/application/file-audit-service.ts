import {
  EventType,
  FileAuditDecisionKind,
  SyncGateReason,
  evaluateFileAuditChange,
  gateMatchesResource,
} from "syncpoint-core";
import type { FileAuditDecision, FileAuditGateContext, ResourceClaim, ResourceRef, SyncGate } from "syncpoint-core";
import * as protocolRepo from "../repositories/_exports/protocol.js";
import { logEvent } from "../repositories/_shared.js";
import { rcList } from "./resource-claim-service.js";
import { sgCheckAgent, sgListActive, sgRequest } from "./sync-gate-service.js";

export interface AuditFileChangeInput {
  actorId: string;
  taskId: string;
  sessionId?: string;
  locator: string;
  auditOnly?: boolean;
}

export interface AuditFileChangeResult {
  decision: FileAuditDecision;
  eventType: EventType;
  gateId?: string;
  reusedGate: boolean;
}

export function auditListActiveResourceClaims(input: {
  taskId?: string;
  sessionId?: string;
}): ResourceClaim[] {
  return rcList({
    sessionId: input.sessionId,
    resourceType: "file",
    status: "ACTIVE",
  });
}

export function auditFileChange(input: AuditFileChangeInput): AuditFileChangeResult {
  const changedResource: ResourceRef = { type: "file", locator: input.locator, metadata: "" };
  const activeClaims = auditListActiveResourceClaims({
    taskId: input.taskId,
    sessionId: input.sessionId,
  });
  const blockingGates = sgCheckAgent(input.actorId, {
    taskId: input.taskId,
    sessionId: input.sessionId,
  }).blockingGates.map(toAuditGateContext);
  const decision = evaluateFileAuditChange({
    actorId: input.actorId,
    changedResource,
    activeClaims,
    blockingGates,
  });
  const gateResult = maybeCreateOrUpdateGate(input, changedResource, decision);
  const eventType = eventTypeForDecision(decision.kind);

  logEvent(
    eventType,
    "file_audit",
    input.locator,
    JSON.stringify({
      actorId: input.actorId,
      taskId: input.taskId,
      sessionId: input.sessionId ?? "",
      locator: input.locator,
      decision: decision.kind,
      ownClaimIds: decision.ownClaims.map(claim => claim.id),
      conflictingClaimIds: decision.conflictingClaims.map(claim => claim.id),
      relatedBlockingGateIds: decision.relatedBlockingGateIds,
      gateId: gateResult.gateId ?? "",
      reusedGate: gateResult.reusedGate,
      auditOnly: input.auditOnly === true,
    }),
  );

  return {
    decision,
    eventType,
    gateId: gateResult.gateId,
    reusedGate: gateResult.reusedGate,
  };
}

function eventTypeForDecision(kind: FileAuditDecisionKind): EventType {
  if (kind === FileAuditDecisionKind.FILE_POLLUTION_DETECTED) return EventType.FILE_POLLUTION_DETECTED;
  if (kind === FileAuditDecisionKind.FILE_AUDIT_ALERT) return EventType.FILE_AUDIT_ALERT;
  return EventType.FILE_CHANGED;
}

function maybeCreateOrUpdateGate(
  input: AuditFileChangeInput,
  changedResource: ResourceRef,
  decision: FileAuditDecision,
): { gateId?: string; reusedGate: boolean } {
  if (input.auditOnly === true) {
    return { reusedGate: false };
  }

  if (decision.kind === FileAuditDecisionKind.FILE_AUDIT_ALERT) {
    const gateId = decision.relatedBlockingGateIds[0];
    if (gateId) {
      appendAuditNote(gateId, `File audit alert: ${input.locator} changed by ${input.actorId} while blocked.`);
      return { gateId, reusedGate: true };
    }
  }

  if (!decision.shouldCreateGate) {
    return { reusedGate: false };
  }

  const existing = findExistingPollutionGate(input, changedResource);
  if (existing) {
    appendAuditNote(existing.id, `File pollution detected again: ${input.locator} changed by ${input.actorId}.`);
    return { gateId: existing.id, reusedGate: true };
  }

  const conflictingActors = [...new Set(decision.conflictingClaims.map(claim => claim.actorId))];
  const relatedClaimIds = [...new Set(decision.conflictingClaims.map(claim => claim.id))];
  const relatedResources = [
    changedResource,
    ...decision.conflictingClaims.flatMap(claim => claim.resources),
  ];
  const result = sgRequest({
    sessionId: input.sessionId,
    taskId: input.taskId,
    requestedByAgentId: input.actorId,
    requiredAgentIds: [...new Set([input.actorId, ...conflictingActors])],
    reason: SyncGateReason.RESOURCE_CONFLICT,
    description: `File pollution detected: ${input.locator} changed by ${input.actorId}; claimed by ${conflictingActors.join(", ")}.`,
    relatedFiles: [input.locator],
    relatedResources,
    relatedClaimIds,
  });

  return { gateId: result.gate.id, reusedGate: false };
}

function findExistingPollutionGate(input: AuditFileChangeInput, changedResource: ResourceRef): SyncGate | undefined {
  return sgListActive({
    taskId: input.taskId,
    sessionId: input.sessionId,
  }).find(gate =>
    gate.reason === SyncGateReason.RESOURCE_CONFLICT &&
    gateMatchesResource(toAuditGateContext(gate), changedResource),
  );
}

function appendAuditNote(gateId: string, note: string): void {
  const gate = protocolRepo.getSyncGate(gateId);
  if (gate.description.includes(note)) return;
  protocolRepo.updateSyncGateDescription(gateId, gate.description ? `${gate.description} ${note}` : note);
}

function toAuditGateContext(gate: SyncGate): FileAuditGateContext {
  return {
    id: gate.id,
    relatedFiles: gate.relatedFiles,
    relatedResources: gate.relatedResources,
  };
}
