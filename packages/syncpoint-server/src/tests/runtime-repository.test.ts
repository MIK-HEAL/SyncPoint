/**
 * Runtime repository — integration tests.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../db.js";
import {
  createRuntime,
  getRuntime,
  listRuntimes,
  updateRuntimeAgent,
  updateRuntimeStatus,
  getAgentIdForRuntime,
} from "../repositories/runtime-repository.js";
import { createAgent } from "../repositories/agent-repository.js";
import { RuntimeStatus } from "syncpoint-adapters";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-runtime-"));
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("runtime repository", () => {
  let runtimeId: string;
  let agentId: string;

  it("creates a runtime", () => {
    const rt = createRuntime({
      name: "architect-window",
      kind: "local-mcp" as any,
      agentId: null,
      provider: "copilot",
      host: "dev-machine",
      workspaceRoot: "/home/user/project",
    });
    runtimeId = rt.id;
    expect(rt.name).toBe("architect-window");
    expect(rt.kind).toBe("local-mcp");
    expect(rt.provider).toBe("copilot");
    expect(rt.status).toBe("ACTIVE");
    expect(rt.agentId).toBeNull();
  });

  it("gets a runtime by id", () => {
    const rt = getRuntime(runtimeId);
    expect(rt.id).toBe(runtimeId);
    expect(rt.name).toBe("architect-window");
  });

  it("lists all runtimes", () => {
    const rts = listRuntimes();
    expect(rts.length).toBeGreaterThanOrEqual(1);
    expect(rts.some(r => r.id === runtimeId)).toBe(true);
  });

  it("binds an agent to the runtime", () => {
    const agent = createAgent({ name: "arch-agent", provider: "copilot", role: "manager" });
    agentId = agent.id;

    const rt = updateRuntimeAgent(runtimeId, agentId);
    expect(rt.agentId).toBe(agentId);
  });

  it("getAgentIdForRuntime returns bound agent", () => {
    const resolved = getAgentIdForRuntime(runtimeId);
    expect(resolved).toBe(agentId);
  });

  it("getAgentIdForRuntime returns null for unknown runtime", () => {
    expect(getAgentIdForRuntime("nonexistent")).toBeNull();
  });

  it("unbinds agent from runtime", () => {
    const rt = updateRuntimeAgent(runtimeId, null);
    expect(rt.agentId).toBeNull();
    expect(getAgentIdForRuntime(runtimeId)).toBeNull();
  });

  it("updates runtime status", () => {
    const rt = updateRuntimeStatus(runtimeId, RuntimeStatus.DISCONNECTED);
    expect(rt.status).toBe("DISCONNECTED");
  });

  it("creates runtime with agent binding", () => {
    const rt2 = createRuntime({
      name: "worker-window",
      kind: "local-mcp" as any,
      provider: "copilot",
      host: "dev-machine",
      workspaceRoot: "/home/user/project",
      agentId: agentId,
    } as any);
    expect(rt2.agentId).toBe(agentId);
    expect(getAgentIdForRuntime(rt2.id)).toBe(agentId);
  });
});
