/**
 * CLI project-memory command tests — Project memory CRUD operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { pmAdd, pmApprove, pmDeprecate, pmList, pmSearch } from "syncpoint-server/application";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-pm-cli-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("project memory add", () => {
  it("creates a draft memory", () => {
    const mem = pmAdd({
      category: "architecture",
      title: "Layered Architecture",
      content: "SyncPoint uses a four-layer architecture.",
      scope: "project",
      tags: ["architecture"],
      sourceType: "human",
      sourceRef: "",
      confidence: "high",
      taskId: null,
      createdBy: "test-user",
    });
    expect(mem.id).toBeTruthy();
    expect(mem.title).toBe("Layered Architecture");
    expect(mem.status).toBe("draft");
    expect(mem.category).toBe("architecture");
  });

  it("creates a constraint memory", () => {
    const mem = pmAdd({
      category: "constraint",
      title: "No raw Error",
      content: "All errors must extend SyncPointError.",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      appliesTo: { files: ["packages/**/*.ts"] },
      severity: "blocking",
      validity: { status: "fresh" },
      validatorType: "custom",
      validatorConfig: { message: "Use typed errors", actions: ["review"] },
      scope: "project",
      tags: ["errors"],
      sourceType: "human",
      sourceRef: "",
      confidence: "high",
      taskId: null,
      createdBy: "test-user",
    });
    expect(mem.kind).toBe("hard_constraint");
    expect(mem.projectionTarget).toBe("protocol_gate");
    expect(mem.severity).toBe("blocking");
  });
});

describe("project memory approve / deprecate", () => {
  let memId: string;

  beforeAll(() => {
    const mem = pmAdd({
      category: "convention",
      title: "Test Convention",
      content: "All tests use vitest.",
      scope: "project",
      tags: ["testing"],
      sourceType: "human",
      sourceRef: "",
      confidence: "medium",
      taskId: null,
      createdBy: "test-user",
    });
    memId = mem.id;
  });

  it("approves a draft memory", () => {
    const mem = pmApprove(memId, "test-admin");
    expect(mem.status).toBe("approved");
    expect(mem.approvedBy).toBe("test-admin");
  });

  it("deprecates an approved memory", () => {
    const mem = pmDeprecate(memId, "test-admin");
    expect(mem.status).toBe("deprecated");
  });
});

describe("project memory list / search", () => {
  beforeAll(() => {
    pmAdd({
      category: "decision",
      title: "Use pnpm",
      content: "Package manager is pnpm 9+.",
      scope: "project",
      tags: ["tooling"],
      sourceType: "human",
      sourceRef: "",
      confidence: "high",
      taskId: null,
      createdBy: "test-user",
    });
  });

  it("lists all memories", () => {
    const all = pmList({});
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by status", () => {
    const approved = pmList({ status: "approved" });
    for (const m of approved) {
      expect(m.status).toBe("approved");
    }
  });

  it("filters by category", () => {
    const arch = pmList({ category: "architecture" });
    for (const m of arch) {
      expect(m.category).toBe("architecture");
    }
  });

  it("searches by query text", () => {
    const results = pmSearch("pnpm");
    expect(results.some(r => r.title.includes("pnpm") || r.content.includes("pnpm"))).toBe(true);
  });
});
