import { describe, it, expect } from "vitest";
import {
  RelationshipMode,
  MODE_PHASE_FLOW,
  MODE_SYNC_RULES,
  MODE_WAKE_VERBS,
  REQUIRED_BEFORE_START,
  RECOMMENDED_ACTIONS,
  FORBIDDEN_ACTIONS,
  isValidWakeVerb,
  getSyncRules,
  getPhaseFlow,
  getModeDescription,
  isModeActionAllowed,
  getRequiredBeforeStart,
  getRecommendedActions,
  getForbiddenActions,
} from "../src/relationship-mode.js";

// ── Relationship modes ───────────────────────────────────

describe("RelationshipMode", () => {
  it("has exactly three modes", () => {
    const modes = Object.values(RelationshipMode);
    expect(modes).toHaveLength(3);
    expect(modes).toContain("manager-delegate");
    expect(modes).toContain("peer-contract");
    expect(modes).toContain("handoff-resume");
  });
});

// ── MODE_PHASE_FLOW ──────────────────────────────────────

describe("MODE_PHASE_FLOW", () => {
  it("all modes have a defined phase flow", () => {
    for (const mode of Object.values(RelationshipMode)) {
      const phases = MODE_PHASE_FLOW[mode];
      expect(phases).toBeDefined();
      expect(phases.length).toBeGreaterThan(0);
    }
  });

  it("manager-delegate includes plan and review", () => {
    const phases = MODE_PHASE_FLOW[RelationshipMode.MANAGER_DELEGATE];
    expect(phases).toContain("plan");
    expect(phases).toContain("review");
    expect(phases).toContain("approve");
  });

  it("peer-contract includes contract and sync", () => {
    const phases = MODE_PHASE_FLOW[RelationshipMode.PEER_CONTRACT];
    expect(phases).toContain("contract");
    expect(phases).toContain("claim-resources");
    expect(phases).toContain("sync");
  });

  it("handoff-resume includes snapshot and handoff", () => {
    const phases = MODE_PHASE_FLOW[RelationshipMode.HANDOFF_RESUME];
    expect(phases).toContain("snapshot");
    expect(phases).toContain("handoff");
    expect(phases).toContain("accept");
  });
});

// ── MODE_SYNC_RULES ──────────────────────────────────────

describe("MODE_SYNC_RULES", () => {
  it("all modes have sync rules", () => {
    for (const mode of Object.values(RelationshipMode)) {
      const rules = MODE_SYNC_RULES[mode];
      expect(rules).toBeDefined();
      expect(typeof rules.requiresSyncGate).toBe("boolean");
      expect(typeof rules.requiresResourceClaim).toBe("boolean");
      expect(typeof rules.requiresCheckpoint).toBe("boolean");
      expect(typeof rules.requiresReview).toBe("boolean");
      expect(typeof rules.allowsParallelWork).toBe("boolean");
    }
  });

  it("peer-contract requires sync gate and resource claim", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.PEER_CONTRACT];
    expect(rules.requiresSyncGate).toBe(true);
    expect(rules.requiresResourceClaim).toBe(true);
    expect(rules.allowsParallelWork).toBe(true);
  });

  it("manager-delegate does NOT allow parallel work", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.MANAGER_DELEGATE];
    expect(rules.allowsParallelWork).toBe(false);
  });

  it("handoff-resume does NOT require review", () => {
    const rules = MODE_SYNC_RULES[RelationshipMode.HANDOFF_RESUME];
    expect(rules.requiresReview).toBe(false);
  });
});

// ── MODE_WAKE_VERBS ──────────────────────────────────────

describe("MODE_WAKE_VERBS", () => {
  it("all modes have wake verbs", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(MODE_WAKE_VERBS[mode].length).toBeGreaterThan(0);
    }
  });
});

// ── REQUIRED_BEFORE_START ─────────────────────────────────

describe("REQUIRED_BEFORE_START", () => {
  it("all modes require accept before start", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(REQUIRED_BEFORE_START[mode]).toContain("accept");
    }
  });

  it("peer-contract additionally requires claim-resources", () => {
    expect(REQUIRED_BEFORE_START[RelationshipMode.PEER_CONTRACT]).toContain("claim-resources");
  });
});

// ── RECOMMENDED_ACTIONS ──────────────────────────────────

describe("RECOMMENDED_ACTIONS", () => {
  it("manager-delegate recommends checkpoint, review, approve", () => {
    const actions = RECOMMENDED_ACTIONS[RelationshipMode.MANAGER_DELEGATE];
    expect(actions).toContain("checkpoint");
    expect(actions).toContain("review");
    expect(actions).toContain("approve");
  });

  it("handoff-resume recommends checkpoint, snapshot, handoff", () => {
    const actions = RECOMMENDED_ACTIONS[RelationshipMode.HANDOFF_RESUME];
    expect(actions).toContain("checkpoint");
    expect(actions).toContain("snapshot");
    expect(actions).toContain("handoff");
  });
});

// ── FORBIDDEN_ACTIONS ────────────────────────────────────

describe("FORBIDDEN_ACTIONS", () => {
  it("manager-delegate forbids claim-resources and handoff", () => {
    const forbidden = FORBIDDEN_ACTIONS[RelationshipMode.MANAGER_DELEGATE];
    expect(forbidden).toContain("claim-resources");
    expect(forbidden).toContain("handoff");
    expect(forbidden).toContain("snapshot");
  });

  it("handoff-resume forbids claim-resources and review actions", () => {
    const forbidden = FORBIDDEN_ACTIONS[RelationshipMode.HANDOFF_RESUME];
    expect(forbidden).toContain("claim-resources");
    expect(forbidden).toContain("start-review");
    expect(forbidden).toContain("request-review");
  });
});

// ── Pure helpers ─────────────────────────────────────────

describe("isValidWakeVerb", () => {
  it("returns true for valid wake verb in mode", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "plan")).toBe(true);
    expect(isValidWakeVerb(RelationshipMode.PEER_CONTRACT, "claim-resources")).toBe(true);
    expect(isValidWakeVerb(RelationshipMode.HANDOFF_RESUME, "snapshot")).toBe(true);
  });

  it("returns false for invalid wake verb in mode", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "claim-resources")).toBe(false);
    expect(isValidWakeVerb(RelationshipMode.HANDOFF_RESUME, "start-review")).toBe(false);
  });

  it("returns false for unknown action", () => {
    expect(isValidWakeVerb(RelationshipMode.MANAGER_DELEGATE, "fly-to-moon")).toBe(false);
  });
});

describe("getSyncRules", () => {
  it("returns rules for each mode", () => {
    expect(getSyncRules(RelationshipMode.MANAGER_DELEGATE).requiresCheckpoint).toBe(true);
    expect(getSyncRules(RelationshipMode.PEER_CONTRACT).requiresSyncGate).toBe(true);
  });
});

describe("getPhaseFlow", () => {
  it("returns phase flow array", () => {
    expect(getPhaseFlow(RelationshipMode.MANAGER_DELEGATE)).toBe(
      MODE_PHASE_FLOW[RelationshipMode.MANAGER_DELEGATE]
    );
  });
});

describe("getModeDescription", () => {
  it("returns a non-empty string for each mode", () => {
    for (const mode of Object.values(RelationshipMode)) {
      const desc = getModeDescription(mode);
      expect(typeof desc).toBe("string");
      expect(desc.length).toBeGreaterThan(10);
    }
  });

  it("manager-delegate description mentions delegation", () => {
    expect(getModeDescription(RelationshipMode.MANAGER_DELEGATE)).toMatch(/delegate/i);
  });

  it("peer-contract description mentions parallel", () => {
    expect(getModeDescription(RelationshipMode.PEER_CONTRACT)).toMatch(/parallel/i);
  });

  it("handoff-resume description mentions snapshot", () => {
    expect(getModeDescription(RelationshipMode.HANDOFF_RESUME)).toMatch(/snapshot/i);
  });
});

describe("isModeActionAllowed", () => {
  it("returns blocked for forbidden actions", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "handoff")).toBe("blocked");
  });

  it("returns recommended for recommended actions", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "checkpoint")).toBe("recommended");
  });

  it("returns allowed for other valid actions", () => {
    expect(isModeActionAllowed(RelationshipMode.MANAGER_DELEGATE, "plan")).toBe("allowed");
  });
});

describe("getRequiredBeforeStart", () => {
  it("all modes require accept", () => {
    for (const mode of Object.values(RelationshipMode)) {
      expect(getRequiredBeforeStart(mode)).toContain("accept");
    }
  });
});

describe("getRecommendedActions", () => {
  it("returns recommended actions array", () => {
    expect(getRecommendedActions(RelationshipMode.MANAGER_DELEGATE)).toBe(
      RECOMMENDED_ACTIONS[RelationshipMode.MANAGER_DELEGATE]
    );
  });
});

describe("getForbiddenActions", () => {
  it("returns forbidden actions array", () => {
    expect(getForbiddenActions(RelationshipMode.MANAGER_DELEGATE)).toBe(
      FORBIDDEN_ACTIONS[RelationshipMode.MANAGER_DELEGATE]
    );
  });
});
