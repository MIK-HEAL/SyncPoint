/**
 * Unit tests for Relationship Mode — mode rules, wake verbs, phase flows.
 */

import { describe, it, expect } from "vitest";
import {
  RelationshipMode,
  MODE_PHASE_FLOW,
  MODE_SYNC_RULES,
  MODE_WAKE_VERBS,
  FORBIDDEN_ACTIONS,
  REQUIRED_BEFORE_START,
  RECOMMENDED_ACTIONS,
  isValidWakeVerb,
  getSyncRules,
  getPhaseFlow,
  getModeDescription,
  isModeActionAllowed,
  getRequiredBeforeStart,
  getRecommendedActions,
  getForbiddenActions,
} from "./relationship-mode.js";

describe("RelationshipMode enum", () => {
  it("has three modes", () => {
    expect(Object.values(RelationshipMode)).toEqual([
      "manager-delegate",
      "peer-contract",
      "handoff-resume",
    ]);
  });
});

describe("MODE_PHASE_FLOW", () => {
  it("manager-delegate starts with plan and ends with approve", () => {
    const flow = MODE_PHASE_FLOW[RelationshipMode.MANAGER_DELEGATE];
    expect(flow[0]).toBe("plan");
    expect(flow[flow.length - 1]).toBe("approve");
  });

  it("peer-contract includes sync and merge", () => {
    const flow = MODE_PHASE_FLOW[RelationshipMode.PEER_CONTRACT];
    expect(flow).toContain("sync");
    expect(flow).toContain("merge");
  });

  it("handoff-resume starts with snapshot", () => {
    const flow = MODE_PHASE_FLOW[RelationshipMode.HANDOFF_RESUME];
    expect(flow[0]).toBe("snapshot");
    expect(flow).toContain("handoff");
    expect(flow).toContain("resume");
  });
});

describe("MODE_SYNC_RULES", () => {
  it("manager-delegate does not require sync gate or file claim", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.MANAGER_DELEGATE];
    expect(rules.requiresSyncGate).toBe(false);
    expect(rules.requiresResourceClaim).toBe(false);
    expect(rules.requiresReview).toBe(true);
    expect(rules.allowsParallelWork).toBe(false);
  });

  it("peer-contract requires sync gate and file claim", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.PEER_CONTRACT];
    expect(rules.requiresSyncGate).toBe(true);
    expect(rules.requiresResourceClaim).toBe(true);
    expect(rules.allowsParallelWork).toBe(true);
  });

  it("handoff-resume requires checkpoint but not review", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.HANDOFF_RESUME];
    expect(rules.requiresCheckpoint).toBe(true);
    expect(rules.requiresReview).toBe(false);
    expect(rules.allowsParallelWork).toBe(false);
  });
});

describe("isValidWakeVerb", () => {
  it("plan is valid for manager-delegate", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "plan")).toBe(true);
  });

  it("sync is not valid for manager-delegate", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "sync")).toBe(false);
  });

  it("sync is valid for peer-contract", () => {
    expect(isValidWakeVerb(RelationshipMode.PEER_CONTRACT, "sync")).toBe(true);
  });

  it("handoff is valid for handoff-resume", () => {
    expect(isValidWakeVerb(RelationshipMode.HANDOFF_RESUME, "handoff")).toBe(true);
  });

  it("review is not valid for handoff-resume", () => {
    expect(isValidWakeVerb(RelationshipMode.HANDOFF_RESUME, "review")).toBe(false);
  });

  it("arbitrary verb is invalid for all modes", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "auto-run")).toBe(false);
    expect(isValidWakeVerb(RelationshipMode.PEER_CONTRACT, "auto-run")).toBe(false);
    expect(isValidWakeVerb(RelationshipMode.HANDOFF_RESUME, "auto-run")).toBe(false);
  });
});

describe("getSyncRules", () => {
  it("returns rules for each mode", () => {
    for (const mode of Object.values(RelationshipMode)) {
      const rules = getSyncRules(mode);
      expect(rules).toHaveProperty("requiresSyncGate");
      expect(rules).toHaveProperty("requiresResourceClaim");
      expect(rules).toHaveProperty("requiresCheckpoint");
      expect(rules).toHaveProperty("requiresReview");
      expect(rules).toHaveProperty("allowsParallelWork");
    }
  });
});

describe("getPhaseFlow", () => {
  it("returns non-empty array for each mode", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(getPhaseFlow(mode).length).toBeGreaterThan(0);
    }
  });
});

describe("getModeDescription", () => {
  it("returns description for each mode", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(getModeDescription(mode).length).toBeGreaterThan(20);
    }
  });
});

describe("FORBIDDEN_ACTIONS", () => {
  it("manager-delegate forbids claim-resources, sync-checkpoint, handoff, snapshot", () => {
    const f = FORBIDDEN_ACTIONS[RelationshipMode.MANAGER_DELEGATE];
    expect(f).toContain("claim-resources");
    expect(f).toContain("sync-checkpoint");
    expect(f).toContain("handoff");
    expect(f).toContain("snapshot");
  });

  it("peer-contract forbids handoff, snapshot", () => {
    const f = FORBIDDEN_ACTIONS[RelationshipMode.PEER_CONTRACT];
    expect(f).toContain("handoff");
    expect(f).toContain("snapshot");
    expect(f).not.toContain("claim-resources");
  });

  it("handoff-resume forbids claim-resources, sync-checkpoint, start-review, request-review", () => {
    const f = FORBIDDEN_ACTIONS[RelationshipMode.HANDOFF_RESUME];
    expect(f).toContain("claim-resources");
    expect(f).toContain("sync-checkpoint");
    expect(f).toContain("start-review");
    expect(f).toContain("request-review");
  });
});

describe("isModeActionAllowed", () => {
  it("manager-delegate: checkpoint is recommended", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "checkpoint")).toBe("recommended");
  });

  it("manager-delegate: claim-resources is blocked", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "claim-resources")).toBe("blocked");
  });

  it("manager-delegate: accept is allowed (neither recommended nor blocked)", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "accept")).toBe("allowed");
  });

  it("peer-contract: sync-checkpoint is recommended", () => {
    expect(isModeActionAllowed(RelationshipMode.PEER_CONTRACT, "sync-checkpoint")).toBe("recommended");
  });

  it("peer-contract: handoff is blocked", () => {
    expect(isModeActionAllowed(RelationshipMode.PEER_CONTRACT, "handoff")).toBe("blocked");
  });

  it("handoff-resume: handoff is recommended", () => {
    expect(isModeActionAllowed(RelationshipMode.HANDOFF_RESUME, "handoff")).toBe("recommended");
  });

  it("handoff-resume: claim-resources is blocked", () => {
    expect(isModeActionAllowed(RelationshipMode.HANDOFF_RESUME, "claim-resources")).toBe("blocked");
  });

  it("handoff-resume: start-review is blocked", () => {
    expect(isModeActionAllowed(RelationshipMode.HANDOFF_RESUME, "start-review")).toBe("blocked");
  });
});

describe("getRequiredBeforeStart", () => {
  it("manager-delegate requires accept", () => {
    expect(getRequiredBeforeStart(RelationshipMode.MANAGER_DELEGATE)).toEqual(["accept"]);
  });

  it("peer-contract requires accept and claim-resources", () => {
    const req = getRequiredBeforeStart(RelationshipMode.PEER_CONTRACT);
    expect(req).toContain("accept");
    expect(req).toContain("claim-resources");
  });

  it("handoff-resume requires accept", () => {
    expect(getRequiredBeforeStart(RelationshipMode.HANDOFF_RESUME)).toEqual(["accept"]);
  });
});

describe("getRecommendedActions", () => {
  it("each mode has at least 2 recommended actions", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(getRecommendedActions(mode).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("getForbiddenActions", () => {
  it("each mode has at least 2 forbidden actions", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(getForbiddenActions(mode).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("forbidden and recommended actions do not overlap", () => {
    for (const mode of Object.values(RelationshipMode)) {
      const forbidden = getForbiddenActions(mode);
      const recommended = getRecommendedActions(mode);
      for (const a of forbidden) {
        expect(recommended).not.toContain(a);
      }
    }
  });
});
