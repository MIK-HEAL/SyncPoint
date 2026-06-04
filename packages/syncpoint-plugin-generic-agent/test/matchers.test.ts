/**
 * Tests for generic ResourceMatcher implementations.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerResourceMatcher,
  clearResourceMatcherRegistry,
  resourceLocatorsOverlap,
} from "syncpoint-core";
import type { ResourceRef } from "syncpoint-core";
import { GENERIC_RESOURCE_MATCHERS } from "../src/matchers.js";

function ref(type: string, locator: string): ResourceRef {
  return { type, locator, metadata: "", scope: "file" as const };
}

beforeEach(() => {
  clearResourceMatcherRegistry();
  for (const m of GENERIC_RESOURCE_MATCHERS) {
    registerResourceMatcher(m);
  }
});

describe("artifact matcher", () => {
  it("exact match overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("artifact", "artifact://landing-page"),
      ref("artifact", "artifact://landing-page"),
    )).toBe(true);
  });

  it("prefix containment overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("artifact", "artifact://ui"),
      ref("artifact", "artifact://ui/header"),
    )).toBe(true);
  });

  it("different paths do not overlap", () => {
    expect(resourceLocatorsOverlap(
      ref("artifact", "artifact://landing"),
      ref("artifact", "artifact://checkout"),
    )).toBe(false);
  });
});

describe("binary_asset matcher", () => {
  it("exact match overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("binary_asset", "binary://assets/logo.png"),
      ref("binary_asset", "binary://assets/logo.png"),
    )).toBe(true);
  });

  it("directory prefix overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("binary_asset", "binary://assets"),
      ref("binary_asset", "binary://assets/logo.png"),
    )).toBe(true);
  });

  it("different assets do not overlap", () => {
    expect(resourceLocatorsOverlap(
      ref("binary_asset", "binary://assets/logo.png"),
      ref("binary_asset", "binary://assets/banner.jpg"),
    )).toBe(false);
  });
});

describe("document matcher", () => {
  it("exact document ID overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("document", "doc://PRD-001"),
      ref("document", "doc://PRD-001"),
    )).toBe(true);
  });

  it("same doc different fragment overlaps (MVP)", () => {
    expect(resourceLocatorsOverlap(
      ref("document", "doc://PRD-001#section=pricing"),
      ref("document", "doc://PRD-001#section=features"),
    )).toBe(true);
  });

  it("different documents do not overlap", () => {
    expect(resourceLocatorsOverlap(
      ref("document", "doc://PRD-001"),
      ref("document", "doc://PRD-002"),
    )).toBe(false);
  });
});

describe("design_asset matcher", () => {
  it("exact match overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("design_asset", "design://homepage-hero"),
      ref("design_asset", "design://homepage-hero"),
    )).toBe(true);
  });
});

describe("dataset_slice matcher", () => {
  it("exact match overlaps", () => {
    expect(resourceLocatorsOverlap(
      ref("dataset_slice", "dataset://users-2024"),
      ref("dataset_slice", "dataset://users-2024"),
    )).toBe(true);
  });

  it("same dataset different filter overlaps (MVP)", () => {
    expect(resourceLocatorsOverlap(
      ref("dataset_slice", "dataset://users-2024#filter=active"),
      ref("dataset_slice", "dataset://users-2024#filter=churned"),
    )).toBe(true);
  });
});

describe("cross-type isolation", () => {
  it("different resource types never overlap", () => {
    expect(resourceLocatorsOverlap(
      ref("artifact", "artifact://shared"),
      ref("binary_asset", "binary://shared"),
    )).toBe(false);
  });
});

describe("plain locators (no URI scheme)", () => {
  it("plain asset name exact match", () => {
    expect(resourceLocatorsOverlap(
      ref("binary_asset", "hero-banner.png"),
      ref("binary_asset", "hero-banner.png"),
    )).toBe(true);
  });

  it("plain path prefix overlap", () => {
    expect(resourceLocatorsOverlap(
      ref("binary_asset", "assets"),
      ref("binary_asset", "assets/logo.png"),
    )).toBe(true);
  });
});
