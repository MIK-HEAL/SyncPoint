/**
 * Tests for resource claim repository — Claim CRUD, conflicts, release.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { rcClaim, rcRelease, rcList, rcDetectConflicts } from "../../src/application/_exports/review-operation-status.js";
import { ResourceClaimMode, ResourceClaimStatus } from "syncpoint-kernel";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repo-rc-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agent1Id = repo.createAgent({ name: "rc-a1", provider: "cursor", role: "frontend" }).id;
  agent2Id = repo.createAgent({ name: "rc-a2", provider: "claude-code", role: "backend" }).id;
  taskId = repo.createTask({ title: "RC repo task" }).id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resource claim repo", () => {
  it("creates an exclusive claim", () => {
    const claim = rcClaim({ actorId: agent1Id, taskId, resources: [{ type: "file", locator: "rc-test.ts", metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
    expect(claim.id).toBeTruthy();
    expect(claim.mode).toBe(ResourceClaimMode.EXCLUSIVE);
    expect(claim.status).toBe(ResourceClaimStatus.ACTIVE);
  });

  it("creates a shared claim", () => {
    const claim = rcClaim({ actorId: agent2Id, taskId, resources: [{ type: "file", locator: "rc-shared.ts", metadata: "", scope: "file" }], mode: ResourceClaimMode.SHARED });
    expect(claim.mode).toBe(ResourceClaimMode.SHARED);
  });

  it("lists active claims", () => {
    const claims = rcList({ status: "ACTIVE" });
    expect(claims.length).toBeGreaterThanOrEqual(2);
  });

  it("lists claims by actor", () => {
    const claims = rcList({ actorId: agent1Id, status: "ACTIVE" });
    for (const c of claims) expect(c.actorId).toBe(agent1Id);
  });

  it("releases a claim", () => {
    const claim = rcClaim({ actorId: agent1Id, taskId, resources: [{ type: "file", locator: "rc-release.ts", metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
    const released = rcRelease(claim.id);
    expect(released.status).toBe(ResourceClaimStatus.RELEASED);
  });

  it("detects conflicts between exclusive claims on same file", () => {
    rcClaim({ actorId: agent1Id, taskId, resources: [{ type: "file", locator: "rc-conflict.ts", metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
    rcClaim({ actorId: agent2Id, taskId, resources: [{ type: "file", locator: "rc-conflict.ts", metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
    const conflicts = rcDetectConflicts({ resourceType: "file" });
    const conflictOnFile = conflicts.filter(c => c.overlappingLocator === "rc-conflict.ts");
    expect(conflictOnFile.length).toBeGreaterThanOrEqual(1);
    expect(conflictOnFile[0]!.isHardConflict).toBe(true);
  });
});
