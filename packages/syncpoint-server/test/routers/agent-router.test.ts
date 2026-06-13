/**
 * Tests for agent router — exercises the application functions that agent router delegates to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { ResourceNotFoundError } from "syncpoint-kernel";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-agent-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("agent router — CRUD", () => {
  it("lists agents (empty initially)", () => {
    const agents = repo.listAgents();
    expect(Array.isArray(agents)).toBe(true);
  });

  it("creates and retrieves agent", () => {
    const agent = repo.createAgent({ name: "router-agent", provider: "cursor", role: "frontend" });
    const found = repo.getAgent(agent.id);
    expect(found.name).toBe("router-agent");
  });

  it("returns 404 for unknown agent", () => {
    expect(() => repo.getAgent("nonexistent-xxxxx")).toThrow(ResourceNotFoundError);
  });

  it("updates agent profile", () => {
    const agent = repo.createAgent({ name: "updatable", provider: "other", role: "tester" });
    const updated = repo.updateAgentProfile(agent.id, { name: "updated-name" });
    expect(updated.name).toBe("updated-name");
  });
});

describe("agent router — input validation", () => {
  it("rejects empty name", () => {
    expect(() => repo.createAgent({ name: "", provider: "cursor", role: "frontend" })).toThrow();
  });

  it("rejects duplicate name", () => {
    repo.createAgent({ name: "unique-router-agent", provider: "other", role: "other" });
    expect(() => repo.createAgent({ name: "unique-router-agent", provider: "other", role: "other" })).toThrow();
  });
});
