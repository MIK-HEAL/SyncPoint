/**
 * Tests for write router — Write permit and guard operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { rcClaim, writeCheck, writePrepare, writeApply, guardCreateSession } from "../../src/application/_exports/review-operation-status.js";
import { ResourceClaimMode } from "syncpoint-kernel";

let tmpDir: string;
let agentId: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-write-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a = repo.createAgent({ name: "write-router-agent", provider: "cursor", role: "frontend" });
  agentId = a.id;
  const t = repo.createTask({ title: "Write router task" });
  taskId = t.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("write router — write-check", () => {
  const locator = "router-write-test.ts";

  beforeAll(() => {
    fs.writeFileSync(path.join(tmpDir, locator), "// test file");
  });

  it("blocks write without claim", () => {
    const result = writeCheck({ locators: [locator], actorId: agentId, taskId });
    expect(result.permitted).toBe(false);
  });

  it("permits write after exclusive claim", () => {
    rcClaim({ actorId: agentId, taskId, resources: [{ type: "file", locator, metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
    const result = writeCheck({ locators: [locator], actorId: agentId, taskId });
    expect(result.permitted).toBe(true);
  });
});

describe("write router — prepare + apply", () => {
  const locator = "router-prepare-test.ts";

  beforeAll(() => {
    fs.writeFileSync(path.join(tmpDir, locator), "// original");
    rcClaim({ actorId: agentId, taskId, resources: [{ type: "file", locator, metadata: "", scope: "file" }], mode: ResourceClaimMode.EXCLUSIVE });
  });

  it("prepares and applies write permit", () => {
    const prep = writePrepare({ actorId: agentId, taskId, locators: [locator], intent: "modify" });
    expect(prep.decision.permitted).toBe(true);
    const applied = writeApply({ permitId: prep.permit.id, mutations: [{ locator, content: "// modified" }] });
    expect(applied.permit.status).toBe("consumed");
    expect(fs.readFileSync(path.join(tmpDir, locator), "utf-8")).toBe("// modified");
  });
});

describe("write router — guard session", () => {
  it("creates guard session", () => {
    const session = guardCreateSession({ actorId: agentId, taskId, mode: "strict", adapter: "manual" });
    expect(session.token).toMatch(/^spg_/);
    expect(session.mode).toBe("strict");
  });
});
