/**
 * Unit tests for Agent Manifest + Escalation Routing.
 */

import { describe, it, expect } from "vitest";
import {
  AgentAvailability,
  EscalationOptIn,
  DEFAULT_AGENT_MANIFEST,
  routeEscalation,
} from "./agent-manifest.js";
import type { AgentManifest, EscalationRoutingInput } from "./agent-manifest.js";

// ── helpers ─────────────────────────────────────────

function makeManifest(agentId: string, overrides: Partial<Omit<AgentManifest, "agentId">> = {}): AgentManifest {
  return { agentId, ...DEFAULT_AGENT_MANIFEST, ...overrides };
}

function makeInput(overrides: Partial<EscalationRoutingInput> = {}): EscalationRoutingInput {
  return {
    gateId: "g1",
    taskId: "t1",
    reason: "test escalation",
    requiredAgentIds: ["a1", "a2"],
    escalationAgentIds: [],
    requiresHuman: false,
    ...overrides,
  };
}

const noCounts = new Map<string, number>();

// ── Filtering ───────────────────────────────────────

describe("escalation routing filtering", () => {
  it("excludes agents with optIn=NEVER", () => {
    const manifests = [
      makeManifest("e1", { escalationPreference: { optIn: EscalationOptIn.NEVER, priority: 50, maxConcurrentEscalations: 3 } }),
      makeManifest("e2"),
    ];
    const result = routeEscalation(makeInput(), manifests, noCounts);
    expect(result.map(c => c.agentId)).not.toContain("e1");
    expect(result.map(c => c.agentId)).toContain("e2");
  });

  it("excludes offline agents unless optIn=ALWAYS", () => {
    const manifests = [
      makeManifest("e1", { availability: AgentAvailability.OFFLINE }),
      makeManifest("e2", {
        availability: AgentAvailability.OFFLINE,
        escalationPreference: { optIn: EscalationOptIn.ALWAYS, priority: 50, maxConcurrentEscalations: 3 },
      }),
    ];
    const result = routeEscalation(makeInput(), manifests, noCounts);
    expect(result.map(c => c.agentId)).not.toContain("e1");
    expect(result.map(c => c.agentId)).toContain("e2");
  });

  it("excludes agents at max concurrent escalations", () => {
    const manifests = [
      makeManifest("e1", { escalationPreference: { optIn: EscalationOptIn.ALWAYS, priority: 50, maxConcurrentEscalations: 1 } }),
    ];
    const counts = new Map([["e1", 1]]);
    const result = routeEscalation(makeInput(), manifests, counts);
    expect(result).toHaveLength(0);
  });

  it("excludes agents already required on the gate", () => {
    const manifests = [
      makeManifest("a1"), // required agent
      makeManifest("e1"), // external
    ];
    const result = routeEscalation(makeInput({ requiredAgentIds: ["a1"] }), manifests, noCounts);
    expect(result.map(c => c.agentId)).not.toContain("a1");
    expect(result.map(c => c.agentId)).toContain("e1");
  });
});

// ── Scoring ─────────────────────────────────────────

describe("escalation routing scoring", () => {
  it("explicit escalation agents score highest", () => {
    const manifests = [
      makeManifest("e1"),
      makeManifest("e2"),
    ];
    const input = makeInput({ escalationAgentIds: ["e1"] });
    const result = routeEscalation(input, manifests, noCounts);
    expect(result[0]!.agentId).toBe("e1");
    expect(result[0]!.score).toBeGreaterThan(result[1]!.score);
  });

  it("human-capable agents boosted when requiresHuman", () => {
    const manifests = [
      makeManifest("e1", { canHandleHumanEscalation: false }),
      makeManifest("e2", { canHandleHumanEscalation: true }),
    ];
    const input = makeInput({ requiresHuman: true });
    const result = routeEscalation(input, manifests, noCounts);
    expect(result[0]!.agentId).toBe("e2");
  });

  it("domain match boosts score", () => {
    const manifests = [
      makeManifest("e1"),
      makeManifest("e2", { capabilities: [{ domain: "frontend", skills: [], resourceTypes: [] }] }),
    ];
    const input = makeInput({ relatedDomains: ["frontend"] });
    const result = routeEscalation(input, manifests, noCounts);
    expect(result[0]!.agentId).toBe("e2");
  });

  it("resource type match boosts score", () => {
    const manifests = [
      makeManifest("e1"),
      makeManifest("e2", { capabilities: [{ domain: "design", skills: [], resourceTypes: ["binary_asset"] }] }),
    ];
    const input = makeInput({ relatedResourceTypes: ["binary_asset"] });
    const result = routeEscalation(input, manifests, noCounts);
    expect(result[0]!.agentId).toBe("e2");
  });

  it("busy agents penalized", () => {
    const manifests = [
      makeManifest("e1", { availability: AgentAvailability.BUSY }),
      makeManifest("e2", { availability: AgentAvailability.ONLINE }),
    ];
    const result = routeEscalation(makeInput(), manifests, noCounts);
    expect(result[0]!.agentId).toBe("e2");
  });

  it("agents with active escalations penalized", () => {
    const manifests = [
      makeManifest("e1"),
      makeManifest("e2"),
    ];
    const counts = new Map([["e1", 2]]);
    const result = routeEscalation(makeInput(), manifests, counts);
    expect(result[0]!.agentId).toBe("e2");
  });

  it("higher priority agents rank first (all else equal)", () => {
    const manifests = [
      makeManifest("e1", { escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 30, maxConcurrentEscalations: 3 } }),
      makeManifest("e2", { escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 80, maxConcurrentEscalations: 3 } }),
    ];
    const result = routeEscalation(makeInput(), manifests, noCounts);
    expect(result[0]!.agentId).toBe("e2");
  });
});

// ── Edge cases ──────────────────────────────────────

describe("escalation routing edge cases", () => {
  it("empty manifests returns empty candidates", () => {
    const result = routeEscalation(makeInput(), [], noCounts);
    expect(result).toHaveLength(0);
  });

  it("all filtered out returns empty candidates", () => {
    const manifests = [
      makeManifest("a1"), // required agent — filtered
      makeManifest("a2"), // required agent — filtered
    ];
    const result = routeEscalation(makeInput({ requiredAgentIds: ["a1", "a2"] }), manifests, noCounts);
    expect(result).toHaveLength(0);
  });

  it("results sorted by score descending", () => {
    const manifests = [
      makeManifest("e1", { escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 10, maxConcurrentEscalations: 3 } }),
      makeManifest("e2", { escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 90, maxConcurrentEscalations: 3 } }),
      makeManifest("e3", { escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 50, maxConcurrentEscalations: 3 } }),
    ];
    const result = routeEscalation(makeInput(), manifests, noCounts);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.score).toBeGreaterThanOrEqual(result[i]!.score);
    }
  });
});
