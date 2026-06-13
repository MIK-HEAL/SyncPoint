/**
 * Demo core — shared types and helpers for demo commands.
 */

import fs from "node:fs";
import path from "node:path";
import { getSyncpointDir, initSyncpointDir } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import type { Snapshot } from "./formatter.js";

// ── Types ────────────────────────────────────────────────

export interface DemoResult {
  ok: true;
  projectRoot: string;
  syncpointDir: string;
  reportPath: string;
  memoryPath: string;
  agents: {
    architectId: string;
    executorId: string;
    reviewerId: string;
  };
  taskId: string;
  contractId: string;
  sessionId: string;
  assignmentId: string;
  reviewRequestId: string;
  approvalRecordId: string;
  reviewDecisionId: string;
  gateStatus: string;
  sessionStatus: string;
}

// ── Setup helpers ────────────────────────────────────────

export function setupDemoProject(projectPath: string): {
  projectRoot: string;
  syncpointDir: string;
} {
  const projectRoot = path.resolve(projectPath);
  fs.mkdirSync(projectRoot, { recursive: true });
  process.chdir(projectRoot);
  const syncpointDir = initSyncpointDir(projectRoot);
  return { projectRoot, syncpointDir };
}

export { getSyncpointDir, Snapshot };
