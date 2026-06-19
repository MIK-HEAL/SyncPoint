/**
 * Tests for project-memory router — Memory CRUD, approve, search, export.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import { pmAdd, pmApprove, pmList, pmSearch } from "../../src/application/_exports/review-operation-status.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-pm-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("project memory router", () => {
  it("adds a memory", () => {
    const mem = pmAdd({ category: "decision", title: "Router PM test", content: "Content.", scope: "project", tags: [], sourceType: "human", sourceRef: "", confidence: "high", taskId: null, createdBy: "test" });
    expect(mem.status).toBe("draft");
    expect(mem.title).toBe("Router PM test");
  });

  it("approves a memory", () => {
    const mem = pmAdd({ category: "convention", title: "Approvable", content: "Test", scope: "project", tags: [], sourceType: "human", sourceRef: "", confidence: "medium", taskId: null, createdBy: "test" });
    const approved = pmApprove(mem.id, "admin");
    expect(approved.status).toBe("approved");
  });

  it("lists memories by status", () => {
    const approved = pmList({ status: "approved" });
    for (const m of approved) expect(m.status).toBe("approved");
  });

  it("searches memories", () => {
    const results = pmSearch("Router");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
