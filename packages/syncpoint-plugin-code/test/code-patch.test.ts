import { describe, it, expect } from "vitest";
import {
  extractTouchedFiles,
  isValidPatchFormat,
  findUncoveredFiles,
  findConflictingClaims,
  runCodePatchChecks,
} from "../src/code-patch.js";
import type { ResourceClaim } from "syncpoint-core";
import { ResourceClaimMode, ResourceClaimStatus } from "syncpoint-core";
import { parseClaimPaths } from "../src/file-resource.js";

function makeClaim(id: string, actorId: string, paths: string, mode = "exclusive"): ResourceClaim {
  return {
    id, actorId, taskId: "t1", sessionId: "s1",
    resources: parseClaimPaths(paths).map(p => ({ type: "file", locator: p, metadata: "", scope: "file" as const })),
    mode: mode === "exclusive" ? ResourceClaimMode.EXCLUSIVE : ResourceClaimMode.SHARED,
    status: ResourceClaimStatus.ACTIVE,
    createdAt: "", releasedAt: "",
  };
}

describe("extractTouchedFiles", () => {
  it("extracts from unified diff", () => {
    const patch = `diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-old\n+new`;
    expect(extractTouchedFiles(patch)).toEqual(["src/auth.ts"]);
  });
  it("returns empty for no diff", () => {
    expect(extractTouchedFiles("no diff here")).toEqual([]);
  });
  it("handles multiple files", () => {
    const patch = `diff --git a/a.ts b/a.ts\n+++ b/a.ts\ndiff --git a/b.ts b/b.ts\n+++ b/b.ts`;
    expect(extractTouchedFiles(patch)).toEqual(["a.ts", "b.ts"]);
  });
});

describe("isValidPatchFormat", () => {
  it("detects valid unified diff", () => {
    expect(isValidPatchFormat("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-a\n+b")).toBe(true);
  });
  it("rejects empty", () => {
    expect(isValidPatchFormat("")).toBe(false);
  });
  it("rejects non-diff text", () => {
    expect(isValidPatchFormat("just some text")).toBe(false);
  });
});

describe("findUncoveredFiles", () => {
  it("no uncovered when fully claimed", () => {
    const claims = [makeClaim("c1", "a1", "src/auth.js")];
    expect(findUncoveredFiles(["src/auth.js"], claims)).toEqual([]);
  });
  it("reports uncovered files", () => {
    const claims = [makeClaim("c1", "a1", "src/auth.js")];
    expect(findUncoveredFiles(["src/auth.js", "src/login.js"], claims))
      .toEqual(["src/login.js"]);
  });
});

describe("findConflictingClaims", () => {
  it("finds exclusive conflicts from other agents", () => {
    const all = [
      makeClaim("c1", "a1", "src/auth.js", "exclusive"),
      makeClaim("c2", "a2", "src/auth.js", "exclusive"),
    ];
    const result = findConflictingClaims(["src/auth.js"], "a2", all);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("c1");
  });
  it("ignores shared claims", () => {
    const all = [makeClaim("c1", "a1", "src/auth.js", "shared")];
    expect(findConflictingClaims(["src/auth.js"], "a2", all)).toHaveLength(0);
  });
});

describe("runCodePatchChecks", () => {
  it("returns allPassed when everything is fine", () => {
    const claims = [makeClaim("c1", "a1", "src/*")];
    const result = runCodePatchChecks({
      patchText: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-a\n+b",
      touchedFiles: ["src/auth.js"],
      agentId: "a1",
      agentClaims: claims,
      allActiveClaims: claims,
    });
    expect(result.allPassed).toBe(true);
    expect(result.items).toHaveLength(4);
  });

  it("reports uncovered files and conflicts", () => {
    const agentClaims = [makeClaim("c1", "a1", "src/mine.js")];
    const allClaims = [
      ...agentClaims,
      makeClaim("c2", "a2", "src/theirs.js", "exclusive"),
    ];
    const result = runCodePatchChecks({
      patchText: "--- a/src/theirs.ts\n+++ b/src/theirs.ts\n@@ -1 +1 @@\n-a\n+b",
      touchedFiles: ["src/theirs.js"],
      agentId: "a1",
      agentClaims,
      allActiveClaims: allClaims,
    });
    expect(result.allPassed).toBe(false);
    expect(result.uncoveredFiles).toEqual(["src/theirs.js"]);
    expect(result.conflictingClaims).toEqual(["c2"]);
  });
});
