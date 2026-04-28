/**
 * Integration tests for FileClaim Service — file ownership and conflict detection.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../src/db.js";
import * as repo from "../../src/repositories.js";
import { fcClaimFiles, fcReleaseClaim, fcListClaims, fcDetectConflicts } from "./file-claim-service.js";
import { FileClaimStatus } from "syncpoint-core";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let task1Id: string;
let task2Id: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-fc-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  const a1 = repo.createAgent({ name: "agent-a", provider: "codex", role: "backend" });
  const a2 = repo.createAgent({ name: "agent-b", provider: "cursor", role: "backend" });
  agent1Id = a1.id;
  agent2Id = a2.id;

  const t1 = repo.createTask({ title: "Auth module", description: "" });
  const t2 = repo.createTask({ title: "API module", description: "" });
  task1Id = t1.id;
  task2Id = t2.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("FileClaim Service", () => {
  let claim1Id: string;

  it("creates a file claim with no conflicts", () => {
    const result = fcClaimFiles({
      agentId: agent1Id,
      taskId: task1Id,
      paths: "src/auth.ts, src/auth/*.ts",
    });
    expect(result.claim.status).toBe(FileClaimStatus.ACTIVE);
    expect(result.claim.agentId).toBe(agent1Id);
    expect(result.conflicts).toHaveLength(0);
    claim1Id = result.claim.id;
  });

  it("detects conflict when second agent claims overlapping files", () => {
    const result = fcClaimFiles({
      agentId: agent2Id,
      taskId: task2Id,
      paths: "src/auth.ts",
    });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].isHardConflict).toBe(true);
  });

  it("fcDetectConflicts finds all active conflicts", () => {
    const conflicts = fcDetectConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it("fcListClaims filters by agent", () => {
    const claims = fcListClaims({ agentId: agent1Id });
    expect(claims.length).toBe(1);
    expect(claims[0].agentId).toBe(agent1Id);
  });

  it("releasing a claim resolves the conflict", () => {
    const released = fcReleaseClaim(claim1Id);
    expect(released.status).toBe(FileClaimStatus.RELEASED);

    const conflicts = fcDetectConflicts();
    // No more conflicts since agent1's claim is released
    expect(conflicts).toHaveLength(0);
  });

  it("no conflicts when agents claim different files", () => {
    const r1 = fcClaimFiles({ agentId: agent1Id, taskId: task1Id, paths: "lib/utils.ts" });
    const r2 = fcClaimFiles({ agentId: agent2Id, taskId: task2Id, paths: "lib/config.ts" });
    expect(r1.conflicts).toHaveLength(0);
    expect(r2.conflicts).toHaveLength(0);
  });

  it("shared mode creates soft conflicts", () => {
    const r1 = fcClaimFiles({ agentId: agent1Id, taskId: task1Id, paths: "shared/types.ts", mode: "shared" });
    expect(r1.conflicts).toHaveLength(0);

    const r2 = fcClaimFiles({ agentId: agent2Id, taskId: task2Id, paths: "shared/types.ts", mode: "shared" });
    expect(r2.conflicts.length).toBeGreaterThan(0);
    expect(r2.conflicts[0].isHardConflict).toBe(false);
  });
});
