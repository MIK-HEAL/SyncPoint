/**
 * P3B — Projection Integration tests.
 * Tests that loopResume uses ProjectedReality, injects into prompt/gate,
 * and enforces capsule-locked blocking on projection issues.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;
let agentId: string;
let taskId: string;

beforeAll(async () => {
  ctx = await startE2E();

  // Setup: agent + task + assign + checkpoint + capsule (minimum for resume)
  const agent = (await ctx.rpc("agent.create", { name: "codex", provider: "codex", role: "backend" })) as any;
  agentId = agent.id;
  const task = (await ctx.rpc("task.create", { title: "P3B test task", description: "test" })) as any;
  taskId = task.id;
  await ctx.rpc("task.assign", { taskId, agentId });
  await ctx.rpc("loop.checkpoint", {
    agentId,
    taskId,
    summary: "Initial checkpoint",
    goal: "Test P3B",
    phase: "testing",
  });
});

afterAll(async () => { await ctx.cleanup(); });

async function createAndApprove(fields: Record<string, unknown>) {
  const m = (await ctx.rpc("projectMemory.create", {
    createdBy: "test-user",
    ...fields,
  })) as any;
  await ctx.rpc("projectMemory.approve", { id: m.id, updatedBy: "test-user" });
  return m;
}

describe("P3B: Resume uses projection", () => {
  it("resume prompt contains Projected Reality section", async () => {
    await createAndApprove({
      category: "overview",
      title: "P3B TypeScript Fact",
      content: "Project uses TypeScript",
      kind: "fact",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toContain("Projected Reality");
    expect(result.prompt).toContain("Verified Facts");
    expect(result.prompt).toContain("P3B TypeScript Fact");
  });

  it("resume prompt contains compressed source refs [ref:...]", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toMatch(/\[ref:[a-zA-Z0-9_-]+\]/);
  });

  it("resume prompt does NOT contain raw '## Project Knowledge' section", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    // P3B boundary: raw project memories should NOT appear in prompt
    expect(result.prompt).not.toContain("## Project Knowledge");
  });
});

describe("P3B: Kind→bucket in prompt", () => {
  it("soft_convention appears as Active Constraints", async () => {
    await createAndApprove({
      category: "convention",
      title: "P3B camelCase",
      content: "Use camelCase naming",
      kind: "soft_convention",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toContain("Active Constraints");
    expect(result.prompt).toContain("P3B camelCase");
  });

  it("risk appears as Known Risks", async () => {
    await createAndApprove({
      category: "risk",
      title: "P3B mem leak",
      content: "Watch for memory leaks",
      kind: "risk",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toContain("Known Risks");
    expect(result.prompt).toContain("P3B mem leak");
  });

  it("do_not_touch appears as Do Not Touch", async () => {
    await createAndApprove({
      category: "gotcha",
      title: "P3B legacy db",
      content: "Do not modify db.ts",
      kind: "do_not_touch",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toContain("Do Not Touch");
    expect(result.prompt).toContain("P3B legacy db");
  });
});

describe("P3B: Protocol gate injection", () => {
  it("hard_constraint enters gate as Projected Reality Rules, NOT capsule", async () => {
    await createAndApprove({
      category: "decision",
      title: "P3B no eval",
      content: "eval() is banned",
      kind: "hard_constraint",
      projectionTarget: "protocol_gate",
      severity: "blocking",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;

    // hard_constraint should appear in Protocol Gate section (as [constraint:...])
    expect(result.prompt).toContain("Projected Reality Rules");
    expect(result.prompt).toContain("[constraint:");
    expect(result.prompt).toContain("P3B no eval");

    // hard_constraint should NOT appear inside capsulePatch buckets
    // (Verified Facts, Active Constraints, Known Risks, Do Not Touch)
    const verifiedFacts = result.prompt.split("### Verified Facts")[1]?.split("###")[0] || "";
    const activeConstraints = result.prompt.split("### Active Constraints")[1]?.split("###")[0] || "";
    const knownRisks = result.prompt.split("### Known Risks")[1]?.split("###")[0] || "";
    const doNotTouch = result.prompt.split("### Do Not Touch")[1]?.split("###")[0] || "";
    expect(verifiedFacts).not.toContain("P3B no eval");
    expect(activeConstraints).not.toContain("P3B no eval");
    expect(knownRisks).not.toContain("P3B no eval");
    expect(doNotTouch).not.toContain("P3B no eval");

    // Fix 2: hard_constraint is awareness (soft), NOT blocking by mere existence.
    // Only conflicts, invalid projection, or P4 violations cause blocking.
    expect(result.protocolGateBlocked).toBe(false);
  });

  it("protocol_rule enters gate notes", async () => {
    await createAndApprove({
      category: "decision",
      title: "P3B review gate",
      content: "All PRs need review",
      kind: "protocol_rule",
      projectionTarget: "protocol_gate",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).toContain("P3B review gate");
  });
});

describe("P3B: capsule-locked semantics", () => {
  it("capsule-locked does NOT block when only hard_constraints exist (P4 enforces)", async () => {
    // hard_constraint alone should NOT block — it's awareness only in P3B
    const result = (await ctx.rpc("loop.resume", { agentId, taskId, contextMode: "capsule-locked" })) as any;
    expect(result.ok).toBe(true);
    expect(result.prompt).toContain("[constraint:");
  });
});

describe("P3B: No raw Project Memory leak in any format", () => {
  it("default system-prompt format: no Project Knowledge", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    expect(result.prompt).not.toContain("## Project Knowledge");
    // Adapter files are generated (listed by name), verify they exist
    expect(result.filesWritten.length).toBeGreaterThan(0);
  });

  it("cursorrules format: no Project Knowledge", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId, format: "cursorrules" })) as any;
    expect(result.prompt).not.toContain("## Project Knowledge");
  });

  it("agents-md format: no Project Knowledge", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId, format: "agents-md" })) as any;
    expect(result.prompt).not.toContain("## Project Knowledge");
  });

  it("clipboard format: no Project Knowledge", async () => {
    const result = (await ctx.rpc("loop.resume", { agentId, taskId, format: "clipboard" })) as any;
    expect(result.prompt).not.toContain("## Project Knowledge");
  });
});

describe("P3B: Stale memories skipped in prompt", () => {
  it("stale memory appears in skipped section, not projected reality", async () => {
    const m = await createAndApprove({
      category: "decision",
      title: "P3B stale info",
      content: "This is outdated",
      kind: "fact",
    });
    await ctx.rpc("projectMemory.update", {
      id: m.id,
      updatedBy: "test-user",
      validityStatus: "stale",
      validityStaleReason: "outdated",
    });

    const result = (await ctx.rpc("loop.resume", { agentId, taskId })) as any;
    // Should NOT be in Verified Facts
    const verifiedSection = result.prompt.split("### Verified Facts")[1]?.split("###")[0] || "";
    expect(verifiedSection).not.toContain("P3B stale info");
    // Should appear in skipped section
    expect(result.prompt).toContain("Skipped");
    expect(result.prompt).toContain(m.id);
  });
});
