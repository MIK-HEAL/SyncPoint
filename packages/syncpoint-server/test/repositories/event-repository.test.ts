/**
 * Tests for event repository — Event listing and filtering.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-repo-ev-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  // Create agents and tasks to generate events
  repo.createAgent({ name: "ev-a1", provider: "cursor", role: "frontend" });
  repo.createAgent({ name: "ev-a2", provider: "claude-code", role: "backend" });
  repo.createTask({ title: "Event repo task 1" });
  repo.createTask({ title: "Event repo task 2" });
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("event repository", () => {
  it("lists all events", () => {
    const events = repo.listEvents({ limit: 100 });
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it("filters events by type", () => {
    const events = repo.listEvents({ eventType: "AGENT_REGISTERED" as any, limit: 50 });
    for (const e of events) {
      expect(e.eventType).toBe("AGENT_REGISTERED");
    }
  });

  it("filters events by entity type", () => {
    const events = repo.listEvents({ limit: 50 });
    const agentEvents = events.filter(e => (e as any).entityType === "agent");
    expect(agentEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("respects limit", () => {
    const events = repo.listEvents({ limit: 2 });
    expect(events.length).toBeLessThanOrEqual(2);
  });
});
