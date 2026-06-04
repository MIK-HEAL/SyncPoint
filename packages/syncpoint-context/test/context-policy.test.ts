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
  getContextPolicyForMode,
  listContextIntents,
  listContextRoles,
} from "../src/context-policy.js";

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

  it("execute should be hard gate with task+agent+snapshot+checkpoint required", () => {
    const p = CONTEXT_POLICIES["execute"];
    expect(p.gateMode).toBe("hard");
    expect(p.requiredSections).toContain("task");
    expect(p.requiredSections).toContain("agent");
    expect(p.requiredSections).toContain("latest-snapshot");
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

// ── Mode-aware context policy ──

describe("getContextPolicyForMode", () => {
  it("returns base policy when no mode is given", () => {
    const p = getContextPolicyForMode("execute");
    expect(p).toEqual(getContextPolicy("execute"));
  });

  it("manager-delegate has no overrides", () => {
    const p = getContextPolicyForMode("execute", "manager-delegate");
    expect(p).toEqual(getContextPolicy("execute"));
  });

  it("peer-contract adds approved-contract as required for execute", () => {
    const p = getContextPolicyForMode("execute", "peer-contract");
    expect(p.requiredSections).toContain("approved-contract");
    // Also still has base required sections
    expect(p.requiredSections).toContain("task");
    expect(p.requiredSections).toContain("agent");
  });

  it("peer-contract adds approved-contract as required for resume", () => {
    const p = getContextPolicyForMode("resume", "peer-contract");
    expect(p.requiredSections).toContain("approved-contract");
  });

  it("handoff-resume adds handoff-context to execute includes", () => {
    const p = getContextPolicyForMode("execute", "handoff-resume");
    expect(p.includeSections).toContain("handoff-context");
  });

  it("handoff-resume downgrades review gate to none", () => {
    const p = getContextPolicyForMode("review", "handoff-resume");
    expect(p.gateMode).toBe("none");
    // Base is soft
    expect(getContextPolicy("review").gateMode).toBe("soft");
  });

  it("handoff-resume resume requires latest-snapshot and includes handoff-context", () => {
    const p = getContextPolicyForMode("resume", "handoff-resume");
    expect(p.requiredSections).toContain("latest-snapshot");
    expect(p.includeSections).toContain("handoff-context");
  });

  it("mode with no override for intent returns base", () => {
    const p = getContextPolicyForMode("architect-plan", "peer-contract");
    expect(p).toEqual(getContextPolicy("architect-plan"));
  });

  it("three modes produce different execute policies", () => {
    const md = getContextPolicyForMode("execute", "manager-delegate");
    const pc = getContextPolicyForMode("execute", "peer-contract");
    const hr = getContextPolicyForMode("execute", "handoff-resume");

    // peer-contract adds approved-contract as required
    expect(pc.requiredSections).toContain("approved-contract");
    expect(md.requiredSections).not.toContain("approved-contract");

    // handoff-resume adds handoff-context to includes
    expect(hr.includeSections).toContain("handoff-context");
    expect(md.includeSections).not.toContain("handoff-context");

    // All three share the same base gate mode
    expect(md.gateMode).toBe("hard");
    expect(pc.gateMode).toBe("hard");
    expect(hr.gateMode).toBe("hard");
  });
});
