import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { logEvent } from "../repositories/_shared.js";
import { EventType } from "syncpoint-kernel";
import type { ResourceClaim } from "syncpoint-kernel";
import { rcList } from "./resource-claim-service.js";

export interface FilePermissionGuardState {
  sessionId: string;
  projectRoot: string;
  lockedFiles: Map<string, { originalMode: number; originalReadOnly: boolean; lockedAt: string; lockedBy: string }>;
}

interface GuardStateEntry {
  locator: string;
  originalMode: number;
  originalReadOnly: boolean;
  lockedAt: string;
  lockedBy: string;
}

interface GuardStateFile {
  version: number;
  guards: Record<string, { projectRoot: string; lockedFiles: GuardStateEntry[] }>;
}

const GUARD_STATE_VERSION = 1;
const GUARD_STATE_DIR = ".syncpoint";
const GUARD_STATE_FILE = "guard_state.json";

const activeGuards = new Map<string, FilePermissionGuardState>();
const isWindows = os.platform() === "win32";

export function __clearFilePermissionGuardsForTest(): void {
  activeGuards.clear();
}

// ── Platform-aware file locking ─────────────────────

function setReadOnly(filePath: string): { originalMode: number; originalReadOnly: boolean } | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const originalMode = stat.mode;
    const originalReadOnly = isWindows ? isWindowsReadOnly(filePath) : false;
    if (isWindows) {
      setWindowsReadOnly(filePath);
    } else {
      const readOnlyMode = makeReadOnly(originalMode);
      if (originalMode !== readOnlyMode) fs.chmodSync(filePath, readOnlyMode);
    }
    return { originalMode, originalReadOnly };
  } catch { return null; }
}

function restoreWritable(filePath: string, originalMode: number, originalReadOnly: boolean): void {
  try {
    if (!fs.existsSync(filePath)) return;
    if (isWindows) { if (!originalReadOnly) clearWindowsReadOnly(filePath); }
    else { fs.chmodSync(filePath, originalMode); }
  } catch { /* best-effort */ }
}

function isWindowsReadOnly(filePath: string): boolean {
  try { return (fs.statSync(filePath).mode & 0o200) === 0; } catch { return false; }
}

function setWindowsReadOnly(filePath: string): void {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    execSync(`attrib +R "${filePath}"`, { windowsHide: true });
  } catch {
    try { fs.chmodSync(filePath, fs.statSync(filePath).mode & ~0o222); } catch { /* no-op */ }
  }
}

function clearWindowsReadOnly(filePath: string): void {
  try {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    execSync(`attrib -R "${filePath}"`, { windowsHide: true });
  } catch {
    try { fs.chmodSync(filePath, fs.statSync(filePath).mode | 0o200); } catch { /* no-op */ }
  }
}

// ── Guard state persistence ──────────────────────────

function getGuardStatePath(projectRoot: string): string {
  return path.join(projectRoot, GUARD_STATE_DIR, GUARD_STATE_FILE);
}

function persistGuardState(projectRoot: string): void {
  const statePath = getGuardStatePath(projectRoot);
  try {
    const stateDir = path.dirname(statePath);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const fileState: GuardStateFile = { version: GUARD_STATE_VERSION, guards: {} };
    for (const [sessionId, guard] of activeGuards) {
      if (guard.projectRoot !== projectRoot) continue;
      fileState.guards[sessionId] = {
        projectRoot: guard.projectRoot,
        lockedFiles: Array.from(guard.lockedFiles.entries()).map(([locator, info]) => ({
          locator, originalMode: info.originalMode, originalReadOnly: info.originalReadOnly,
          lockedAt: info.lockedAt, lockedBy: info.lockedBy,
        })),
      };
    }
    fs.writeFileSync(statePath, JSON.stringify(fileState, null, 2), "utf-8");
  } catch { /* best-effort */ }
}

export function recoverGuardState(projectRoot: string): { recovered: string[]; errors: string[] } {
  const statePath = getGuardStatePath(projectRoot);
  const recovered: string[] = []; const errors: string[] = [];
  try {
    if (!fs.existsSync(statePath)) return { recovered, errors };
    const state: GuardStateFile = JSON.parse(fs.readFileSync(statePath, "utf-8"));
    if (state.version !== GUARD_STATE_VERSION) {
      errors.push(`Guard state version ${state.version} not supported`);
      return { recovered, errors };
    }
    for (const [_sid, gd] of Object.entries(state.guards)) {
      for (const entry of gd.lockedFiles) {
        const fp = path.resolve(gd.projectRoot, entry.locator);
        try { if (fs.existsSync(fp)) { restoreWritable(fp, entry.originalMode, entry.originalReadOnly); recovered.push(entry.locator); } }
        catch (e) { errors.push(`${entry.locator}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }
    fs.unlinkSync(statePath);
  } catch (e) { errors.push(`Failed to read guard state: ${e instanceof Error ? e.message : String(e)}`); }
  return { recovered, errors };
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
  const lockedFiles = new Map<string, { originalMode: number; originalReadOnly: boolean; lockedAt: string; lockedBy: string }>();
  const nowTs = new Date().toISOString();

  for (const locator of locators) {
    const filePath = path.resolve(input.projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) { skipped.push(locator); continue; }
      const result = setReadOnly(filePath);
      if (result) {
        lockedFiles.set(locator, {
          originalMode: result.originalMode,
          originalReadOnly: result.originalReadOnly,
          lockedAt: nowTs,
          lockedBy: input.guardSessionId,
        });
        locked.push(locator);
      } else {
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

  persistGuardState(input.projectRoot);

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

  for (const [locator, info] of guard.lockedFiles) {
    const filePath = path.resolve(guard.projectRoot, locator);
    try {
      restoreWritable(filePath, info.originalMode, info.originalReadOnly);
      unlocked.push(locator);
    } catch (error) {
      errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  activeGuards.delete(guardSessionId);
  persistGuardState(guard.projectRoot);
  return { unlocked, errors };
}

/**
 * Emergency unlock: restore all locked files across all guards.
 */
export function unlockAllGuards(projectRoot?: string): { unlocked: string[]; errors: string[] } {
  const unlocked: string[] = [];
  const errors: string[] = [];

  const guardsToProcess = projectRoot
    ? [...activeGuards.values()].filter(g => g.projectRoot === projectRoot)
    : [...activeGuards.values()];

  for (const guard of guardsToProcess) {
    for (const [locator, info] of guard.lockedFiles) {
      const filePath = path.resolve(guard.projectRoot, locator);
      try {
        restoreWritable(filePath, info.originalMode, info.originalReadOnly);
        unlocked.push(locator);
      } catch (error) {
        errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    activeGuards.delete(guard.sessionId);
    persistGuardState(guard.projectRoot);
  }

  // Also recover from persisted state if projectRoot specified
  if (projectRoot) {
    const recovery = recoverGuardState(projectRoot);
    unlocked.push(...recovery.recovered);
    errors.push(...recovery.errors);
  }

  return { unlocked, errors };
}

export function temporarilyUnlockForWrite(
  projectRoot: string,
  locators: string[],
): { restore: () => void } {
  const saved: Array<{ filePath: string; mode: number; wasReadOnly: boolean }> = [];

  for (const locator of locators) {
    const filePath = path.resolve(projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) continue;
      const stat = fs.statSync(filePath);
      if (!isWritable(stat.mode)) {
        const wasReadOnly = isWindows ? isWindowsReadOnly(filePath) : false;
        if (isWindows) { clearWindowsReadOnly(filePath); }
        else { fs.chmodSync(filePath, makeWritable(stat.mode)); }
        saved.push({ filePath, mode: stat.mode, wasReadOnly });
      }
    } catch {
      // If we can't check/unlock, writeApply will fail with EACCES — that's the correct behavior
    }
  }

  return {
    restore() {
      for (const { filePath, mode, wasReadOnly } of saved) {
        try {
          if (!fs.existsSync(filePath)) continue;
          if (isWindows) { if (wasReadOnly) setWindowsReadOnly(filePath); }
          else { fs.chmodSync(filePath, mode); }
        } catch { /* best-effort */ }
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
  const nowTs = new Date().toISOString();

  for (const locator of locators) {
    if (guard.lockedFiles.has(locator)) continue;
    const filePath = path.resolve(guard.projectRoot, locator);
    try {
      if (!fs.existsSync(filePath)) continue;
      const result = setReadOnly(filePath);
      if (result) {
        guard.lockedFiles.set(locator, {
          originalMode: result.originalMode,
          originalReadOnly: result.originalReadOnly,
          lockedAt: nowTs,
          lockedBy: input.guardSessionId,
        });
        newLocks.push(locator);
      }
    } catch (error) {
      errors.push(`${locator}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  persistGuardState(guard.projectRoot);
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
