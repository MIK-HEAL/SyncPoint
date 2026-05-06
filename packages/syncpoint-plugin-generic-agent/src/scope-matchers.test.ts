/**
 * Tests for generic ScopeMatcher implementations.
 */

import { describe, it, expect } from "vitest";
import { resourcesScopeMatcher, assetTypesScopeMatcher } from "./scope-matchers.js";

describe("resourcesScopeMatcher", () => {
  it("exact match returns target", () => {
    const result = resourcesScopeMatcher(
      ["artifact://landing-page"],
      ["artifact://landing-page", "artifact://checkout"],
    );
    expect(result).toEqual(["artifact://landing-page"]);
  });

  it("prefix match returns child", () => {
    const result = resourcesScopeMatcher(
      ["artifact://ui"],
      ["artifact://ui/header", "artifact://api/routes"],
    );
    expect(result).toEqual(["artifact://ui/header"]);
  });

  it("no match returns empty", () => {
    const result = resourcesScopeMatcher(
      ["artifact://landing-page"],
      ["artifact://checkout", "artifact://settings"],
    );
    expect(result).toEqual([]);
  });

  it("plain locators work", () => {
    const result = resourcesScopeMatcher(
      ["assets/logo.png"],
      ["assets/logo.png", "assets/banner.jpg"],
    );
    expect(result).toEqual(["assets/logo.png"]);
  });

  it("empty patterns match nothing", () => {
    expect(resourcesScopeMatcher([], ["artifact://x"])).toEqual([]);
  });

  it("empty targets match nothing", () => {
    expect(resourcesScopeMatcher(["artifact://x"], [])).toEqual([]);
  });
});

describe("assetTypesScopeMatcher", () => {
  it("exact type match", () => {
    const result = assetTypesScopeMatcher(["image", "video"], ["image", "audio"]);
    expect(result).toEqual(["image"]);
  });

  it("no match", () => {
    const result = assetTypesScopeMatcher(["image"], ["audio", "video"]);
    expect(result).toEqual([]);
  });

  it("empty patterns", () => {
    expect(assetTypesScopeMatcher([], ["image"])).toEqual([]);
  });
});
