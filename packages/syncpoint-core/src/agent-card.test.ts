import { describe, expect, it } from "vitest";
import { AgentAvailability, EscalationOptIn } from "./agent-manifest.js";
import { AgentStatus } from "./states.js";
import { buildAgentCard } from "./agent-card.js";
import { toUserAgentManifestFromRuntime } from "./agent-manifest-conversion.js";

describe("runtime manifest conversion", () => {
  it("creates a user manifest from runtime agent state", () => {
    const manifest = toUserAgentManifestFromRuntime({
      agent: {
        name: "backend-ada",
        provider: "cursor",
        role: "backend",
      },
      runtimeManifest: {
        tags: ["api", "api", "service"],
        capabilities: [{ domain: "api", skills: ["typescript"], resourceTypes: ["file"] }],
        availability: AgentAvailability.BUSY,
        canHandleHumanEscalation: true,
      },
      overrides: {
        notes: "Handles service layer work.",
      },
    });

    expect(manifest.name).toBe("backend-ada");
    expect(manifest.provider).toBe("cursor");
    expect(manifest.role).toBe("backend");
    expect(manifest.tags).toEqual(["api", "service"]);
    expect(manifest.availability).toBe("busy");
    expect(manifest.canHandleHumanEscalation).toBe(true);
    expect(manifest.notes).toBe("Handles service layer work.");
  });
});

describe("agent cards", () => {
  it("builds cards from declared manifests", () => {
    const card = buildAgentCard({
      manifestPath: ".syncpoint/agents/reviewer.yml",
      agent: {
        id: "agent-1",
        name: "reviewer",
        provider: "cursor",
        role: "reviewer",
        status: AgentStatus.IDLE,
      },
      declaredManifest: {
        version: 1,
        name: "reviewer",
        profile: "reviewer",
        provider: "cursor",
        role: "reviewer",
        tags: ["review"],
        capabilities: [{ domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] }],
        availability: AgentAvailability.ONLINE,
        autoStart: false,
        notes: "Reviews risky changes.",
        escalationPreference: {
          optIn: EscalationOptIn.WHEN_AVAILABLE,
          priority: 50,
          maxConcurrentEscalations: 3,
        },
        canHandleHumanEscalation: false,
      },
      metadata: {
        exportedBy: "test",
      },
    });

    expect(card.schema).toBe("syncpoint/agent-card/v1");
    expect(card.agentId).toBe("agent-1");
    expect(card.manifestPath).toBe(".syncpoint/agents/reviewer.yml");
    expect(card.name).toBe("reviewer");
    expect(card.tags).toEqual(["review"]);
    expect(card.metadata).toEqual({
      source: "declared",
      exportedBy: "test",
    });
  });

  it("derives cards from runtime agents when no declaration is available", () => {
    const card = buildAgentCard({
      agent: {
        id: "agent-2",
        name: "architect",
        provider: "other",
        role: "manager",
        status: AgentStatus.WAITING_SYNC,
      },
      runtimeManifest: {
        tags: ["coordination"],
        capabilities: [{ domain: "planning", skills: [], resourceTypes: [] }],
        availability: AgentAvailability.ONLINE,
        canHandleHumanEscalation: true,
        escalationPreference: {
          optIn: EscalationOptIn.ALWAYS,
          priority: 80,
          maxConcurrentEscalations: 2,
        },
      },
    });

    expect(card.name).toBe("architect");
    expect(card.role).toBe("manager");
    expect(card.provider).toBe("other");
    expect(card.status).toBe(AgentStatus.WAITING_SYNC);
    expect(card.metadata.source).toBe("runtime-derived");
    expect(card.canHandleHumanEscalation).toBe(true);
  });
});
