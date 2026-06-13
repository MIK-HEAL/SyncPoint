/**
 * Tests for MCP error helpers — safeError and log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeError, log } from "../src/errors.js";

describe("safeError", () => {
  it("returns message for NotFoundError", () => {
    const err = new Error("Agent not found: abc123");
    err.name = "NotFoundError";
    expect(safeError(err)).toBe("Agent not found: abc123");
  });

  it("returns message for ProjectMemoryPathError", () => {
    const err = new Error("No project-local .syncpoint/");
    err.name = "ProjectMemoryPathError";
    expect(safeError(err)).toBe("No project-local .syncpoint/");
  });

  it("returns message for LoopError", () => {
    const err = new Error("Loop resume blocked");
    err.name = "LoopError";
    expect(safeError(err)).toBe("Loop resume blocked");
  });

  it("prefixes unknown Error types with 'Internal error:'", () => {
    const err = new Error("Something unexpected");
    err.name = "TypeError";
    expect(safeError(err)).toBe("Internal error: Something unexpected");
  });

  it("prefixes generic Error without custom name", () => {
    const err = new Error("DB connection failed");
    expect(safeError(err)).toBe("Internal error: DB connection failed");
  });

  it("returns 'Unknown error' for non-Error values", () => {
    expect(safeError(null)).toBe("Unknown error");
    expect(safeError(undefined)).toBe("Unknown error");
    expect(safeError("string error")).toBe("Unknown error");
    expect(safeError(42)).toBe("Unknown error");
    expect(safeError({ message: "fake" })).toBe("Unknown error");
  });

  it("never exposes stack traces", () => {
    const err = new Error("secret details");
    err.name = "TypeError";
    err.stack = "Error: secret details\n    at fn (file.ts:1:1)";
    const result = safeError(err);
    expect(result).not.toContain("file.ts");
    expect(result).not.toContain("at fn");
  });
});

describe("log", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to stderr with prefix", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    log("test message");
    expect(spy).toHaveBeenCalledWith("[syncpoint-mcp] test message\n");
    spy.mockRestore();
  });
});
