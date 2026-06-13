/**
 * CLI session command tests — Session CRUD and orchestration.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { SessionStatus, TaskAssignmentStatus } from "syncpoint-adapters";
import { ResourceNotFoundError } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-session-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a = repo.createAgent({ name: "sess-agent", provider: "cursor", role: "architect" });
  agentId = a.id;
  const t = repo.createTask({ title: "Session test task", description: "Task for session tests" });
  taskId = t.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("session create", () => {
  it("creates a session with architect", () => {
    const session = repo.createSession({
      title: "Test Session",
      description: "A test session",
      relationshipMode: "manager-delegate",
      architectId: agentId,
    });
    expect(session.id).toBeTruthy();
    expect(session.title).toBe("Test Session");
    expect(session.status).toBe(SessionStatus.PLANNING);
    expect(session.relationshipMode).toBe("manager-delegate");
  });

  it("creates a session with minimal fields", () => {
    const session = repo.createSession({ title: "Minimal Session" });
    expect(session.status).toBe(SessionStatus.PLANNING);
    expect(session.relationshipMode).toBe("manager-delegate");
  });
});

describe("session roles", () => {
  let sessionId: string;

  beforeAll(() => {
    const session = repo.createSession({ title: "Role Test Session" });
    sessionId = session.id;
  });

  it("assigns a role to an agent", () => {
    const role = repo.assignRole(sessionId, agentId, "executor", "");
    expect(role.role).toBe("executor");
    expect(role.agentId).toBe(agentId);
    expect(role.sessionId).toBe(sessionId);
  });

  it("lists roles for a session", () => {
    const roles = repo.listRoles(sessionId);
    expect(roles.length).toBeGreaterThanOrEqual(1);
    expect(roles.some(r => r.agentId === agentId && r.role === "executor")).toBe(true);
  });
});

describe("session task assignment", () => {
  let sessionId: string;

  beforeAll(() => {
    const session = repo.createSession({ title: "Assignment Test" });
    sessionId = session.id;
    repo.assignRole(sessionId, agentId, "executor", "");
  });

  it("creates a task assignment", () => {
    const assignment = repo.assignTask(taskId, agentId);
    expect(assignment.id).toBeTruthy();
    expect(assignment.taskId).toBe(taskId);
    expect(assignment.assigneeAgentId).toBe(agentId);
    expect(assignment.status).toBe(TaskAssignmentStatus.PROPOSED);
  });

  it("lists task assignments for a session", () => {
    const assignments = repo.listTaskAssignments(sessionId);
    expect(Array.isArray(assignments)).toBe(true);
  });
});

describe("session status transition", () => {
  it("advances session from PLANNING to EXECUTING after task assignment", () => {
    const session = repo.createSession({ title: "Advance Test" });
    repo.assignRole(session.id, agentId, "executor", "");
    repo.assignTask(taskId, agentId);

    const updated = repo.updateSessionStatus(session.id, SessionStatus.EXECUTING);
    expect(updated.status).toBe(SessionStatus.EXECUTING);
  });

  it("rejects invalid status transitions", () => {
    const session = repo.createSession({ title: "Invalid Transition" });
    expect(() => repo.updateSessionStatus(session.id, "INVALID_STATUS" as any))
      .toThrow();
  });
});
