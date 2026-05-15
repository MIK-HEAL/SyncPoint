/**
 * Tests for Agent Adapter Protocol.
 */
import { describe, it, expect } from "vitest";
import {
  buildAdapterInstruction,
  getAdapterConfig,
  listAdapterProviders,
  ADAPTER_CONFIGS,
} from "./adapter.ts";
import { QualityCheckStatus } from "./memory.ts";
import type { ResumeContext } from "./memory.ts";

function makeCtx(overrides?: Partial<ResumeContext>): ResumeContext {
  return {
    taskId: "t1",
    agentId: "a1",
    ready: true,
    checks: [
      { name: "Completeness", status: QualityCheckStatus.PASS, message: "OK" },
    ],
    task: { id: "t1", title: "Build auth", status: "IN_PROGRESS", ownerAgentId: "a1" },
    agent: { id: "a1", name: "codex", role: "backend" },
    approvedContract: {
      id: "c1",
      title: "Auth contract",
      scope: "auth module",
      responsibilities: "backend: API",
      interfaceSpec: "POST /login",
      fileBoundaries: "src/auth/*",
      status: "APPROVED",
    },
    latestSnapshot: {
      id: "cap1",
      kind: "resume",
      summary: "Implement auth API",
      payloadJson: JSON.stringify({
        goal: "Implement auth API",
        currentPhase: "implementation",
        confirmedDecisions: ["JWT auth"],
        workingResources: ["src/auth/login.ts"],
        completedWork: "Schema defined",
        remainingWork: "Implement handler",
        risks: [],
        blockers: [],
        nextSteps: ["Write login endpoint"],
        resumePrompt: "Continue implementing POST /login with JWT.",
        intentScope: "",
        nonGoals: [],
        verifiedFacts: [],
        unverifiedClaims: [],
        evidenceRefs: [],
        activeConstraints: [],
        doNotTouch: [],
        handoffInstructions: "",
      }),
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    latestCheckpoint: {
      id: "cp1",
      summary: "Started auth work",
      progress: "50%",
      risks: "",
      blockers: "",
      nextSteps: "Implement handler",
      needSync: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    pinnedMemories: [
      { key: "code-style", content: "Use TypeScript strict mode" },
    ],
    projectMemories: [],
    resumePrompt: "raw resume prompt",
    warnings: [],
    contextMode: "snapshot-first",
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Agent Adapter Protocol", () => {
  describe("ADAPTER_CONFIGS", () => {
    it("has configs for all standard providers", () => {
      expect(ADAPTER_CONFIGS).toHaveProperty("cursor");
      expect(ADAPTER_CONFIGS).toHaveProperty("claude-code");
      expect(ADAPTER_CONFIGS).toHaveProperty("codex");
      expect(ADAPTER_CONFIGS).toHaveProperty("cline");
      expect(ADAPTER_CONFIGS).toHaveProperty("copilot");
    });

    it("cursor config uses .cursorrules", () => {
      expect(ADAPTER_CONFIGS["cursor"].rulesFile).toBe(".cursorrules");
      expect(ADAPTER_CONFIGS["cursor"].rulesFormat).toBe("cursorrules");
    });

    it("claude-code config uses AGENTS.md", () => {
      expect(ADAPTER_CONFIGS["claude-code"].rulesFile).toBe("AGENTS.md");
      expect(ADAPTER_CONFIGS["claude-code"].rulesFormat).toBe("agents-md");
    });
  });

  describe("listAdapterProviders", () => {
    it("returns array of provider names", () => {
      const providers = listAdapterProviders();
      expect(providers).toContain("cursor");
      expect(providers).toContain("codex");
      expect(providers).toContain("claude-code");
      expect(providers).toContain("cline");
    });
  });

  describe("getAdapterConfig", () => {
    it("returns config for known provider", () => {
      const config = getAdapterConfig("cursor");
      expect(config).toBeDefined();
      expect(config!.provider).toBe("cursor");
    });

    it("returns undefined for unknown provider", () => {
      expect(getAdapterConfig("nonexistent")).toBeUndefined();
    });
  });

  describe("buildAdapterInstruction", () => {
    it("produces instruction with correct files for cursor", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cursor", "resume");
      expect(instruction.provider).toBe("cursor");
      expect(instruction.event).toBe("resume");
      expect(instruction.files).toHaveProperty(".cursorrules");
      expect(instruction.files[".cursorrules"]).toContain("SyncPoint Resume Context");
      expect(instruction.ready).toBe(true);
      expect(instruction.promptText).toContain("Do NOT rely on prior conversation history");
    });

    it("produces instruction with correct files for claude-code", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "claude-code", "boot");
      expect(instruction.files).toHaveProperty("AGENTS.md");
      expect(instruction.files).toHaveProperty(".syncpoint/resume-prompt.md");
      expect(instruction.files["AGENTS.md"]).toContain("AGENTS.md");
      expect(instruction.event).toBe("boot");
    });

    it("produces instruction with correct files for codex", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "codex", "handoff");
      expect(instruction.files).toHaveProperty("AGENTS.md");
      expect(instruction.files).toHaveProperty(".syncpoint/resume-prompt.md");
      expect(instruction.event).toBe("handoff");
    });

    it("produces instruction with correct files for cline", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cline", "resume");
      expect(instruction.files).toHaveProperty(".syncpoint/resume-prompt.md");
      expect(instruction.files).toHaveProperty(".cursorrules");
    });

    it("falls back to cursor config for unknown provider", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "unknown-provider" as any, "resume");
      expect(instruction.files).toHaveProperty(".cursorrules");
    });

    it("passes through warnings when context not ready", () => {
      const ctx = makeCtx({
        ready: false,
        warnings: ["No snapshot found"],
      });
      const instruction = buildAdapterInstruction(ctx, "cursor", "resume");
      expect(instruction.ready).toBe(false);
      expect(instruction.warnings).toContain("No snapshot found");
    });

    it("summary includes event, provider, and file list", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cursor", "resume");
      expect(instruction.summary).toContain("[resume]");
      expect(instruction.summary).toContain("cursor");
      expect(instruction.summary).toContain(".cursorrules");
    });

    it("promptText includes preamble and system prompt", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cursor", "resume");
      expect(instruction.promptText).toContain("SyncPoint-managed project");
      expect(instruction.promptText).toContain("Build auth");
    });

    it("includes pinned memory in generated files", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cursor", "resume");
      expect(instruction.files[".cursorrules"]).toContain("code-style");
      expect(instruction.files[".cursorrules"]).toContain("TypeScript strict mode");
    });

    it("includes snapshot context in generated files", () => {
      const instruction = buildAdapterInstruction(makeCtx(), "cursor", "resume");
      expect(instruction.files[".cursorrules"]).toContain("Implement auth API");
      expect(instruction.files[".cursorrules"]).toContain("POST /login");
    });
  });
});
