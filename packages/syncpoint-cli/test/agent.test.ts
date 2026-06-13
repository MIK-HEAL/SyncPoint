/**
 * CLI agent command tests — Agent CRUD operations that CLI agent commands delegate to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { ResourceNotFoundError } from "syncpoint-kernel";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-agent-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent create", () => {
  it("creates an agent with provider and role", () => {
    const agent = repo.createAgent({ name: "cursor", provider: "cursor", role: "frontend" });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("cursor");
    expect(agent.provider).toBe("cursor");
    expect(agent.role).toBe("frontend");
    expect(agent.status).toBe("IDLE");
  });

  it("creates an agent with different role", () => {
    const agent = repo.createAgent({ name: "claude-code", provider: "claude-code", role: "reviewer" });
    expect(agent.provider).toBe("claude-code");
    expect(agent.role).toBe("reviewer");
  });

  it("rejects duplicate agent name", () => {
    repo.createAgent({ name: "unique-agent", provider: "other", role: "other" });
    expect(() => repo.createAgent({ name: "unique-agent", provider: "other", role: "other" }))
      .toThrow();
  });
});

describe("agent list", () => {
  beforeAll(() => {
    repo.createAgent({ name: "list-agent-1", provider: "other", role: "tester" });
    repo.createAgent({ name: "list-agent-2", provider: "other", role: "manager" });
  });

  it("lists all agents", () => {
    const agents = repo.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(2);
    expect(agents.some(a => a.name === "list-agent-1")).toBe(true);
    expect(agents.some(a => a.name === "list-agent-2")).toBe(true);
  });
});

describe("agent get / update", () => {
  let agentId: string;

  beforeAll(() => {
    const agent = repo.createAgent({ name: "get-agent", provider: "other", role: "backend" });
    agentId = agent.id;
  });

  it("gets an agent by ID", () => {
    const agent = repo.getAgent(agentId);
    expect(agent.name).toBe("get-agent");
    expect(agent.role).toBe("backend");
  });

  it("throws ResourceNotFoundError for unknown agent", () => {
    expect(() => repo.getAgent("nonexistent-id")).toThrow(ResourceNotFoundError);
  });

  it("updates agent profile", () => {
    const updated = repo.updateAgentProfile(agentId, { name: "get-agent-v2", role: "frontend" });
    expect(updated.name).toBe("get-agent-v2");
    expect(updated.role).toBe("frontend");
  });
});
