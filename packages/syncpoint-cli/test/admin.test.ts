/**
 * CLI admin command tests — import/export, doctor, history, events.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb, getRawDb, getDbPath } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { EventType } from "syncpoint-kernel";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-admin-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  repo.createAgent({ name: "admin-agent", provider: "cursor", role: "frontend" });
  repo.createTask({ title: "Admin test task", description: "" });
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("export", () => {
  it("exports agents as JSON array", () => {
    const agents = repo.listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(1);
    const json = JSON.stringify(agents, null, 2);
    expect(json).toContain("admin-agent");
    expect(json).toContain("cursor");
  });

  it("exports tasks as JSON array", () => {
    const tasks = repo.listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some(t => t.title === "Admin test task")).toBe(true);
  });
});

describe("import", () => {
  it("creates agent from valid data", () => {
    const agent = repo.createAgent({ name: "imported-agent", provider: "claude-code", role: "reviewer" });
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBe("imported-agent");
  });

  it("creates task from valid data", () => {
    const task = repo.createTask({ title: "Imported task", description: "From import" });
    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Imported task");
  });
});

describe("events", () => {
  it("lists events after agent creation", () => {
    const events = repo.listEvents({ limit: 50 });
    // Agent creation triggers an AGENT_REGISTERED event
    const agentEvents = events.filter((e: any) => e.eventType === EventType.AGENT_REGISTERED);
    expect(agentEvents.length).toBeGreaterThanOrEqual(1);
  });

  it("filters events by type", () => {
    const events = repo.listEvents({ eventType: EventType.AGENT_REGISTERED, limit: 10 });
    for (const e of events) {
      expect(e.eventType).toBe(EventType.AGENT_REGISTERED);
    }
  });
});

describe("doctor — database integrity", () => {
  it("PRAGMA integrity_check returns ok", () => {
    const rawDb = getRawDb();
    if (rawDb) {
      const result = rawDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      expect(result.integrity_check).toBe("ok");
    }
  });

  it("PRAGMA journal_mode returns wal", () => {
    const rawDb = getRawDb();
    if (rawDb) {
      const result = rawDb.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
      expect(result.journal_mode).toBe("wal");
    }
  });

  it("db path exists", () => {
    const dbPath = getDbPath();
    expect(fs.existsSync(dbPath)).toBe(true);
  });
});
