/**
 * E2E tests for Agent Adapter Protocol — tRPC routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E } from "../../src/tests/e2e-helper.js";
import type { E2EContext } from "../../src/tests/e2e-helper.js";

let e2e: E2EContext;
let taskId: string;
let agentId: string;
let checkpointId: string;

beforeAll(async () => {
  e2e = await startE2E();

  // Setup: agent + task + assign + checkpoint + contract + snapshot
  const agent = await e2e.rpc("agent.create", {
    name: "cursor",
    provider: "cursor",
    role: "frontend",
  }, "POST") as any;
  agentId = agent.id;

  const task = await e2e.rpc("task.create", {
    title: "Adapter test task",
    description: "Test adapter protocol",
  }, "POST") as any;
  taskId = task.id;

  await e2e.rpc("task.assign", { taskId, agentId }, "POST");

  const cp = await e2e.rpc("checkpoint.create", {
    taskId,
    agentId,
    summary: "Initial setup done",
    nextSteps: "Implement components",
  }, "POST") as any;
  checkpointId = cp.id;

  const contract = await e2e.rpc("contract.create", {
    taskId,
    title: "Frontend contract",
    scope: "UI components",
    responsibilities: ["Build React components"],
    interfaceSpec: ["ComponentProps interface"],
    resourceBoundaries: ["src/components/*"],
  }, "POST") as any;
  await e2e.rpc("contract.updateStatus", { id: contract.id, status: "REVIEWING" }, "POST");
  await e2e.rpc("contract.updateStatus", { id: contract.id, status: "APPROVED" }, "POST");

  await e2e.rpc("contextSnapshot.create", {
    taskId,
    agentId,
    checkpointId,
    summary: "Build React components",
    payload: {
      goal: "Build React components",
      currentPhase: "implementation",
      workingResources: ["src/components/Button.tsx"],
      remainingWork: "Finish Button styling",
      nextSteps: ["Add hover states"],
      resumePrompt: "Continue building Button component with hover states",
    },
  }, "POST");

  await e2e.rpc("pinnedMemory.create", {
    key: "ui-style",
    content: "Use Tailwind CSS for all styling",
    scope: "project",
  }, "POST");
});

afterAll(async () => {
  await e2e.cleanup();
});

describe("adapter.boot", () => {
  it("returns adapter instruction with correct files for cursor", async () => {
    const result = await e2e.rpc("adapter.boot", {
      taskId,
      agentId,
      provider: "cursor",
      event: "resume",
    }, "GET") as any;

    expect(result.provider).toBe("cursor");
    expect(result.event).toBe("resume");
    expect(result.ready).toBe(true);
    expect(result.files).toHaveProperty(".cursorrules");
    expect(result.files[".cursorrules"]).toContain("SyncPoint Resume Context");
    expect(result.files[".cursorrules"]).toContain("Build React components");
    expect(result.files[".cursorrules"]).toContain("ui-style");
    expect(result.files[".cursorrules"]).toContain("Tailwind CSS");
    expect(result.promptText).toContain("Do NOT rely on prior conversation history");
  });

  it("returns adapter instruction for claude-code with AGENTS.md", async () => {
    const result = await e2e.rpc("adapter.boot", {
      taskId,
      agentId,
      provider: "claude-code",
      event: "boot",
    }, "GET") as any;

    expect(result.provider).toBe("claude-code");
    expect(result.files).toHaveProperty("AGENTS.md");
    expect(result.files).toHaveProperty(".syncpoint/resume-prompt.md");
    expect(result.files["AGENTS.md"]).toContain("AGENTS.md");
    expect(result.files["AGENTS.md"]).toContain("Build React components");
  });

  it("defaults to agent provider when not specified", async () => {
    const result = await e2e.rpc("adapter.boot", {
      taskId,
      agentId,
    }, "GET") as any;

    // Agent name is "cursor", so it should use cursor config
    expect(result.provider).toBe("cursor");
    expect(result.files).toHaveProperty(".cursorrules");
  });

  it("includes contract info in generated files", async () => {
    const result = await e2e.rpc("adapter.boot", {
      taskId,
      agentId,
      provider: "cursor",
    }, "GET") as any;

    expect(result.files[".cursorrules"]).toContain("UI components");
    expect(result.files[".cursorrules"]).toContain("ComponentProps");
  });
});

describe("adapter.info", () => {
  it("returns config for known provider", async () => {
    const result = await e2e.rpc("adapter.info", { provider: "cursor" }, "GET") as any;
    expect(result.config).toBeDefined();
    expect(result.config.provider).toBe("cursor");
    expect(result.config.rulesFile).toBe(".cursorrules");
    expect(result.providers).toContain("cursor");
    expect(result.providers).toContain("claude-code");
  });

  it("returns null config for unknown provider", async () => {
    const result = await e2e.rpc("adapter.info", { provider: "unknown" }, "GET") as any;
    expect(result.config).toBeNull();
    expect(result.providers.length).toBeGreaterThan(0);
  });
});
