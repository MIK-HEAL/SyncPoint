/**
 * CLI write command tests — exercises write permit service functions
 * that CLI write/guard commands delegate to.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  rcClaim, rcRelease,
  writeCheck, writePrepare, writeApply,
  guardCreateSession, guardStatus,
} from "syncpoint-server/application";
import { WriteDecisionReason, WritePermitStatus } from "syncpoint-kernel";
import { ResourceClaimMode } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-write-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a = repo.createAgent({ name: "write-agent", provider: "other", role: "frontend" });
  agentId = a.id;
  const t = repo.createTask({ title: "Write test task", description: "" });
  taskId = t.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("write check (syncpoint write check)", () => {
  const locator = "write-check-test.ts";

  beforeAll(() => {
    const filePath = path.join(tmpDir, locator);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "// test");
  });

  it("blocks when no claim exists", () => {
    const result = writeCheck({ locators: [locator], actorId: agentId, taskId });
    expect(result.permitted).toBe(false);
    expect(result.decision.reason).toBe(WriteDecisionReason.BLOCKED);
    expect(result.decision.blockers.length).toBeGreaterThan(0);
  });

  it("permits after exclusive claim", () => {
    rcClaim({
      actorId: agentId,
      taskId,
      resources: [{ type: "file", locator, metadata: "", scope: "file" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });
    const result = writeCheck({ locators: [locator], actorId: agentId, taskId });
    expect(result.permitted).toBe(true);
    expect(result.decision.reason).toBe(WriteDecisionReason.OWNED_CLAIM);
  });
});

describe("write prepare + apply (syncpoint write prepare, syncpoint write apply)", () => {
  const locator = "write-prepare-test.ts";

  beforeAll(() => {
    const filePath = path.join(tmpDir, locator);
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "// original");
    rcClaim({
      actorId: agentId,
      taskId,
      resources: [{ type: "file", locator, metadata: "", scope: "file" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });
  });

  it("prepares a write permit", () => {
    const result = writePrepare({
      actorId: agentId,
      taskId,
      locators: [locator],
      intent: "modify",
    });
    expect(result.decision.permitted).toBe(true);
    expect(result.permit.status).toBe("issued");
    expect(result.permit.id).toBeTruthy();
  });

  it("applies a write permit", () => {
    const prepared = writePrepare({
      actorId: agentId,
      taskId,
      locators: [locator],
      intent: "modify",
    });
    const result = writeApply({
      permitId: prepared.permit.id,
      mutations: [{ locator, content: "// modified" }],
    });
    expect(result.permit.status).toBe(WritePermitStatus.CONSUMED);
    expect(fs.readFileSync(path.join(tmpDir, locator), "utf-8")).toBe("// modified");
  });

  it("rejects apply with invalid permit ID", () => {
    expect(() => writeApply({
      permitId: "nonexistent-permit-id",
      mutations: [{ locator, content: "// bad" }],
    })).toThrow();
  });
});

describe("guard session (syncpoint guard)", () => {
  it("creates a guard session", () => {
    const session = guardCreateSession({
      actorId: agentId,
      taskId,
      mode: "strict",
      adapter: "manual",
    });
    expect(session.token).toMatch(/^spg_/);
    expect(session.actorId).toBe(agentId);
    expect(session.mode).toBe("strict");
  });

  it("returns guard status with active sessions", () => {
    const status = guardStatus();
    expect(status.proxyAvailable).toBeDefined();
    expect(Array.isArray(status.activeSessions)).toBe(true);
    expect(status.activeSessions.length).toBeGreaterThanOrEqual(1);
  });
});
