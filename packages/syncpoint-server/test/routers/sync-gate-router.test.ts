/**
 * Tests for sync-gate router — Sync gate request, ack, vote, status.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { sgRequest, sgAck, sgVote, sgStatusDetailed } from "../../src/application/_exports/review-operation-status.js";
import { SyncGateStatus } from "syncpoint-kernel";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-gate-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agent1Id = repo.createAgent({ name: "gate-a1", provider: "cursor", role: "frontend" }).id;
  agent2Id = repo.createAgent({ name: "gate-a2", provider: "claude-code", role: "backend" }).id;
  taskId = repo.createTask({ title: "Gate router task" }).id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("sync gate router", () => {
  let gateId: string;

  it("requests a sync gate", () => {
    const r = sgRequest({ taskId, requestedByAgentId: agent1Id, requiredAgentIds: [agent1Id, agent2Id], reason: "manual_request" });
    expect(r.gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    gateId = r.gate.id;
  });

  it("returns detailed status", () => {
    const detail = sgStatusDetailed(gateId, agent1Id);
    expect(detail.gate.status).toBeDefined();
    expect(detail.policy.kind).toBeDefined();
    expect(detail.pendingAgentIds).toContain(agent2Id);
  });

  it("agent can ack", () => {
    sgAck(gateId, agent1Id);
    const detail = sgStatusDetailed(gateId);
    expect(detail.ackedAgentIds).toContain(agent1Id);
  });

  it("agent can vote", () => {
    const result = sgVote(gateId, agent1Id, "approve", "looks good");
    expect(result.gate).toBeDefined();
    const detail = sgStatusDetailed(gateId);
    expect(detail.voteCounts.approve).toBeGreaterThanOrEqual(1);
  });
});
