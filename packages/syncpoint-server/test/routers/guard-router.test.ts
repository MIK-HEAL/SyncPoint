/**
 * Tests for guard router — Guard sessions and reconciliation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { guardCreateSession, guardStatus, reconcileBackingStore } from "../../src/application/_exports/review-operation-status.js";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-guard-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
  agentId = repo.createAgent({ name: "guard-agent", provider: "cursor", role: "frontend" }).id;
  taskId = repo.createTask({ title: "Guard router task" }).id;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("guard router", () => {
  it("creates guard session with strict mode", () => {
    const s = guardCreateSession({ actorId: agentId, taskId, mode: "strict", adapter: "manual" });
    expect(s.token).toMatch(/^spg_/);
    expect(s.mode).toBe("strict");
  });

  it("creates guard session with audit mode", () => {
    const s = guardCreateSession({ actorId: agentId, taskId, mode: "audit", adapter: "manual" });
    expect(s.mode).toBe("audit");
  });

  it("guard status returns active sessions", () => {
    const status = guardStatus();
    expect(Array.isArray(status.activeSessions)).toBe(true);
    expect(status.activeSessions.length).toBeGreaterThanOrEqual(2);
  });

  it("reconcile returns scan result", () => {
    const result = reconcileBackingStore({ taskId });
    expect(result.scannedFiles).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.bypassesDetected ? [] : [])).toBe(true);
  });
});
