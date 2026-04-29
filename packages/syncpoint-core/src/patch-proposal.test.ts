/**
 * Unit tests for PatchProposal — pure helpers.
 */

import { describe, it, expect } from "vitest";
import {
  PatchProposalStatus,
  validatePatchTransition,
  extractTouchedFiles,
  isValidPatchFormat,
  findUncoveredFiles,
  findConflictingClaims,
  runPatchChecks,
} from "./patch-proposal.js";
import type { FileClaim } from "./file-claim.js";
import { FileClaimStatus, FileClaimMode } from "./file-claim.js";

function makeClaim(overrides: Partial<FileClaim>): FileClaim {
  return {
    id: "c1",
    agentId: "a1",
    taskId: "t1",
    sessionId: "",
    paths: "src/**",
    mode: FileClaimMode.EXCLUSIVE,
    status: FileClaimStatus.ACTIVE,
    createdAt: "",
    releasedAt: "",
    ...overrides,
  };
}

describe("PatchProposal status transitions", () => {
  it("DRAFT → SUBMITTED is valid", () => {
    expect(validatePatchTransition(PatchProposalStatus.DRAFT, PatchProposalStatus.SUBMITTED)).toBe(true);
  });

  it("SUBMITTED → APPROVED is valid", () => {
    expect(validatePatchTransition(PatchProposalStatus.SUBMITTED, PatchProposalStatus.APPROVED)).toBe(true);
  });

  it("SUBMITTED → CONFLICTING is valid", () => {
    expect(validatePatchTransition(PatchProposalStatus.SUBMITTED, PatchProposalStatus.CONFLICTING)).toBe(true);
  });

  it("APPROVED → APPLIED is valid", () => {
    expect(validatePatchTransition(PatchProposalStatus.APPROVED, PatchProposalStatus.APPLIED)).toBe(true);
  });

  it("APPLIED → anything is invalid (terminal)", () => {
    expect(validatePatchTransition(PatchProposalStatus.APPLIED, PatchProposalStatus.CANCELLED)).toBe(false);
  });

  it("REJECTED → SUBMITTED is valid (resubmit)", () => {
    expect(validatePatchTransition(PatchProposalStatus.REJECTED, PatchProposalStatus.SUBMITTED)).toBe(true);
  });

  it("CONFLICTING → SUBMITTED is valid (resubmit after fix)", () => {
    expect(validatePatchTransition(PatchProposalStatus.CONFLICTING, PatchProposalStatus.SUBMITTED)).toBe(true);
  });

  it("DRAFT → APPLIED is invalid", () => {
    expect(validatePatchTransition(PatchProposalStatus.DRAFT, PatchProposalStatus.APPLIED)).toBe(false);
  });
});

describe("extractTouchedFiles", () => {
  it("extracts from diff --git header", () => {
    const patch = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,3 +1,4 @@
+import { foo } from "bar";`;
    expect(extractTouchedFiles(patch)).toEqual(["src/auth.ts"]);
  });

  it("extracts multiple files", () => {
    const patch = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-old
+new`;
    const files = extractTouchedFiles(patch);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
    expect(files).toHaveLength(2);
  });

  it("handles new file", () => {
    const patch = `diff --git a/src/new.ts b/src/new.ts
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export const x = 1;`;
    expect(extractTouchedFiles(patch)).toEqual(["src/new.ts"]);
  });

  it("returns empty for non-patch text", () => {
    expect(extractTouchedFiles("hello world")).toEqual([]);
  });
});

describe("isValidPatchFormat", () => {
  it("valid unified diff", () => {
    expect(isValidPatchFormat("diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@")).toBe(true);
  });

  it("just a hunk header", () => {
    expect(isValidPatchFormat("@@ -1,3 +1,4 @@")).toBe(true);
  });

  it("empty string", () => {
    expect(isValidPatchFormat("")).toBe(false);
  });

  it("plain text", () => {
    expect(isValidPatchFormat("hello world")).toBe(false);
  });
});

describe("findUncoveredFiles", () => {
  it("all files covered", () => {
    const claim = makeClaim({ paths: "src/**" });
    expect(findUncoveredFiles(["src/auth.ts"], [claim])).toEqual([]);
  });

  it("some files uncovered", () => {
    const claim = makeClaim({ paths: "src/auth.ts" });
    expect(findUncoveredFiles(["src/auth.ts", "lib/utils.ts"], [claim])).toEqual(["lib/utils.ts"]);
  });

  it("ignores released claims", () => {
    const claim = makeClaim({ paths: "src/**", status: FileClaimStatus.RELEASED });
    expect(findUncoveredFiles(["src/auth.ts"], [claim])).toEqual(["src/auth.ts"]);
  });
});

describe("findConflictingClaims", () => {
  it("finds exclusive claim from another agent", () => {
    const other = makeClaim({ id: "c2", agentId: "a2", paths: "src/auth.ts" });
    const result = findConflictingClaims(["src/auth.ts"], "a1", [other]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("c2");
  });

  it("ignores own claims", () => {
    const own = makeClaim({ agentId: "a1", paths: "src/auth.ts" });
    expect(findConflictingClaims(["src/auth.ts"], "a1", [own])).toHaveLength(0);
  });

  it("ignores shared claims from others", () => {
    const shared = makeClaim({ agentId: "a2", paths: "src/auth.ts", mode: FileClaimMode.SHARED });
    expect(findConflictingClaims(["src/auth.ts"], "a1", [shared])).toHaveLength(0);
  });
});

describe("runPatchChecks", () => {
  it("all pass when patch is valid and files are covered", () => {
    const agentClaim = makeClaim({ agentId: "a1", paths: "src/**" });
    const result = runPatchChecks({
      patchText: "diff --git a/src/f.ts b/src/f.ts\n--- a/src/f.ts\n+++ b/src/f.ts\n@@ -1 +1 @@\n-x\n+y",
      touchedFiles: ["src/f.ts"],
      agentId: "a1",
      agentClaims: [agentClaim],
      allActiveClaims: [agentClaim],
    });
    expect(result.allPassed).toBe(true);
    expect(result.items).toHaveLength(4);
  });

  it("fails when files are uncovered", () => {
    const result = runPatchChecks({
      patchText: "diff --git a/lib/f.ts b/lib/f.ts\n@@ -1 +1 @@",
      touchedFiles: ["lib/f.ts"],
      agentId: "a1",
      agentClaims: [],
      allActiveClaims: [],
    });
    expect(result.allPassed).toBe(false);
    expect(result.uncoveredFiles).toContain("lib/f.ts");
  });

  it("fails when conflicting claims exist", () => {
    const agentClaim = makeClaim({ agentId: "a1", paths: "src/**" });
    const otherClaim = makeClaim({ id: "c2", agentId: "a2", paths: "src/auth.ts" });
    const result = runPatchChecks({
      patchText: "diff --git a/src/auth.ts b/src/auth.ts\n@@ -1 +1 @@",
      touchedFiles: ["src/auth.ts"],
      agentId: "a1",
      agentClaims: [agentClaim],
      allActiveClaims: [agentClaim, otherClaim],
    });
    expect(result.allPassed).toBe(false);
    expect(result.conflictingClaims).toContain("c2");
  });
});
