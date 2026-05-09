/**
 * CLI smoke tests — exercises the service functions that CLI sync commands call.
 * These test that the CLI command-layer imports and wiring work end-to-end.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  sgRequest, sgAck, sgVote, sgStatus, sgStatusDetailed,
  sgList, sgCheckAgent,
} from "syncpoint-server/application";
import { SyncGateStatus } from "syncpoint-core";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-cli-test-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a1 = repo.createAgent({ name: "cli-agent-1", provider: "other", role: "other" });
  const a2 = repo.createAgent({ name: "cli-agent-2", provider: "other", role: "other" });
  agent1Id = a1.id;
  agent2Id = a2.id;
  const t = repo.createTask({ title: "CLI test task", description: "" });
  taskId = t.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI sync status --gate (sgStatusDetailed)", () => {
  it("returns detailed status with policy, pending, votes, and actions", () => {
    const r = sgRequest({
      taskId,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id],
      policy: { kind: "majority_veto" } as any,
    });
    const gid = r.gate.id;

    // Simulates: syncpoint sync status --gate <gid> --agent <agent1Id>
    const detail = sgStatusDetailed(gid, agent1Id);
    expect(detail.gate.status).toBe(SyncGateStatus.SYNC_REQUESTED);
    expect(detail.policy.kind).toBe("majority_veto");
    expect(detail.pendingAgentIds).toContain(agent1Id);
    expect(detail.pendingAgentIds).toContain(agent2Id);
    expect(detail.voteCounts.approve).toBe(0);
    expect(detail.availableActions).toBeDefined();
    expect(detail.availableActions).toContain("ack");
    expect(detail.availableActions).toContain("vote");
  });
});

describe("CLI sync vote (sgVote)", () => {
  it("casts a vote and reflects in detailed status", () => {
    const r = sgRequest({
      taskId,
      requestedByAgentId: agent1Id,
      requiredAgentIds: [agent1Id, agent2Id],
      policy: { kind: "majority_veto" } as any,
    });
    const gid = r.gate.id;

    // Simulates: syncpoint sync vote --gate <gid> --agent <agent1Id> --vote approve
    const voteResult = sgVote(gid, agent1Id, "approve", "CLI test vote");
    expect(voteResult.gate).toBeDefined();

    // Verify vote is reflected in detailed status
    const detail = sgStatusDetailed(gid);
    expect(detail.voteCounts.approve).toBe(1);
    expect(detail.votes.length).toBe(1);
    expect(detail.votes[0].vote).toBe("approve");
    expect(detail.votes[0].summary).toBe("CLI test vote");
  });
});

describe("CLI sync status (list mode)", () => {
  it("lists gates and checks agent block status", () => {
    // Simulates: syncpoint sync status --task <taskId>
    const gates = sgList({ taskId });
    expect(gates.length).toBeGreaterThan(0);

    // Simulates: syncpoint sync status --agent <agent1Id> --task <taskId>
    const block = sgCheckAgent(agent1Id, { taskId });
    expect(typeof block.blocked).toBe("boolean");
    expect(Array.isArray(block.blockingGates)).toBe(true);
  });
});
