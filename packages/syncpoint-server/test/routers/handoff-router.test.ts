/**
 * Tests for handoff router.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { loopHandoff } from "../../src/application/_exports/review-operation-status.js";
import { listPendingHandoffs, acceptHandoff } from "../../src/repositories/_exports/context-memory.js";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-ho-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  agent1Id = repo.createAgent({ name: "ho-from", provider: "cursor", role: "frontend" }).id;
  agent2Id = repo.createAgent({ name: "ho-to", provider: "claude-code", role: "backend" }).id;
  taskId = repo.createTask({ title: "Handoff router task" }).id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("handoff router", () => {
  it("creates handoff between agents", () => {
    const r = loopHandoff({ fromAgentId: agent1Id, toAgentId: agent2Id, taskId, summary: "Handoff test", progress: "50%" });
    expect(r.ok).toBe(true);
    expect(r.handoffId).toBeTruthy();
  });

  it("lists pending handoffs", () => {
    const handoffs = listPendingHandoffs();
    expect(handoffs.some((h: any) => h.fromAgentId === agent1Id)).toBe(true);
  });

  it("accepts a handoff", () => {
    const handoffs = listPendingHandoffs();
    const pending = handoffs.find((h: any) => h.fromAgentId === agent1Id);
    if (pending) {
      const accepted = acceptHandoff((pending as any).id, agent2Id);
      expect(accepted).toBeDefined();
    }
  });
});
