import { describe, it, expect } from "vitest";
import {
  normalizeResourcePath,
  arePathsEquivalent,
  toResourceLocatorKey,
} from "../src/path-normalize.js";

describe("normalizeResourcePath", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeResourcePath("")).toBe("");
    expect(normalizeResourcePath("  ")).toBe("");
  });

  it("preserves URI scheme locators", () => {
    expect(normalizeResourcePath("binary://some-hash")).toBe("binary://some-hash");
    expect(normalizeResourcePath("artifact://v1/abc")).toBe("artifact://v1/abc");
  });

  it("normalizes backslashes to forward slashes", () => {
    const result = normalizeResourcePath("src\\app\\index.ts");
    expect(result).toBe("src/app/index.ts");
  });

  it("resolves . segments", () => {
    const result = normalizeResourcePath("src/./app/./index.ts");
    expect(result).toBe("src/app/index.ts");
  });

  it("resolves .. segments", () => {
    const result = normalizeResourcePath("src/app/../lib/helper.ts");
    expect(result).toBe("src/lib/helper.ts");
  });

  it("resolves relative path with projectRoot", () => {
    const result = normalizeResourcePath("src/app.ts", {
      projectRoot: "/home/user/project",
    });
    expect(result).toBe("/home/user/project/src/app.ts");
  });

  it("preserves absolute path", () => {
    const result = normalizeResourcePath("/home/user/project/src/app.ts");
    expect(result).toBe("/home/user/project/src/app.ts");
  });

  it("removes trailing slash", () => {
    const result = normalizeResourcePath("src/app/");
    expect(result).toBe("src/app");
  });

  it("preserves root /", () => {
    const result = normalizeResourcePath("/");
    expect(result).toBe("/");
  });

  it("applies path aliases", () => {
    const result = normalizeResourcePath("@lib/helper.ts", {
      aliases: { "@lib": "src/lib" },
    });
    expect(result).toContain("src/lib/helper.ts");
  });

  it("lowercases on Windows when caseSensitive is false", () => {
    const result = normalizeResourcePath("SRC/App.TS", { caseSensitive: false });
    expect(result).toBe("src/app.ts");
  });

  it("preserves case when caseSensitive is true", () => {
    const result = normalizeResourcePath("SRC/App.TS", { caseSensitive: true });
    expect(result).toBe("SRC/App.TS");
  });

  it("normalizes Windows drive letter paths", () => {
    const result = normalizeResourcePath("C:\\Users\\proj\\src\\app.ts", { caseSensitive: false });
    expect(result).toBe("c:/users/proj/src/app.ts");
  });
});

describe("arePathsEquivalent", () => {
  it("returns true for equivalent paths", () => {
    expect(arePathsEquivalent("src/app.ts", "src/app.ts")).toBe(true);
  });

  it("returns true after normalization", () => {
    expect(arePathsEquivalent("src/./app.ts", "src/app.ts")).toBe(true);
  });

  it("returns false for different paths", () => {
    expect(arePathsEquivalent("src/a.ts", "src/b.ts")).toBe(false);
  });

  it("handles backslash vs forward slash", () => {
    expect(arePathsEquivalent("src\\app.ts", "src/app.ts")).toBe(true);
  });
});

describe("toResourceLocatorKey", () => {
  it("produces a colon-separated key", () => {
    const key = toResourceLocatorKey("file", "src/app.ts");
    expect(key).toBe("file:src/app.ts");
  });

  it("normalizes the locator", () => {
    const key = toResourceLocatorKey("file", "src/./app.ts");
    expect(key).toBe("file:src/app.ts");
  });
});
