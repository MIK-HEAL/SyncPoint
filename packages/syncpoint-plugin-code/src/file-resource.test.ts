import { describe, it, expect } from "vitest";
import type { ResourceRef } from "syncpoint-core";
import {
  parseClaimPaths,
  pathsOverlap,
  filePathsToResourceRefs,
  resourceRefsToFilePaths,
} from "./file-resource.js";

describe("parseClaimPaths", () => {
  it("splits and trims", () => {
    expect(parseClaimPaths("src/a.ts, src/b.js")).toEqual(["src/a.js", "src/b.js"]);
  });
  it("drops empty strings", () => {
    expect(parseClaimPaths(",,src/a.ts,,")).toEqual(["src/a.js"]);
  });
});

describe("pathsOverlap", () => {
  it("exact match", () => {
    expect(pathsOverlap("src/auth.js", "src/auth.js")).toBe(true);
  });
  it("no match", () => {
    expect(pathsOverlap("src/auth.js", "src/login.js")).toBe(false);
  });
  it("prefix directory overlap", () => {
    expect(pathsOverlap("src/", "src/auth.js")).toBe(true);
  });
  it("glob overlap", () => {
    expect(pathsOverlap("src/*", "src/auth.js")).toBe(true);
    expect(pathsOverlap("src/**", "src/nested/deep.js")).toBe(true);
  });
  it("different directories no overlap", () => {
    expect(pathsOverlap("lib/*", "src/auth.js")).toBe(false);
  });
});

describe("filePathsToResourceRefs", () => {
  it("converts to ResourceRef with type=file", () => {
    const refs = filePathsToResourceRefs("src/a.ts, src/b.js");
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({ type: "file", scope: "file", locator: "src/a.js", metadata: "" });
  });
});

describe("resourceRefsToFilePaths", () => {
  it("extracts file locators", () => {
    const refs: ResourceRef[] = [
      { type: "file", scope: "file" as const, locator: "src/a.js", metadata: "" },
      { type: "image", scope: "file" as const, locator: "logo.png", metadata: "" },
      { type: "file", scope: "file" as const, locator: "src/b.js", metadata: "" },
    ];
    expect(resourceRefsToFilePaths(refs)).toBe("src/a.ts, src/b.js");
  });
});
