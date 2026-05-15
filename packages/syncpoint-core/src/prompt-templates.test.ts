/**
 * Tests for Prompt Template Engine — formatResumePrompt in all formats.
 */
import { describe, it, expect } from "vitest";
import { formatResumePrompt } from "./prompt-templates.ts";
import { QualityCheckStatus } from "./memory.ts";
import type { ResumeContext, PromptFormat } from "./index.ts";

function makeContext(overrides?: Partial<ResumeContext>): ResumeContext {
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
      { key: "auth-rule", content: "Always use JWT" },
    ],
    projectMemories: [],
    resumePrompt: "raw resume prompt",
    warnings: [],
    contextMode: "snapshot-first",
    generatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("formatResumePrompt", () => {
  const formats: PromptFormat[] = [
    "system-prompt",
    "cursorrules",
    "agents-md",
    "checkpoint-md",
    "clipboard",
  ];

  for (const format of formats) {
    it(`format '${format}' produces non-empty output`, () => {
      const ctx = makeContext();
      const result = formatResumePrompt(ctx, format);
      expect(result.length).toBeGreaterThan(0);
    });
  }

  it("system-prompt includes mandatory rules and task info", () => {
    const text = formatResumePrompt(makeContext(), "system-prompt");
    expect(text).toContain("Mandatory Rules");
    expect(text).toContain("code-style");
    expect(text).toContain("auth-rule");
    expect(text).toContain("Build auth");
    expect(text).toContain("codex");
    expect(text).toContain("POST /login");
    expect(text).toContain("Implement auth API");
    expect(text).toContain("Continue implementing POST /login");
    expect(text).toContain("Do NOT rely on prior conversation history");
  });

  it("cursorrules includes header and contract", () => {
    const text = formatResumePrompt(makeContext(), "cursorrules");
    expect(text).toContain("SyncPoint Resume Context");
    expect(text).toContain("Auto-generated");
    expect(text).toContain("auth module");
    expect(text).toContain("POST /login");
    expect(text).toContain("Do NOT carry over previous conversation");
  });

  it("agents-md produces markdown table", () => {
    const text = formatResumePrompt(makeContext(), "agents-md");
    expect(text).toContain("AGENTS.md");
    expect(text).toContain("| Task | Build auth |");
    expect(text).toContain("**Goal**: Implement auth API");
    expect(text).toContain("Project Rules");
  });

  it("checkpoint-md builds from structured fields (P3B: no raw resumePrompt)", () => {
    const ctx = makeContext();
    const text = formatResumePrompt(ctx, "checkpoint-md");
    // P3B: checkpoint-md no longer returns ctx.resumePrompt (contains baked-in raw PM)
    expect(text).toContain("# Checkpoint");
    expect(text).toContain(ctx.task.title);
    expect(text).toContain("Goal");
    expect(text).toContain("Phase");
    // Should NOT contain raw Project Knowledge
    expect(text).not.toContain("## Project Knowledge");
  });

  it("clipboard is compact", () => {
    const text = formatResumePrompt(makeContext(), "clipboard");
    expect(text).toContain("[SyncPoint Resume]");
    expect(text).toContain("Build auth");
    expect(text).toContain("Implement auth API");
  });

  it("system-prompt warns when no snapshot/checkpoint", () => {
    const ctx = makeContext({
      latestSnapshot: null,
      latestCheckpoint: null,
      ready: false,
      warnings: ["No snapshot available"],
    });
    const text = formatResumePrompt(ctx, "system-prompt");
    expect(text).toContain("No snapshot or checkpoint");
    expect(text).toContain("Warnings");
    expect(text).toContain("No snapshot available");
  });

  it("clipboard warns when not ready", () => {
    const ctx = makeContext({
      latestSnapshot: null,
      latestCheckpoint: null,
      ready: false,
      warnings: ["Missing snapshot"],
    });
    const text = formatResumePrompt(ctx, "clipboard");
    expect(text).toContain("⚠");
    expect(text).toContain("Missing snapshot");
  });

  it("system-prompt omits contract section when no contract", () => {
    const ctx = makeContext({ approvedContract: null });
    const text = formatResumePrompt(ctx, "system-prompt");
    expect(text).not.toContain("Peer Contract");
  });

  it("defaults to system-prompt format", () => {
    const ctx = makeContext();
    const defaultText = formatResumePrompt(ctx);
    const explicitText = formatResumePrompt(ctx, "system-prompt");
    expect(defaultText).toBe(explicitText);
  });
});
