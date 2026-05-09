import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __clearGuardSessionsForTest, guardCreateSession, guardStatus, guardValidateToken } from "./guard-session-service.js";

let root: string;
let previousRoot: string | undefined;

beforeEach(() => {
  previousRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "syncpoint-guard-"));
  process.env.SYNCPOINT_PROJECT_ROOT = root;
  __clearGuardSessionsForTest();
});

afterEach(() => {
  __clearGuardSessionsForTest();
  if (previousRoot === undefined) delete process.env.SYNCPOINT_PROJECT_ROOT;
  else process.env.SYNCPOINT_PROJECT_ROOT = previousRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

describe("guard session service", () => {
  it("creates and validates a guard capability token", () => {
    const session = guardCreateSession({
      actorId: "agent-a",
      taskId: "task-1",
      sessionId: "session-1",
      mountPath: "guarded-worktree",
      mode: "strict",
      adapter: "manual",
    });

    expect(session.token).toMatch(/^spg_/);
    expect(session.projectRoot).toBe(root);
    expect(session.mountPath).toBe(path.join(root, "guarded-worktree"));
    const validation = guardValidateToken(session.token);
    expect(validation.valid).toBe(true);
    expect(validation.session?.actorId).toBe("agent-a");
    expect(validation.session).not.toHaveProperty("token");
  });

  it("reports guard status without claiming a native proxy is mounted", () => {
    guardCreateSession({ actorId: "agent-a", taskId: "task-1", mode: "strict" });

    const status = guardStatus();

    expect(status.enforcementLevel).toBe("workspace_proxy");
    expect(status.proxyAvailable).toBe(false);
    expect(status.activeSessions).toHaveLength(1);
    expect(status.activeSessions[0]).not.toHaveProperty("token");
  });

  it("rejects mount paths outside the project root or inside metadata directories", () => {
    expect(() => guardCreateSession({ actorId: "agent-a", taskId: "task-1", mountPath: "../outside" })).toThrow(/inside the project root/i);
    expect(() => guardCreateSession({ actorId: "agent-a", taskId: "task-1", mountPath: ".syncpoint/mount" })).toThrow(/cannot be inside/i);
    expect(() => guardCreateSession({ actorId: "agent-a", taskId: "task-1", mountPath: ".git/mount" })).toThrow(/cannot be inside/i);
  });
});
