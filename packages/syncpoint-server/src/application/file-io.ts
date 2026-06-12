/**
 * File I/O utilities — path security, atomic writes, resource hashing.
 * Extracted from write-permit-service.ts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ForbiddenError, normalizeResourcePath } from "syncpoint-kernel";
import type { ResourceRef, WriteResourceHash } from "syncpoint-kernel";
import { getSyncpointDir } from "../db.js";

// ── Path resolution ──────────────────────────────────

export function resolveRootDir(): string {
  const envRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  if (envRoot) return canonicalRoot(envRoot);
  return canonicalRoot(path.dirname(getSyncpointDir()));
}

export function canonicalRoot(root: string): string {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function resolveNativeLocator(root: string, locator: string): string {
  const native = path.resolve(locator);
  if (path.isAbsolute(native)) return native;
  return path.resolve(root, locator);
}

export function normalizeFileLocator(locator: string, root: string): string {
  return normalizeResourcePath(locator, { projectRoot: root });
}

// ── Path containment ─────────────────────────────────

export function isInsideOrSame(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolve a resource locator to a filesystem path, with containment checks.
 * Throws ForbiddenError if the resolved path escapes the guarded root.
 */
export function safeResolve(root: string, locator: string): string {
  const target = resolveNativeLocator(root, locator);
  if (!isInsideOrSame(root, target)) {
    throw new ForbiddenError("filesystem_write", `Refusing to write outside guarded root: ${locator}`);
  }
  const realTarget = realpathForContainmentCheck(target);
  if (!isInsideOrSame(root, realTarget)) {
    throw new ForbiddenError("filesystem_write", `Refusing to follow path outside guarded root: ${locator}`);
  }
  return target;
}

export function realpathForContainmentCheck(target: string): string {
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

// ── Atomic write ─────────────────────────────────────

/**
 * Write file atomically: write to temp file, then rename into place.
 * Uses .syncpoint-tmp-{pid}-{ts} naming to avoid collisions.
 */
export function atomicWriteFile(target: string, content: Buffer): void {
  const tmp = `${target}.syncpoint-tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

// ── Resource hashing ─────────────────────────────────

export function readResourceHash(root: string, resource: ResourceRef): { sha256?: string; exists: boolean } {
  if (resource.type !== "file") return { exists: false };
  const file = safeResolve(root, resource.locator);
  if (!fs.existsSync(file)) return { exists: false };
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { exists: false };
  const hash = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  return { exists: true, sha256: hash };
}

export function resolveBaseHashes(resources: ResourceRef[], root: string): WriteResourceHash[] {
  return resources.map(resource => ({ resource, ...readResourceHash(root, resource) }));
}

// ── Resource comparison ──────────────────────────────

export function sameResource(a: ResourceRef, b: ResourceRef): boolean {
  return a.type === b.type && a.locator === b.locator;
}
