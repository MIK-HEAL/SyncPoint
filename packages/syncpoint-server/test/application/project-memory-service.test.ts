/**
 * Tests for project-memory-service — Extended PM operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import { pmAdd, pmApprove, pmDeprecate, pmList, pmSearch, pmExport } from "../../src/application/_exports/review-operation-status.js";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-app-pm-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("project memory service", () => {
  it("adds memory with constraint configuration", () => {
    const mem = pmAdd({ category: "constraint", title: "No raw SQL", content: "All DB access through repos.", kind: "hard_constraint", projectionTarget: "protocol_gate", appliesTo: { files: ["src/**/*.ts"] }, severity: "blocking", validity: { status: "fresh" }, validatorType: "custom", validatorConfig: { message: "SQL violation", actions: ["review"] }, scope: "project", tags: ["db"], sourceType: "human", sourceRef: "", confidence: "high", taskId: null, createdBy: "test" });
    expect(mem.kind).toBe("hard_constraint");
    expect(mem.validatorType).toBe("custom");
  });

  it("deprecates memory", () => {
    const mem = pmAdd({ category: "decision", title: "Deprecatable", content: "Old decision.", scope: "project", tags: [], sourceType: "human", sourceRef: "", confidence: "low", taskId: null, createdBy: "test" });
    pmApprove(mem.id, "admin");
    const deprecated = pmDeprecate(mem.id, "admin");
    expect(deprecated.status).toBe("deprecated");
  });

  it("filters by multiple criteria", () => {
    const results = pmList({ status: "approved", category: "constraint" });
    for (const r of results) {
      expect(r.status).toBe("approved");
      expect(r.category).toBe("constraint");
    }
  });

  it("exports to file", () => {
    const exportPath = path.join(tmpDir, "pm-export.md");
    const result = pmExport({ outputPath: exportPath, callerBy: "test" });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(exportPath)).toBe(true);
  });
});
