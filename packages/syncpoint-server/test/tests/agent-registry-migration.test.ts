import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "../../src/db.js";

describe("agent registry migration", () => {
  let tmpDir: string;
  const origEnv = process.env.SYNCPOINT_DB_DIR;

  afterAll(() => {
    defaultContext.destroy();
    if (origEnv !== undefined) {
      process.env.SYNCPOINT_DB_DIR = origEnv;
    } else {
      delete process.env.SYNCPOINT_DB_DIR;
    }
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the agent_registry_entry table and unique agent index in a fresh schema", () => {
    defaultContext.destroy();

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-agent-registry-migrate-"));
    process.env.SYNCPOINT_DB_DIR = tmpDir;
    defaultContext.db;

    const db = defaultContext.raw;
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_registry_entry'").all() as Array<{ name: string }>;
    expect(tables.map(row => row.name)).toContain("agent_registry_entry");

    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='agent_registry_entry'").all() as Array<{ name: string }>;
    expect(indexes.map(row => row.name)).toContain("uq_agent_registry_entry_agent");
  });
});
