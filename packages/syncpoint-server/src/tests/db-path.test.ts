/**
 * E2E: DB path resolution — env var, project-local, fallback.
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("DB path resolution", () => {
  const origEnv = process.env.SYNCPOINT_DB_DIR;

  afterEach(() => {
    // Restore env
    if (origEnv !== undefined) {
      process.env.SYNCPOINT_DB_DIR = origEnv;
    } else {
      delete process.env.SYNCPOINT_DB_DIR;
    }
  });

  it("SYNCPOINT_DB_DIR env var takes precedence", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dbpath-env-"));
    process.env.SYNCPOINT_DB_DIR = tmp;
    // Fresh import to pick up env
    const { getDbPath } = await import("../db.ts");
    const dbPath = getDbPath();
    expect(dbPath).toBe(path.join(tmp, "syncpoint.db"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("syncpoint init creates .syncpoint/ with DB", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dbpath-init-"));
    const { initSyncpointDir } = await import("../db.ts");
    const dir = initSyncpointDir(tmp);
    expect(dir).toBe(path.join(tmp, ".syncpoint"));
    expect(fs.existsSync(path.join(dir, "syncpoint.db"))).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("walks up directories to find .syncpoint/", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dbpath-walk-"));
    const spDir = path.join(tmp, ".syncpoint");
    fs.mkdirSync(spDir);
    const subDir = path.join(tmp, "a", "b", "c");
    fs.mkdirSync(subDir, { recursive: true });

    delete process.env.SYNCPOINT_DB_DIR;
    // Temporarily change cwd
    const origCwd = process.cwd();
    process.chdir(subDir);
    try {
      const { getDbPath } = await import("../db.ts");
      const dbPath = getDbPath();
      expect(dbPath).toBe(path.join(spDir, "syncpoint.db"));
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to ~/.syncpoint/ when no project dir found", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sp-dbpath-fb-"));
    delete process.env.SYNCPOINT_DB_DIR;
    const origCwd = process.cwd();
    process.chdir(tmp);
    try {
      const { getDbPath } = await import("../db.ts");
      const dbPath = getDbPath();
      expect(dbPath).toBe(path.join(os.homedir(), ".syncpoint", "syncpoint.db"));
    } finally {
      process.chdir(origCwd);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
