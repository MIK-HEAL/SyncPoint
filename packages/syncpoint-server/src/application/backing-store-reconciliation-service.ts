import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventType, SyncGateReason } from "syncpoint-core";
import type { ResourceRef } from "syncpoint-core";
import * as repo from "../repositories.js";
import { logEvent, now } from "../repositories/_shared.js";
import { getSyncpointDir } from "../db.js";
import { sgRequest, sgListActive } from "./sync-gate-service.js";
import { rcList } from "./resource-claim-service.js";

export interface ReconcileInput {
  taskId: string;
  sessionId?: string;
}

export interface ReconcileResult {
  scannedFiles: number;
  bypassesDetected: number;
  gatesCreated: string[];
  gatesReused: string[];
}

export interface ReconcileFileResult {
  locator: string;
  bypassed: boolean;
  gateId?: string;
  reusedGate: boolean;
}

const lastKnownHashes = new Map<string, string>();

export function __clearReconciliationStateForTest(): void {
  lastKnownHashes.clear();
}

export function recordAuthorizedWrite(root: string, locator: string): void {
  const filePath = path.resolve(root, locator);
  try {
    const hash = hashFile(filePath);
    lastKnownHashes.set(normalizeKey(root, locator), hash);
  } catch {
    lastKnownHashes.delete(normalizeKey(root, locator));
  }
}

export function reconcileBackingStore(input: ReconcileInput): ReconcileResult {
  const root = resolveProjectRoot();
  const claims = rcList({
    sessionId: input.sessionId,
    resourceType: "file",
    status: "ACTIVE",
  });

  const locators = new Set<string>();
  for (const claim of claims) {
    for (const resource of claim.resources) {
      if (resource.type === "file") locators.add(resource.locator);
    }
  }

  const result: ReconcileResult = {
    scannedFiles: 0,
    bypassesDetected: 0,
    gatesCreated: [],
    gatesReused: [],
  };

  for (const locator of locators) {
    const fileResult = reconcileFile(root, locator, claims, input);
    result.scannedFiles++;
    if (fileResult.bypassed) {
      result.bypassesDetected++;
      if (fileResult.gateId) {
        if (fileResult.reusedGate) result.gatesReused.push(fileResult.gateId);
        else result.gatesCreated.push(fileResult.gateId);
      }
    }
  }

  return result;
}

function reconcileFile(
  root: string,
  locator: string,
  claims: ReturnType<typeof rcList>,
  input: ReconcileInput,
): ReconcileFileResult {
  const key = normalizeKey(root, locator);
  const filePath = path.resolve(root, locator);
  let currentHash: string | undefined;

  try {
    currentHash = hashFile(filePath);
  } catch {
    // File doesn't exist — if we had a known hash, that's a bypass (delete)
    if (lastKnownHashes.has(key)) {
      lastKnownHashes.delete(key);
      return handleBypass(root, locator, claims, input);
    }
    return { locator, bypassed: false, reusedGate: false };
  }

  const knownHash = lastKnownHashes.get(key);

  if (knownHash === undefined) {
    // First time seeing this file — record baseline, no bypass
    lastKnownHashes.set(key, currentHash);
    return { locator, bypassed: false, reusedGate: false };
  }

  if (knownHash === currentHash) {
    return { locator, bypassed: false, reusedGate: false };
  }

  // Hash changed without going through writeApply — bypass detected
  lastKnownHashes.set(key, currentHash);
  return handleBypass(root, locator, claims, input);
}

function handleBypass(
  root: string,
  locator: string,
  claims: ReturnType<typeof rcList>,
  input: ReconcileInput,
): ReconcileFileResult {
  const resource: ResourceRef = { type: "file", locator, metadata: "" };
  const affectedClaims = claims.filter(claim =>
    claim.resources.some(r => r.type === "file" && r.locator === locator),
  );
  const affectedActorIds = [...new Set(affectedClaims.map(c => c.actorId))];
  const relatedClaimIds = affectedClaims.map(c => c.id);

  logEvent(
    EventType.BACKING_STORE_BYPASS_DETECTED,
    "backing_store_reconciliation",
    locator,
    JSON.stringify({
      taskId: input.taskId,
      sessionId: input.sessionId ?? "",
      locator,
      affectedActorIds,
      relatedClaimIds,
      detectedAt: now(),
    }),
  );

  // Check for existing bypass gate for this resource
  const existingGate = sgListActive({ taskId: input.taskId, sessionId: input.sessionId })
    .find(g =>
      g.reason === SyncGateReason.BACKING_STORE_BYPASS &&
      (g.relatedFiles.includes(locator) ||
        parseRelatedResources(g.relatedResourcesJson).some(r => r.locator === locator)),
    );

  if (existingGate) {
    // Update description with new detection
    const gate = repo.getSyncGate(existingGate.id);
    const note = `Backing store bypass detected again: ${locator} (${now()})`;
    if (!gate.description.includes(note)) {
      repo.updateSyncGateDescription(existingGate.id, `${gate.description} ${note}`);
    }
    return { locator, bypassed: true, gateId: existingGate.id, reusedGate: true };
  }

  // Create a new BACKING_STORE_BYPASS gate
  const requiredAgentIds = affectedActorIds.length > 0 ? affectedActorIds : ["unknown"];
  const result = sgRequest({
    sessionId: input.sessionId,
    taskId: input.taskId,
    requestedByAgentId: "syncpoint-reconciler",
    requiredAgentIds,
    reason: SyncGateReason.BACKING_STORE_BYPASS,
    description: `Backing store bypass detected: ${locator} was modified outside SyncPoint. Claimed by: ${affectedActorIds.join(", ") || "unknown"}.`,
    relatedFiles: locator,
    relatedResourcesJson: JSON.stringify([resource]),
    relatedClaimIds: relatedClaimIds.join(","),
  });

  return { locator, bypassed: true, gateId: result.gate.id, reusedGate: false };
}

function resolveProjectRoot(): string {
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  if (envRoot) return canonicalRoot(envRoot);
  return canonicalRoot(path.dirname(getSyncpointDir()));
}

function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function normalizeKey(root: string, locator: string): string {
  return `${root}::${locator.replace(/\\/g, "/")}`;
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function parseRelatedResources(json: string): ResourceRef[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
