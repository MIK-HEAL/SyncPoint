/**
 * CLI connect command tests — agent registration, runtime binding, MCP config.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { RuntimeKind } from "syncpoint-adapters";
import { bindRuntime } from "syncpoint-server/application";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-connect-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent registration", () => {
  it("registers a new agent with provider and role", () => {
    const agent = repo.createAgent({
      name: "cursor-agent",
      provider: "cursor",
      role: "frontend",
    });
    expect(agent.id).toBeTruthy();
    expect(agent.provider).toBe("cursor");
    expect(agent.role).toBe("frontend");
  });

  it("registers agents with different providers", () => {
    const agents = [
      repo.createAgent({ name: "claude-agent", provider: "claude-code", role: "backend" }),
      repo.createAgent({ name: "windsurf-agent", provider: "windsurf", role: "tester" }),
    ];
    expect(agents[0]!.provider).toBe("claude-code");
    expect(agents[1]!.provider).toBe("windsurf");
  });
});

describe("runtime binding", () => {
  let agentId: string;

  beforeAll(() => {
    const agent = repo.createAgent({ name: "runtime-agent", provider: "cursor", role: "frontend" });
    agentId = agent.id;
  });

  it("binds a local MCP runtime to an agent", () => {
    const bound = bindRuntime(agentId, "cursor", tmpDir);
    expect(bound.id).toBe(agentId);
    if (bound.runtimeId) {
      const runtime = repo.getRuntime(bound.runtimeId);
      expect(runtime.kind).toBe(RuntimeKind.LOCAL_MCP);
    }
  });

  it("creates a runtime entry", () => {
    const runtime = repo.createRuntime({
      name: "cursor-local",
      kind: RuntimeKind.LOCAL_MCP,
      provider: "cursor",
      host: "",
      workspaceRoot: tmpDir,
    });
    expect(runtime.id).toBeTruthy();
    expect(runtime.kind).toBe(RuntimeKind.LOCAL_MCP);
  });
});

describe("duplicate agent detection", () => {
  it("listAgents returns registered agents", () => {
    const agents = repo.listAgents();
    const names = agents.map(a => a.name);
    expect(names).toContain("runtime-agent");
    expect(names).toContain("cursor-agent");
  });

  it("createAgent throws on duplicate name", () => {
    expect(() => repo.createAgent({
      name: "cursor-agent",
      provider: "cursor",
      role: "frontend",
    })).toThrow();
  });
});
