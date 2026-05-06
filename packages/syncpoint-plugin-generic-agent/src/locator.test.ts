/**
 * Tests for URI-style locator parsing and overlap detection.
 */

import { describe, it, expect } from "vitest";
import { parseLocator, locatorPath, locatorScheme, locatorPathsOverlap } from "./locator.js";

describe("parseLocator", () => {
  it("parses scheme://path", () => {
    const r = parseLocator("artifact://landing-page-design");
    expect(r.scheme).toBe("artifact");
    expect(r.path).toBe("landing-page-design");
    expect(r.fragment).toBeUndefined();
  });

  it("parses scheme://path#fragment", () => {
    const r = parseLocator("image://hero-banner#bbox=10,20,200,150");
    expect(r.scheme).toBe("image");
    expect(r.path).toBe("hero-banner");
    expect(r.fragment).toBe("bbox=10,20,200,150");
  });

  it("parses scheme://nested/path", () => {
    const r = parseLocator("binary://assets/hero-banner.png");
    expect(r.scheme).toBe("binary");
    expect(r.path).toBe("assets/hero-banner.png");
  });

  it("parses scheme://path#key=value", () => {
    const r = parseLocator("doc://PRD-001#section=pricing");
    expect(r.scheme).toBe("doc");
    expect(r.path).toBe("PRD-001");
    expect(r.fragment).toBe("section=pricing");
  });

  it("parses plain path (no scheme)", () => {
    const r = parseLocator("assets/hero-banner.png");
    expect(r.scheme).toBe("");
    expect(r.path).toBe("assets/hero-banner.png");
    expect(r.fragment).toBeUndefined();
  });

  it("parses plain path with fragment", () => {
    const r = parseLocator("hero-banner#layer=face");
    expect(r.scheme).toBe("");
    expect(r.path).toBe("hero-banner");
    expect(r.fragment).toBe("layer=face");
  });

  it("handles scheme with hyphens and underscores", () => {
    const r = parseLocator("dataset-v2://users_2024#filter=active");
    expect(r.scheme).toBe("dataset-v2");
    expect(r.path).toBe("users_2024");
    expect(r.fragment).toBe("filter=active");
  });
});

describe("locatorPath", () => {
  it("extracts path from URI locator", () => {
    expect(locatorPath("artifact://landing-page")).toBe("landing-page");
  });

  it("extracts path from plain locator", () => {
    expect(locatorPath("assets/logo.png")).toBe("assets/logo.png");
  });

  it("strips fragment", () => {
    expect(locatorPath("image://hero#bbox=1,2,3,4")).toBe("hero");
  });
});

describe("locatorScheme", () => {
  it("extracts scheme from URI locator", () => {
    expect(locatorScheme("binary://logo.png")).toBe("binary");
  });

  it("returns empty string for plain locator", () => {
    expect(locatorScheme("logo.png")).toBe("");
  });
});

describe("locatorPathsOverlap", () => {
  it("exact path match → overlap", () => {
    expect(locatorPathsOverlap("artifact://landing-page", "artifact://landing-page")).toBe(true);
  });

  it("exact plain path match → overlap", () => {
    expect(locatorPathsOverlap("assets/logo.png", "assets/logo.png")).toBe(true);
  });

  it("prefix containment → overlap", () => {
    expect(locatorPathsOverlap("artifact://ui", "artifact://ui/header")).toBe(true);
    expect(locatorPathsOverlap("artifact://ui/header", "artifact://ui")).toBe(true);
  });

  it("different paths → no overlap", () => {
    expect(locatorPathsOverlap("artifact://landing", "artifact://checkout")).toBe(false);
  });

  it("same path different fragment → overlap (MVP: fragment ignored)", () => {
    expect(locatorPathsOverlap("image://hero#layer=face", "image://hero#layer=bg")).toBe(true);
  });

  it("trailing slashes stripped", () => {
    expect(locatorPathsOverlap("binary://assets/", "binary://assets/logo.png")).toBe(true);
  });

  it("partial name match is NOT overlap", () => {
    expect(locatorPathsOverlap("artifact://landing-page", "artifact://landing-page-v2")).toBe(false);
  });

  it("cross-scheme locators overlap by path only", () => {
    expect(locatorPathsOverlap("artifact://shared", "binary://shared")).toBe(true);
  });
});
