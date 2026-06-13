/**
 * Tests for CLI formatter functions — pure output formatting.
 */
import { describe, it, expect } from "vitest";
import { formatStatusOutput, formatBlockedExplanation, formatResumeExplanation } from "../src/commands/formatter.js";
import type { Snapshot } from "../src/commands/formatter-types.js";

const baseMockSnapshot: Snapshot = {
  timestamp: "2025-06-13T12:00:00Z",
  sessions: [],
  agents: [],
  resourceOwnership: {
    activeClaims: [],
    conflicts: [],
    stats: { totalClaims: 0, exclusiveClaims: 0, sharedClaims: 0, hardConflicts: 0, softConflicts: 0 },
  },
  blockers: [],
  blockerCount: 0,
  operations: [],
  wakeQueue: [],
  recentEvents: [],
  gateStats: { total: 0, active: 0, resolved: 0, cancelled: 0 },
  summary: {
    activeSessionCount: 0,
    agentCount: 0,
    blockedAgentCount: 0,
    activeClaimCount: 0,
    hardConflictCount: 0,
    pendingOperationCount: 0,
    pendingWakeCount: 0,
    blockerCount: 0,
    constraintBlockedAgents: 0,
    constraintBlockedTasks: 0,
  },
};

describe("formatStatusOutput", () => {
  it("returns 'All clear' when no blockers", () => {
    const result = formatStatusOutput(baseMockSnapshot);
    expect(result).toContain("All clear — no active blockers");
  });

  it("shows blocked agent count", () => {
    const snap = {
      ...baseMockSnapshot,
      summary: { ...baseMockSnapshot.summary, blockedAgentCount: 2, blockerCount: 3 },
    };
    const result = formatStatusOutput(snap);
    expect(result).toContain("2 agent(s) blocked, 3 blocker(s) active");
  });

  it("shows sessions section", () => {
    const snap = {
      ...baseMockSnapshot,
      sessions: [{
        id: "s1",
        title: "My Session",
        status: "EXECUTING",
        relationshipMode: "manager-delegate",
        agents: [{ agentId: "a1", agentName: "cursor", role: "executor" }],
      }],
      summary: { ...baseMockSnapshot.summary, activeSessionCount: 1 },
    };
    const result = formatStatusOutput(snap);
    expect(result).toContain("Sessions");
    expect(result).toContain("My Session");
    expect(result).toContain("cursor — executor");
  });

  it("shows agents section with blocked status", () => {
    const snap = {
      ...baseMockSnapshot,
      agents: [{
        id: "a1", name: "cursor", status: "IDLE", provider: "cursor", role: "frontend",
        blocked: true, blockingGateIds: [], constraintBlocked: false,
        constraintBlockerCount: 0, constraintWarningCount: 0,
        activeAssignments: [], claimedResources: [], pendingWakeCount: 0,
      }],
      summary: { ...baseMockSnapshot.summary, agentCount: 1, blockedAgentCount: 1 },
    };
    const result = formatStatusOutput(snap);
    expect(result).toContain("BLOCKED");
    expect(result).toContain("cursor");
  });

  it("shows resource conflicts", () => {
    const snap = {
      ...baseMockSnapshot,
      resourceOwnership: {
        ...baseMockSnapshot.resourceOwnership,
        conflicts: [{
          overlappingLocator: "src/file.ts",
          claimA: { id: "c1", actorId: "a1", actorName: "Alice", mode: "exclusive" },
          claimB: { id: "c2", actorId: "a2", actorName: "Bob", mode: "exclusive" },
        }],
        stats: { ...baseMockSnapshot.resourceOwnership.stats, hardConflicts: 1 },
      },
      summary: { ...baseMockSnapshot.summary, hardConflictCount: 1 },
    };
    const result = formatStatusOutput(snap);
    expect(result).toContain("Conflict");
    expect(result).toContain("src/file.ts");
    expect(result).toContain("Alice");
    expect(result).toContain("Bob");
  });

  it("shows blocker details with suggested actions", () => {
    const snap: Snapshot = {
      ...baseMockSnapshot,
      agents: [{
        id: "a1", name: "cursor", status: "IDLE", provider: "cursor", role: "frontend",
        blocked: true, blockingGateIds: ["g1"],
        constraintBlocked: false, constraintBlockerCount: 0, constraintWarningCount: 0,
        activeAssignments: [], claimedResources: [], pendingWakeCount: 0,
      }],
      blockers: [{
        id: "g1",
        agentId: "a2",
        agentName: "Other",
        type: "sync_gate",
        reason: "resource_conflict",
        status: "SYNC_REQUESTED",
        description: "src/a.ts ↔ src/a.ts",
        blockedAgentNames: ["cursor"],
        requiredAgents: [{ id: "a1", name: "cursor" }, { id: "a2", name: "Other" }],
        gateDetails: {
          policy: "majority_veto",
          pendingAgentIds: ["a1", "a2"],
          ackedAgentIds: [],
          voteCounts: { approve: 0, reject: 0, abstain: 0, escalate: 0 },
          eligibleVoterIds: ["a1", "a2"],
          requiresHuman: false,
          availableActions: ["ack", "vote"],
          livenessPreview: { action: "wait", reason: "waiting for votes" },
          deadlineAt: undefined,
        },
      }],
      blockerCount: 1,
      gateStats: { ...baseMockSnapshot.gateStats, active: 1 },
      summary: { ...baseMockSnapshot.summary, blockerCount: 1, blockedAgentCount: 1 },
    };
    const result = formatStatusOutput(snap);
    expect(result).toContain("Sync Gate");
    expect(result).toContain("resource ownership conflict");
    expect(result).toContain("majority_veto");
    expect(result).toContain("syncpoint sync ack");
  });
});

describe("formatBlockedExplanation", () => {
  it("returns 'No agents are currently blocked' when clear", () => {
    const result = formatBlockedExplanation(baseMockSnapshot);
    expect(result).toContain("No agents are currently blocked");
  });

  it("explains why an agent is blocked", () => {
    const snap: Snapshot = {
      ...baseMockSnapshot,
      agents: [{
        id: "a1", name: "cursor", status: "IDLE", provider: "cursor", role: "frontend",
        blocked: true, blockingGateIds: [],
        constraintBlocked: false, constraintBlockerCount: 0, constraintWarningCount: 0,
        activeAssignments: [], claimedResources: [], pendingWakeCount: 0,
      }],
      blockers: [{
        id: "b1", agentId: "a2", agentName: "Other",
        type: "review", reason: "review_requested",
        status: "OPEN", description: "Review required for merge",
        blockedAgentNames: ["cursor"],
        requiredAgents: [{ id: "a1", name: "cursor" }],
        gateDetails: undefined,
      }],
      blockerCount: 1,
      summary: { ...baseMockSnapshot.summary, blockerCount: 1, blockedAgentCount: 1 },
    };
    const result = formatBlockedExplanation(snap);
    expect(result).toContain("Blocked agent");
    expect(result).toContain("cursor");
    expect(result).toContain("review missing");
  });

  it("explains constraint blocking", () => {
    const snap: Snapshot = {
      ...baseMockSnapshot,
      agents: [{
        id: "a1", name: "cursor", status: "IDLE", provider: "cursor", role: "frontend",
        blocked: false, blockingGateIds: [],
        constraintBlocked: true, constraintBlockerCount: 1, constraintWarningCount: 0,
        activeAssignments: [], claimedResources: [], pendingWakeCount: 0,
      }],
      summary: { ...baseMockSnapshot.summary, constraintBlockedAgents: 1 },
    };
    const result = formatBlockedExplanation(snap);
    expect(result).toContain("constraint violation on working files");
  });
});

describe("formatResumeExplanation", () => {
  it("shows Resume Ready when not blocked", () => {
    const result = formatResumeExplanation({
      agentId: "a1",
      agentName: "cursor",
      taskTitle: "Build feature",
      blocked: false,
      snapshotValid: true,
      protocolGateBlocked: false,
      validationNotes: ["All checks passed"],
      constraintWarnings: [],
    });
    expect(result).toContain("Resume Ready");
    expect(result).toContain("cursor");
    expect(result).toContain("Build feature");
  });

  it("shows Resume BLOCKED when blocked", () => {
    const result = formatResumeExplanation({
      agentId: "a1",
      agentName: "cursor",
      taskTitle: "Build feature",
      blocked: true,
      snapshotValid: false,
      protocolGateBlocked: true,
      validationNotes: [],
      constraintWarnings: ["constraint: no raw Error allowed"],
    });
    expect(result).toContain("Resume BLOCKED");
    expect(result).toContain("Protocol gate is blocking");
    expect(result).toContain("Snapshot validation failed");
    expect(result).toContain("no raw Error allowed");
  });

  it("shows snapshot recovery info", () => {
    const result = formatResumeExplanation({
      agentId: "a1",
      agentName: "cursor",
      taskTitle: "Build MCP",
      blocked: false,
      snapshotValid: true,
      protocolGateBlocked: false,
      validationNotes: [],
      constraintWarnings: [],
      goal: "Implement MCP server",
      phase: "development",
      completedWork: "Scaffolded tools",
      remainingWork: "Add tests",
      workingResources: "src/tools/**",
      nextSteps: "Run integration tests",
    });
    expect(result).toContain("Goal: Implement MCP server");
    expect(result).toContain("Phase: development");
    expect(result).toContain("Completed: Scaffolded tools");
    expect(result).toContain("Remaining: Add tests");
    expect(result).toContain("Run integration tests");
  });
});
