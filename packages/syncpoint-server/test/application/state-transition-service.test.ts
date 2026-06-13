/**
 * Tests for state-transition-service — Validates entity state transitions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { SessionStatus } from "syncpoint-adapters";
import { InvalidStateTransitionError } from "syncpoint-kernel";

let tmpDir: string;
let sessionId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-app-sts-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const agent = repo.createAgent({ name: "sts-agent", provider: "cursor", role: "frontend" });
  const task = repo.createTask({ title: "STS task" });
  const session = repo.createSession({ title: "STS Session" });
  repo.assignRole(session.id, agent.id, "executor", "");
  repo.assignTask(task.id, agent.id);
  sessionId = session.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("state transition", () => {
  it("PLANNING → EXECUTING is valid", () => {
    const session = repo.getSession(sessionId);
    expect(session.status).toBe(SessionStatus.PLANNING);
    const updated = repo.updateSessionStatus(sessionId, SessionStatus.EXECUTING);
    expect(updated.status).toBe(SessionStatus.EXECUTING);
  });

  it("rejects invalid state transition", () => {
    expect(() => repo.updateSessionStatus(sessionId, SessionStatus.PLANNING)).toThrow(InvalidStateTransitionError);
  });

  it("validates transition through service", () => {
    const s2 = repo.createSession({ title: "Transition test 2" });
    expect(s2.status).toBe(SessionStatus.PLANNING);
    // Valid forward transition
    const updated = repo.updateSessionStatus(s2.id, SessionStatus.EXECUTING);
    expect(updated.status).toBe(SessionStatus.EXECUTING);
  });
});
