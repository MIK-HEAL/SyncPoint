import fs from "node:fs";
import path from "node:path";
import { logEvent } from "../repositories/_shared.js";
import { EventType } from "syncpoint-core";
import type { ResourceClaim } from "syncpoint-core";
import { rcList } from "./resource-claim-service.js";

export interface FilePermissionGuardState {
  sessionId: string;
  projectRoot: string;
  lockedFiles: Map<string, { originalMode: number }>;
}

const activeGuards = new Map<string, FilePermissionGuardState>();

export function __clearFilePermissionGuardsForTest(): void {
  activeGuards.clear();
}

export function lockClaimedFiles(input: {
  guardSessionId: string;
  projectRoot: string;
  taskId: string;
  sessionId?: string;
}): { locked: string[]; skipped: string[]; errors: string[] } {
  const claims = rcList({
    sessionId: input.sessionId,
    resourceType: "file",
    status: "ACTIVE",
  });

  const locators = collectFileLocators(claims);
  const locked: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const lockedFiles = new Map<string, { originalMode: number }>();

  for (const locator of locators) {
    const filePath = path.resolve(input.projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) {
        skipped.push(locator);
        continue;
      }
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) {
        skipped.push(locator);
        continue;
      }
      const originalMode = stat.mode;
      const readOnlyMode = makeReadOnly(originalMode);
      if (originalMode !== readOnlyMode) {
        fs.chmodSync(filePath, readOnlyMode);
        lockedFiles.set(locator, { originalMode });
        locked.push(locator);
      } else {
        // Already read-only, still track it
        lockedFiles.set(locator, { originalMode });
        skipped.push(locator);
      }
    } catch (error) {
      errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  activeGuards.set(input.guardSessionId, {
    sessionId: input.guardSessionId,
    projectRoot: input.projectRoot,
    lockedFiles,
  });

  logEvent(
    EventType.SYNC_GATE_CREATED,
    "file_permission_guard",
    input.guardSessionId,
    JSON.stringify({ locked, skipped, errors, taskId: input.taskId }),
  );

  return { locked, skipped, errors };
}

export function unlockClaimedFiles(guardSessionId: string): { unlocked: string[]; errors: string[] } {
  const guard = activeGuards.get(guardSessionId);
  if (!guard) return { unlocked: [], errors: [] };

  const unlocked: string[] = [];
  const errors: string[] = [];

  for (const [locator, { originalMode }] of guard.lockedFiles) {
    const filePath = path.resolve(guard.projectRoot, locator);
    try {
      if (fs.existsSync(filePath)) {
        fs.chmodSync(filePath, originalMode);
      }
      unlocked.push(locator);
    } catch (error) {
      errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  activeGuards.delete(guardSessionId);
  return { unlocked, errors };
}

export function temporarilyUnlockForWrite(
  projectRoot: string,
  locators: string[],
): { restore: () => void } {
  const saved: Array<{ filePath: string; mode: number }> = [];

  for (const locator of locators) {
    const filePath = path.resolve(projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!isWritable(stat.mode)) {
        const writableMode = makeWritable(stat.mode);
        fs.chmodSync(filePath, writableMode);
        saved.push({ filePath, mode: stat.mode });
      }
    } catch {
      // If we can't check/unlock, writeApply will fail with EACCES — that's the correct behavior
    }
  }

  return {
    restore() {
      for (const { filePath, mode } of saved) {
        try {
          if (fs.existsSync(filePath)) fs.chmodSync(filePath, mode);
        } catch {
          // Best-effort restore
        }
      }
    },
  };
}

export function isGuardActive(guardSessionId: string): boolean {
  return activeGuards.has(guardSessionId);
}

export function getActiveGuardForRoot(projectRoot: string): FilePermissionGuardState | undefined {
  for (const guard of activeGuards.values()) {
    if (guard.projectRoot === projectRoot) return guard;
  }
  return undefined;
}

export function refreshGuardLocks(input: {
  guardSessionId: string;
  taskId: string;
  sessionId?: string;
}): { newLocks: string[]; errors: string[] } {
  const guard = activeGuards.get(input.guardSessionId);
  if (!guard) return { newLocks: [], errors: [] };

  const claims = rcList({
    sessionId: input.sessionId,
    resourceType: "file",
    status: "ACTIVE",
  });

  const locators = collectFileLocators(claims);
  const newLocks: string[] = [];
  const errors: string[] = [];

  for (const locator of locators) {
    if (guard.lockedFiles.has(locator)) continue;
    const filePath = path.resolve(guard.projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      const originalMode = stat.mode;
      const readOnlyMode = makeReadOnly(originalMode);
      if (originalMode !== readOnlyMode) {
        fs.chmodSync(filePath, readOnlyMode);
      }
      guard.lockedFiles.set(locator, { originalMode });
      newLocks.push(locator);
    } catch (error) {
      errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { newLocks, errors };
}

function collectFileLocators(claims: ResourceClaim[]): Set<string> {
  const locators = new Set<string>();
  for (const claim of claims) {
    for (const resource of claim.resources) {
      if (resource.type === "file") locators.add(resource.locator);
    }
  }
  return locators;
}

function makeReadOnly(mode: number): number {
  // Remove write bits: owner (0o200), group (0o020), others (0o002)
  return mode & ~0o222;
}

function makeWritable(mode: number): number {
  // Add owner write bit
  return mode | 0o200;
}

function isWritable(mode: number): boolean {
  return (mode & 0o200) !== 0;
}
