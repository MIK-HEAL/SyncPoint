/**
 * Tests for context-policy.ts — types, policy registry, enums.
 */

import { describe, it, expect } from "vitest";
import {
  ContextIntent,
  ContextRole,
  ContextGateMode,
  ContextSection,
  CONTEXT_POLICIES,
  getContextPolicy,
  listContextIntents,
  listContextRoles,
} from "./context-policy.js";

describe("ContextIntent", () => {
  it("should have 7 intents", () => {
    expect(ContextIntent.options).toHaveLength(7);
  });

  it("should validate known intents", () => {
    expect(ContextIntent.parse("execute")).toBe("execute");
    expect(ContextIntent.parse("resume")).toBe("resume");
    expect(ContextIntent.parse("handoff-receive")).toBe("handoff-receive");
    expect(ContextIntent.parse("review")).toBe("review");
    expect(ContextIntent.parse("architect-plan")).toBe("architect-plan");
    expect(ContextIntent.parse("project-onboard")).toBe("project-onboard");
    expect(ContextIntent.parse("memory-review")).toBe("memory-review");
  });

  it("should reject unknown intents", () => {
    expect(() => ContextIntent.parse("unknown")).toThrow();
  });
});

describe("ContextRole", () => {
  it("should have 6 roles", () => {
    expect(ContextRole.options).toHaveLength(6);
  });

  it("should validate known roles", () => {
    for (const role of ["architect", "executor", "reviewer", "peer", "handoff-receiver", "observer"]) {
      expect(ContextRole.parse(role)).toBe(role);
    }
  });
});

describe("ContextGateMode", () => {
  it("should have 3 modes", () => {
    expect(ContextGateMode.options).toEqual(["hard", "soft", "none"]);
  });
});

describe("ContextSection", () => {
  it("should have at least 10 sections", () => {
    expect(ContextSection.options.length).toBeGreaterThanOrEqual(10);
  });
});

describe("CONTEXT_POLICIES", () => {
  it("should have a policy for every intent", () => {
    for (const intent of ContextIntent.options) {
      expect(CONTEXT_POLICIES[intent]).toBeDefined();
      expect(CONTEXT_POLICIES[intent].intent).toBe(intent);
    }
  });

  it("execute should be hard gate with task+agent+capsule+checkpoint required", () => {
    const p = CONTEXT_POLICIES["execute"];
    expect(p.gateMode).toBe("hard");
    expect(p.requiredSections).toContain("task");
    expect(p.requiredSections).toContain("agent");
    expect(p.requiredSections).toContain("latest-capsule");
    expect(p.requiredSections).toContain("latest-checkpoint");
  });

  it("resume should be hard gate", () => {
    expect(CONTEXT_POLICIES["resume"].gateMode).toBe("hard");
  });

  it("handoff-receive should be hard gate", () => {
    expect(CONTEXT_POLICIES["handoff-receive"].gateMode).toBe("hard");
  });

  it("review should be soft gate", () => {
    expect(CONTEXT_POLICIES["review"].gateMode).toBe("soft");
  });

  it("architect-plan should be soft gate with project-memory required", () => {
    const p = CONTEXT_POLICIES["architect-plan"];
    expect(p.gateMode).toBe("soft");
    expect(p.requiredSections).toContain("approved-project-memory");
  });

  it("project-onboard should be none gate", () => {
    expect(CONTEXT_POLICIES["project-onboard"].gateMode).toBe("none");
  });

  it("memory-review should be none gate", () => {
    expect(CONTEXT_POLICIES["memory-review"].gateMode).toBe("none");
  });
});

describe("getContextPolicy", () => {
  it("should return policy for known intent", () => {
    const p = getContextPolicy("execute");
    expect(p.intent).toBe("execute");
    expect(p.gateMode).toBe("hard");
  });
});

describe("listContextIntents", () => {
  it("should return all 7 intents", () => {
    expect(listContextIntents()).toHaveLength(7);
  });
});

describe("listContextRoles", () => {
  it("should return all 6 roles", () => {
    expect(listContextRoles()).toHaveLength(6);
  });
});
