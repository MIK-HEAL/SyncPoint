import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  EventType,
  WriteIntent,
  WriteDecisionReason,
  WritePermitStatus,
  evaluateConstraints,
  evaluateWriteDecision,
  type ResourceRef,
  type WriteDecision,
  type WritePermit,
  type WriteResourceHash,
} from "syncpoint-core";
import * as repo from "../repositories.js";
import { getSyncpointDir } from "../db.js";
import { logEvent, now } from "../repositories/_shared.js";
import { buildProjection } from "./reality-projection-service.js";
import { sgReconcileActive } from "./sync-gate-service.js";
import { recordAuthorizedWrite } from "./backing-store-reconciliation-service.js";
import { temporarilyUnlockForWrite } from "./file-permission-guard.js";

export interface WriteCheckInput {
  actorId: string;
  taskId: string;
  sessionId?: string;
  resources: ResourceRef[];
  intent: WriteIntent;
  operationId?: string;
  baseHashes?: WriteResourceHash[];
}

export interface WritePrepareInput extends WriteCheckInput {
  ttlSeconds?: number;
  singleUse?: boolean;
}

export interface FileMutation {
  resource: ResourceRef;
  content?: string;
  contentBase64?: string;
  delete?: boolean;
}

export interface WriteApplyInput {
  permitId: string;
  mutations: FileMutation[];
}

export interface WriteCheckResult {
  decision: WriteDecision;
  baseHashes: WriteResourceHash[];
}

export interface WritePrepareResult extends WriteCheckResult {
  permit: WritePermit;
}

export interface WriteApplyResult {
  permit: WritePermit;
  applied: Array<{ locator: string; sha256?: string; exists: boolean }>;
}

const DEFAULT_EDITOR_TTL_SECONDS = 30;
const DEFAULT_BATCH_TTL_SECONDS = 300;

export function writeCheck(input: WriteCheckInput): WriteCheckResult {
  return writeCheckAtRoot(input, resolveRootDir());
}

function writeCheckAtRoot(input: WriteCheckInput, root: string): WriteCheckResult {
  const baseHashes = input.baseHashes ?? resolveBaseHashes(input.resources, root);
  const decision = evaluateWriteDecision({
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    resources: input.resources,
    intent: input.intent,
    operation: input.operationId ? repo.getOperation(input.operationId) : undefined,
    activeClaims: repo.listActiveResourceClaims({ sessionId: input.sessionId }),
    activeGates: activeGates(input.taskId, input.sessionId),
    constraintDecision: writeConstraintDecision(input),
  });

  logEvent(
    EventType.WRITE_PERMIT_REQUESTED,
    "write_permit",
    input.operationId ?? "check",
    JSON.stringify({
      actorId: input.actorId,
      taskId: input.taskId,
      sessionId: input.sessionId ?? "",
      resources: input.resources,
      intent: input.intent,
      permitted: decision.permitted,
    }),
  );

  if (!decision.permitted) {
    logEvent(EventType.WRITE_PERMIT_DENIED, "write_permit", input.operationId ?? "check", JSON.stringify(decision));
  }

  return { decision, baseHashes };
}

export function writePrepare(input: WritePrepareInput): WritePrepareResult {
  const root = resolveRootDir();
  const result = writeCheckAtRoot(input, root);
  const ttl = input.ttlSeconds ?? (input.intent === WriteIntent.BULK ? DEFAULT_BATCH_TTL_SECONDS : DEFAULT_EDITOR_TTL_SECONDS);
  const permit = repo.createWritePermit({
    actorId: input.actorId,
    taskId: input.taskId,
    sessionId: input.sessionId,
    resources: input.resources,
    intent: input.intent,
    operationId: input.operationId,
    guardedRoot: root,
    baseHashes: result.baseHashes,
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    singleUse: input.singleUse ?? true,
    status: result.decision.permitted ? WritePermitStatus.ISSUED : WritePermitStatus.DENIED,
    decision: result.decision,
  });

  logEvent(
    result.decision.permitted ? EventType.WRITE_PERMIT_ISSUED : EventType.WRITE_PERMIT_DENIED,
    "write_permit",
    permit.id,
    JSON.stringify({ actorId: input.actorId, taskId: input.taskId, resources: input.resources, decision: result.decision }),
  );

  return { ...result, permit };
}

export function writeApply(input: WriteApplyInput): WriteApplyResult {
  let permit = repo.getWritePermit(input.permitId);
  const root = resolveRootDir();
  const denial = validatePermitForApply(permit, input.mutations, root);
  if (denial) {
    const decision = { permitted: false, reason: WriteDecisionReason.BLOCKED, blockers: [denial], warnings: [] };
    permit = repo.updateWritePermit(permit.id, { status: WritePermitStatus.REVOKED, decision });
    logEvent(EventType.WRITE_BLOCKED, "write_permit", permit.id, JSON.stringify(decision));
    throw new Error(denial.message);
  }

  const revalidated = revalidatePermitDecision(permit);
  if (!revalidated.permitted) {
    permit = repo.updateWritePermit(permit.id, { status: WritePermitStatus.REVOKED, decision: revalidated });
    logEvent(EventType.WRITE_BLOCKED, "write_permit", permit.id, JSON.stringify(revalidated));
    throw new Error(`Write permit no longer valid: ${revalidated.blockers.map(blocker => blocker.message).join("; ")}`);
  }

  const preparedMutations = preflightMutations(permit, input.mutations, root);
  if ("denial" in preparedMutations) {
    const decision = {
      permitted: false,
      reason: WriteDecisionReason.BLOCKED,
      blockers: [preparedMutations.denial],
      warnings: [],
    };
    permit = repo.updateWritePermit(permit.id, { status: WritePermitStatus.REVOKED, decision });
    logEvent(EventType.WRITE_BLOCKED, "write_permit", permit.id, JSON.stringify(decision));
    throw new Error(preparedMutations.denial.message);
  }

  const applied: Array<{ locator: string; sha256?: string; exists: boolean }> = [];
  const locatorsToWrite = preparedMutations.mutations.map(m => m.mutation.resource.locator);
  const unlock = temporarilyUnlockForWrite(root, locatorsToWrite);

  try {
    for (const { mutation, target, content } of preparedMutations.mutations) {
      if (mutation.delete) {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        atomicWriteFile(target, content);
      }
      applied.push({ locator: mutation.resource.locator, ...readResourceHash(root, mutation.resource) });
      recordAuthorizedWrite(root, mutation.resource.locator);
    }
  } finally {
    unlock.restore();
  }

  if (permit.singleUse) {
    permit = repo.updateWritePermit(permit.id, {
      status: WritePermitStatus.CONSUMED,
      consumedAt: now(),
    });
    logEvent(EventType.WRITE_PERMIT_CONSUMED, "write_permit", permit.id, JSON.stringify({ applied }));
  }
  logEvent(EventType.WRITE_APPLIED, "write_permit", permit.id, JSON.stringify({ applied }));
  return { permit, applied };
}

function activeGates(taskId: string, sessionId?: string) {
  sgReconcileActive({ taskId, sessionId });
  return repo.listActiveSyncGates({ taskId, sessionId });
}

function revalidatePermitDecision(permit: WritePermit): WriteDecision {
  return evaluateWriteDecision({
    actorId: permit.actorId,
    taskId: permit.taskId,
    sessionId: permit.sessionId || undefined,
    resources: permit.resources,
    intent: permit.intent,
    operation: permit.operationId ? repo.getOperation(permit.operationId) : undefined,
    activeClaims: repo.listActiveResourceClaims({ sessionId: permit.sessionId || undefined }),
    activeGates: activeGates(permit.taskId, permit.sessionId || undefined),
    constraintDecision: writeConstraintDecision({
      actorId: permit.actorId,
      taskId: permit.taskId,
      sessionId: permit.sessionId || undefined,
      resources: permit.resources,
      intent: permit.intent,
      operationId: permit.operationId || undefined,
      baseHashes: permit.baseHashes,
    }),
  });
}

function writeConstraintDecision(input: WriteCheckInput) {
  try {
    const projection = buildProjection({
      taskId: input.taskId,
      workingResources: input.resources.map(resource => resource.locator),
      workingResourceRefs: input.resources,
    });
    return evaluateConstraints({
      action: "operation_apply",
      projection,
      touchedResources: input.resources,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { permitted: false, blockers: [], warnings: [], runtimeUnavailable: { message } };
  }
}

function validatePermitForApply(permit: WritePermit, mutations: FileMutation[], currentRoot: string) {
  if (permit.status !== WritePermitStatus.ISSUED) {
    return { type: "permit_status", id: permit.id, message: `Write permit is not issued: ${permit.status}` };
  }
  if (new Date(permit.expiresAt).getTime() <= Date.now()) {
    repo.updateWritePermit(permit.id, { status: WritePermitStatus.EXPIRED });
    return { type: "permit_expired", id: permit.id, message: `Write permit expired at ${permit.expiresAt}` };
  }
  if (!permit.decision.permitted) {
    return { type: "permit_denied", id: permit.id, message: "Write permit decision denied the write." };
  }
  if (!permit.guardedRoot) {
    return { type: "permit_root", id: permit.id, message: "Write permit is missing its guarded root binding." };
  }
  if (permit.guardedRoot !== currentRoot) {
    return { type: "permit_root", id: permit.id, message: "Write permit guarded root does not match the current project root." };
  }
  if (mutations.length === 0) {
    return { type: "mutation", id: permit.id, message: "write.apply requires at least one mutation." };
  }
  if (mutations.length > 1 && permit.intent !== WriteIntent.BULK) {
    return { type: "intent", id: permit.id, message: "Multiple mutations require intent 'bulk'." };
  }
  for (const mutation of mutations) {
    if (mutation.delete && permit.intent !== WriteIntent.DELETE && permit.intent !== WriteIntent.BULK) {
      return { type: "intent", id: mutation.resource.locator, message: "Delete mutations require intent 'delete' or 'bulk'." };
    }
    if (!permit.resources.some(resource => sameResource(resource, mutation.resource))) {
      return { type: "resource", id: mutation.resource.locator, message: `Mutation resource is not covered by permit: ${mutation.resource.locator}` };
    }
  }
  return null;
}

function preflightMutations(permit: WritePermit, mutations: FileMutation[], root: string): { mutations: Array<{ mutation: FileMutation; target: string; content: Buffer }> } | { denial: { type: string; id: string; message: string } } {
  const prepared = [];
  for (const mutation of mutations) {
    if (mutation.resource.type !== "file") {
      return { denial: { type: "resource", id: mutation.resource.locator, message: `Controlled write apply currently supports file resources only: ${mutation.resource.type}` } };
    }
    let target: string;
    let current: { sha256?: string; exists: boolean };
    try {
      target = safeResolve(root, mutation.resource.locator);
      current = readResourceHash(root, mutation.resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { denial: { type: "path", id: mutation.resource.locator, message } };
    }
    const base = permit.baseHashes.find(hash => sameResource(hash.resource, mutation.resource));
    if (base && (base.exists !== current.exists || base.sha256 !== current.sha256)) {
      return { denial: { type: "hash_precondition", id: mutation.resource.locator, message: `File changed since permit was issued: ${mutation.resource.locator}` } };
    }
    const content = mutation.contentBase64 !== undefined
      ? Buffer.from(mutation.contentBase64, "base64")
      : Buffer.from(mutation.content ?? "", "utf8");
    prepared.push({ mutation, target, content });
  }
  return { mutations: prepared };
}

function resolveBaseHashes(resources: ResourceRef[], root: string): WriteResourceHash[] {
  return resources.map(resource => ({ resource, ...readResourceHash(root, resource) }));
}

function readResourceHash(root: string, resource: ResourceRef): { sha256?: string; exists: boolean } {
  if (resource.type !== "file") return { exists: false };
  const file = safeResolve(root, resource.locator);
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { exists: false };
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { exists: true, sha256: hash };
}

function resolveRootDir(): string {
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

function safeResolve(root: string, locator: string): string {
  const target = path.resolve(root, locator);
  if (!isInsideOrSame(root, target)) {
    throw new Error(`Refusing to write outside guarded root: ${locator}`);
  }
  const realTarget = realpathForContainmentCheck(target);
  if (!isInsideOrSame(root, realTarget)) {
    throw new Error(`Refusing to follow path outside guarded root: ${locator}`);
  }
  return target;
}

function realpathForContainmentCheck(target: string): string {
  if (fs.existsSync(target)) return fs.realpathSync.native(target);
  let existingParent = path.dirname(target);
  while (!fs.existsSync(existingParent)) {
    const next = path.dirname(existingParent);
    if (next === existingParent) return target;
    existingParent = next;
  }
  const realParent = fs.realpathSync.native(existingParent);
  return path.resolve(realParent, path.relative(existingParent, target));
}

function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function atomicWriteFile(target: string, content: Buffer): void {
  const tmp = `${target}.syncpoint-tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

function sameResource(a: ResourceRef, b: ResourceRef): boolean {
  return a.type === b.type && a.locator === b.locator;
}
