import { describe, it, expect } from "vitest";
import { extractSummary, extractProgress, extractNextSteps } from "../src/agent-runner.js";

describe("extractSummary", () => {
  it("extracts result from JSON output", () => {
    const stdout = JSON.stringify({ result: "Successfully implemented the feature with tests." });
    expect(extractSummary(stdout)).toBe("Successfully implemented the feature with tests.");
  });

  it("truncates long summaries to 200 chars", () => {
    const longText = "A".repeat(300);
    const stdout = JSON.stringify({ result: longText });
    expect(extractSummary(stdout)).toHaveLength(200);
  });

  it("falls back to raw text for non-JSON", () => {
    const stdout = "Some plain text output\nMore lines";
    expect(extractSummary(stdout)).toBe("Some plain text output More lines");
  });

  it("returns default for empty output", () => {
    expect(extractSummary("")).toBe("Task executed successfully");
    expect(extractSummary("   \n  ")).toBe("Task executed successfully");
  });

  it("handles JSON without result field", () => {
    const stdout = JSON.stringify({ status: "ok" });
    expect(extractSummary(stdout)).toBe('{"status":"ok"}');
  });
});

describe("extractProgress", () => {
  it("extracts progress from JSON result", () => {
    const stdout = JSON.stringify({ result: "Progress: 3/5 files updated successfully" });
    const progress = extractProgress(stdout);
    expect(progress).toContain("3/5 files updated");
  });

  it("returns undefined for non-JSON", () => {
    expect(extractProgress("plain text")).toBeUndefined();
  });
});

describe("extractNextSteps", () => {
  it("extracts next steps from JSON result", () => {
    const stdout = JSON.stringify({ result: "All tests pass. Next steps: add integration tests" });
    const next = extractNextSteps(stdout);
    expect(next).toContain("add integration tests");
  });

  it("returns undefined for non-JSON", () => {
    expect(extractNextSteps("plain text")).toBeUndefined();
  });
});
