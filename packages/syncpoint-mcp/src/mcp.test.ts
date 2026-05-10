/**
 * Tests for SyncPoint MCP Server — resources, tools, prompts.
 * Uses in-process McpServer + Client to avoid stdio complexity.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { getDb, closeDb, initSyncpointDir } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import { pmAdd, pmApprove } from "syncpoint-server/application";
import { ResourceClaimMode } from "syncpoint-core";
import { createSyncPointMcpServer } from "./server.js";

import os from "node:os";
import fs from "node:fs";
import path from "node:path";

let client: Client;
let cleanup: () => void;
let tmpDir: string;
let previousProjectRoot: string | undefined;

beforeAll(async () => {
  // Isolated temp project
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mcp-test-"));
  previousProjectRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  process.env.SYNCPOINT_PROJECT_ROOT = tmpDir;
  process.env.SYNCPOINT_DB_DIR = path.join(tmpDir, ".syncpoint");
  fs.mkdirSync(process.env.SYNCPOINT_DB_DIR, { recursive: true });
  getDb();

  // Seed data
  repo.createAgent({ name: "cursor", provider: "cursor", role: "frontend" });
  repo.createTask({ title: "Build MCP", description: "Implement MCP server adapter" });

  const agents = repo.listAgents();
  const tasks = repo.listTasks();
  const agentId = agents[0].id;
  const taskId = tasks[0].id;

  repo.assignTask(taskId, agentId);
  const checkpoint = repo.createCheckpoint({
    taskId,
    agentId,
    summary: "Initial MCP checkpoint",
    progress: "10%",
    currentUnderstanding: "",
    changedFiles: "",
    risks: "",
    blockers: "",
    nextSteps: "Continue MCP implementation",
    needSync: false,
  });
  repo.createCapsule({
    taskId,
    agentId,
    checkpointId: checkpoint.id,
    summary: "Implement MCP server adapter",
    payloadJson: JSON.stringify({
      goal: "Implement MCP server adapter",
      currentPhase: "acceptance",
      confirmedDecisions: [],
      interfaceContract: "",
      workingResources: ["packages/syncpoint-mcp/src"],
      completedWork: "Resource scaffold",
      remainingWork: "Acceptance checks",
      risks: [],
      blockers: [],
      nextSteps: ["Run tests"],
      resumePrompt: "Continue MCP acceptance.",
    }),
  });

  // Seed project memory
  const mem = pmAdd({
    category: "architecture",
    title: "MCP Architecture",
    content: "SyncPoint uses stdio MCP server for local integrations.",
    scope: "project",
    tags: "mcp,architecture",
    sourceType: "human",
    sourceRef: "",
    confidence: "high",
    taskId: null,
    createdBy: "test",
  } as any);
  pmApprove(mem.id, "test");

  // Create MCP server + client via in-memory transport
  const server = createSyncPointMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  cleanup = () => {
    closeDb();
    delete process.env.SYNCPOINT_DB_DIR;
    if (previousProjectRoot === undefined) delete process.env.SYNCPOINT_PROJECT_ROOT;
    else process.env.SYNCPOINT_PROJECT_ROOT = previousProjectRoot;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
});

afterAll(() => {
  cleanup?.();
});

// ── Resources ────────────────────────────────────────

describe("resources", () => {
  it("should list available resources and templates", async () => {
    const { resources } = await client.listResources();
    // Static resources
    const uris = resources.map((r: any) => r.uri);
    expect(uris).toContain("syncpoint://status");
    expect(uris).toContain("syncpoint://agents");
    expect(uris).toContain("syncpoint://tasks");
    expect(uris).toContain("syncpoint://project-memory");
    expect(uris).toContain("syncpoint://context/policy");
    expect(resources.length).toBeGreaterThanOrEqual(5);

    // Resource templates (dynamic)
    const { resourceTemplates } = await client.listResourceTemplates();
    const templateUris = resourceTemplates.map((t: any) => t.uriTemplate);
    expect(templateUris).toContain("syncpoint://task/{taskId}");
    expect(templateUris).toContain("syncpoint://task/{taskId}/checkpoints");
    expect(templateUris).toContain("syncpoint://task/{taskId}/capsules");
    expect(templateUris).toContain("syncpoint://task/{taskId}/resume-context/{agentId}");
    expect(templateUris).toContain("syncpoint://project-memory/{category}");
    expect(templateUris).toContain("syncpoint://context/prepare/{intent}/{role}");
    expect(templateUris).toContain("syncpoint://session/{sessionId}");
    expect(templateUris).toContain("syncpoint://review/{reviewRequestId}/packet");
    expect(templateUris).toContain("syncpoint://active-session/{agentId}");
    expect(templateUris).toContain("syncpoint://session/{sessionId}/next-action/{agentId}");
    expect(resourceTemplates.length).toBeGreaterThanOrEqual(10);
  });

  it("should read syncpoint://status", async () => {
    const result = await client.readResource({ uri: "syncpoint://status" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("# SyncPoint Status");
    expect(text).toContain("cursor");
    expect(text).toContain("Build MCP");
  });

  it("should read syncpoint://agents", async () => {
    const result = await client.readResource({ uri: "syncpoint://agents" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("# Agents");
    expect(text).toContain("cursor");
  });

  it("should read syncpoint://tasks", async () => {
    const result = await client.readResource({ uri: "syncpoint://tasks" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("# Tasks");
    expect(text).toContain("Build MCP");
  });

  it("should read syncpoint://project-memory", async () => {
    const result = await client.readResource({ uri: "syncpoint://project-memory" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("MCP Architecture");
    expect(text).toContain("stdio MCP server");
  });

  it("should read syncpoint://project-memory/architecture", async () => {
    const result = await client.readResource({ uri: "syncpoint://project-memory/architecture" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("MCP Architecture");
  });

  it("should read task detail resource", async () => {
    const tasks = repo.listTasks();
    const result = await client.readResource({ uri: `syncpoint://task/${tasks[0].id}` });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("Build MCP");
  });

  it("should read syncpoint://context/policy", async () => {
    const result = await client.readResource({ uri: "syncpoint://context/policy" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("# Context Policies");
    expect(text).toContain("execute");
    expect(text).toContain("HARD");
    expect(text).toContain("SOFT");
    expect(text).toContain("NONE");
  });

  it("should read syncpoint://context/prepare/{intent}/{role}", async () => {
    const result = await client.readResource({ uri: "syncpoint://context/prepare/architect-plan/architect" });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("Architect Planning Context");
  });

  it("should read task capsules resource", async () => {
    const tasks = repo.listTasks();
    const result = await client.readResource({ uri: `syncpoint://task/${tasks[0].id}/capsules` });
    const text = (result.contents[0] as any).text;
    expect(text).toContain("# Context Capsules");
    expect(text).toContain("Implement MCP server adapter");
    expect(text).toContain("packages/syncpoint-mcp/src");
  });
});

// ── Tools ────────────────────────────────────────

describe("tools", () => {
  it("should list available tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("syncpoint_loop_status");
    expect(names).toContain("syncpoint_loop_resume");
    expect(names).toContain("syncpoint_loop_checkpoint");
    expect(names).toContain("syncpoint_loop_handoff");
    expect(names).toContain("syncpoint_resume_context_get");
    expect(names).toContain("syncpoint_project_memory_search");
    expect(names).toContain("syncpoint_project_memory_add");
    expect(names).toContain("syncpoint_project_memory_approve");
    expect(names).toContain("syncpoint_project_memory_export");
    expect(names).toContain("syncpoint_context_prepare");
    expect(names).toContain("syncpoint_context_policy_info");
    expect(names).toContain("syncpoint_architect_onboarding");
    expect(names).toContain("syncpoint_reviewer_context");
    expect(names).toContain("syncpoint_next_action");
    expect(names).toContain("syncpoint_capture_evidence");
    expect(names).toContain("syncpoint_active_session");
    expect(names).toContain("syncpoint_sync_status");
    expect(names).toContain("syncpoint_sync_vote");
    expect(names).toContain("syncpoint_write_check");
    expect(names).toContain("syncpoint_write_prepare");
    expect(names).toContain("syncpoint_write_apply");
    expect(names).toContain("syncpoint_guard_status");
    expect(names).toContain("syncpoint_guard_session_create");
    expect(names).toContain("syncpoint_guard_reconcile");
    expect(tools.length).toBeGreaterThanOrEqual(36);
  });

  it("syncpoint_loop_status should return agent info", async () => {
    const agents = repo.listAgents();
    const result: any = await client.callTool({
      name: "syncpoint_loop_status",
      arguments: { agentId: agents[0].id },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    expect(data.agentName).toBe("cursor");
  });

  it("syncpoint_project_memory_search should find approved memories", async () => {
    const result: any = await client.callTool({
      name: "syncpoint_project_memory_search",
      arguments: { query: "MCP" },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(data.results[0].title).toContain("MCP");
  });

  it("syncpoint_project_memory_add should create draft memory", async () => {
    const result: any = await client.callTool({
      name: "syncpoint_project_memory_add",
      arguments: {
        category: "decision",
        title: "Use stdio transport",
        content: "First MCP version uses stdio only.",
        createdBy: "test-user",
      },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    expect(data.status).toBe("draft");
    expect(data.nextSuggestedAction).toContain("syncpoint_project_memory_approve");
  });

  it("syncpoint_project_memory_add should respect project-local path guard", async () => {
    const previousCwd = process.cwd();
    const previousDbDir = process.env.SYNCPOINT_DB_DIR;
    const noProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-mcp-no-project-"));
    try {
      delete process.env.SYNCPOINT_DB_DIR;
      process.chdir(noProjectDir);

      const result: any = await client.callTool({
        name: "syncpoint_project_memory_add",
        arguments: {
          category: "decision",
          title: "Should be rejected",
          content: "This should not write to fallback storage.",
          createdBy: "test-user",
        },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("No project-local .syncpoint/");
    } finally {
      process.chdir(previousCwd);
      if (previousDbDir) process.env.SYNCPOINT_DB_DIR = previousDbDir;
      fs.rmSync(noProjectDir, { recursive: true, force: true });
    }
  });

  it("syncpoint_project_memory_approve should change status", async () => {
    const addResult: any = await client.callTool({
      name: "syncpoint_project_memory_add",
      arguments: {
        category: "convention",
        title: "Test convention",
        content: "Test content for approval.",
        createdBy: "test-user",
      },
    });
    const addData = JSON.parse(addResult.content[0].text);

    const approveResult: any = await client.callTool({
      name: "syncpoint_project_memory_approve",
      arguments: { id: addData.id, updatedBy: "test" },
    });
    const approveData = JSON.parse(approveResult.content[0].text);
    expect(approveData.ok).toBe(true);
    expect(approveData.status).toBe("approved");
  });

  it("syncpoint_project_memory_export should write file", async () => {
    const exportPath = path.join(tmpDir, "export-test.md");
    const result: any = await client.callTool({
      name: "syncpoint_project_memory_export",
      arguments: { outputPath: exportPath, callerBy: "test" },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(exportPath)).toBe(true);
    const content = fs.readFileSync(exportPath, "utf-8");
    expect(content).toContain("MCP Architecture");
  });

  it("syncpoint_write_prepare + syncpoint_write_apply should write through a permit", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const locator = "mcp-write.txt";
    fs.writeFileSync(path.join(tmpDir, locator), "old");
    repo.createResourceClaim({
      actorId: agents[0].id,
      taskId: tasks[0].id,
      resources: [{ type: "file", locator, metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    const prepareResult: any = await client.callTool({
      name: "syncpoint_write_prepare",
      arguments: {
        actorId: agents[0].id,
        taskId: tasks[0].id,
        locators: [locator],
        intent: "modify",
      },
    });
    const prepared = JSON.parse(prepareResult.content[0].text);
    expect(prepared.decision.permitted).toBe(true);
    expect(prepared.permit.status).toBe("issued");

    const applyResult: any = await client.callTool({
      name: "syncpoint_write_apply",
      arguments: {
        permitId: prepared.permit.id,
        mutations: [{ locator, content: "new" }],
      },
    });
    const applied = JSON.parse(applyResult.content[0].text);
    expect(applied.permit.status).toBe("consumed");
    expect(fs.readFileSync(path.join(tmpDir, locator), "utf8")).toBe("new");
  });

  it("syncpoint_guard_status + syncpoint_guard_session_create should expose guard session state", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const createResult: any = await client.callTool({
      name: "syncpoint_guard_session_create",
      arguments: {
        actorId: agents[0].id,
        taskId: tasks[0].id,
        mode: "strict",
        adapter: "manual",
      },
    });
    const created = JSON.parse(createResult.content[0].text);
    expect(created.token).toMatch(/^spg_/);
    expect(created.actorId).toBe(agents[0].id);

    const statusResult: any = await client.callTool({
      name: "syncpoint_guard_status",
      arguments: {},
    });
    const status = JSON.parse(statusResult.content[0].text);
    expect(status.proxyAvailable).toBe(false);
    expect(status.activeSessions.some((session: any) => session.id === created.id)).toBe(true);
    expect(status.activeSessions[0].token).toBeUndefined();
  });

  it("syncpoint_guard_reconcile should scan claimed files and detect no bypass", async () => {
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_guard_reconcile",
      arguments: { taskId: tasks[0].id },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.scannedFiles).toBeGreaterThanOrEqual(0);
    expect(data.bypassesDetected).toBe(0);
    expect(data.gatesCreated).toEqual([]);
  });

  it("syncpoint_resume_context_get should return context", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_resume_context_get",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.task).toBeDefined();
    expect(data.agent).toBeDefined();
    expect(data.resumePrompt).toContain("Build MCP");
  });

  it("syncpoint_context_prepare should return PreparedContext", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_context_prepare",
      arguments: { intent: "execute", role: "executor", taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.intent).toBe("execute");
    expect(data.role).toBe("executor");
    expect(data.gateMode).toBe("hard");
    expect(data.ready).toBe(true);
    expect(data.prompt).toContain("Build MCP");
    // P3B: execute intent — full JSON must NOT contain raw Project Knowledge
    expect(data.prompt).not.toContain("## Project Knowledge");
    expect(data.projectMemories).toEqual([]);
    expect(data.resumeContext?.projectMemories ?? []).toEqual([]);
    expect(data.resumeContext?.resumePrompt ?? "").toBe("");
    expect(text).not.toContain("## Project Knowledge");
  });

  it("syncpoint_context_policy_info should list intents and roles", async () => {
    const result: any = await client.callTool({
      name: "syncpoint_context_policy_info",
      arguments: {},
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.intents).toContain("execute");
    expect(data.intents).toContain("review");
    expect(data.roles).toContain("architect");
    expect(data.policies.length).toBe(7);
  });

  it("syncpoint_architect_onboarding should return architect context", async () => {
    const result: any = await client.callTool({
      name: "syncpoint_architect_onboarding",
      arguments: {},
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.intent).toBe("architect-plan");
    expect(data.role).toBe("architect");
    expect(data.prompt).toContain("Architect Planning Context");
  });

  it("syncpoint_reviewer_context should return review context", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_reviewer_context",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.intent).toBe("review");
    expect(data.role).toBe("reviewer");
    expect(data.prompt).toContain("Review Context");
    expect(data.prompt).toContain("Review Checklist");
  });

  it("syncpoint_loop_checkpoint should create checkpoint+capsule", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_loop_checkpoint",
      arguments: {
        agentId: agents[0].id,
        taskId: tasks[0].id,
        summary: "MCP server scaffold complete",
        progress: "60%",
        nextSteps: "Add tests",
      },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    expect(data.checkpointId).toBeDefined();
    expect(data.capsuleId).toBeDefined();
  });

  it("syncpoint_session_create should create session", async () => {
    const agents = repo.listAgents();
    const result: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "MCP Test Session", description: "Test", architectId: agents[0].id },
    });
    const text = result.content[0].text;
    const data = JSON.parse(text);
    expect(data.ok).toBe(true);
    expect(data.session.title).toBe("MCP Test Session");
    expect(data.session.status).toBe("PLANNING");
    expect(data.architectRole).toBeDefined();
    expect(data.architectRole.role).toBe("architect");
  });

  it("syncpoint_session_status should return session overview", async () => {
    const agents = repo.listAgents();
    // Create fresh session
    const createResult: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Status Test", architectId: agents[0].id },
    });
    const sessionId = JSON.parse(createResult.content[0].text).session.id;
    const result: any = await client.callTool({
      name: "syncpoint_session_status",
      arguments: { sessionId },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.session.title).toBe("Status Test");
    expect(data.roles.length).toBe(1);
  });

  it("syncpoint_session_assign_role should assign role", async () => {
    const agents = repo.listAgents();
    const createResult: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Role Test" },
    });
    const sessionId = JSON.parse(createResult.content[0].text).session.id;
    const result: any = await client.callTool({
      name: "syncpoint_session_assign_role",
      arguments: { sessionId, agentId: agents[0].id, role: "executor" },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.role).toBe("executor");
  });

  it("syncpoint_session_plan_task should create task assignment", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const createResult: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Plan Test" },
    });
    const sessionId = JSON.parse(createResult.content[0].text).session.id;
    const result: any = await client.callTool({
      name: "syncpoint_session_plan_task",
      arguments: { sessionId, taskId: tasks[0].id, assigneeAgentId: agents[0].id, notes: "MCP task" },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe("PROPOSED");
    expect(data.notes).toBe("MCP task");
  });

  it("syncpoint_session_advance should transition session", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const createResult: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Advance Test" },
    });
    const sessionId = JSON.parse(createResult.content[0].text).session.id;
    // Plan a task to trigger PLANNING → EXECUTING
    await client.callTool({
      name: "syncpoint_session_plan_task",
      arguments: { sessionId, taskId: tasks[0].id, assigneeAgentId: agents[0].id },
    });
    const result: any = await client.callTool({
      name: "syncpoint_session_advance",
      arguments: { sessionId },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.transitioned).toBe(true);
    expect(data.session.status).toBe("EXECUTING");
  });

  it("review workflow tools — checklist + evidence + gate + approve", async () => {
    const agents = repo.listAgents();
    const rwTask = repo.createTask({ title: "RW gate task", description: "" });

    // Create session + plan + complete task + request review
    const sessRes: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "RW Tool Test" },
    });
    const sid = JSON.parse(sessRes.content[0].text).session.id;
    await client.callTool({ name: "syncpoint_session_plan_task", arguments: { sessionId: sid, taskId: rwTask.id, assigneeAgentId: agents[0].id } });
    const rrRes: any = await client.callTool({
      name: "syncpoint_session_request_review",
      arguments: { sessionId: sid, taskId: rwTask.id, reviewerAgentId: agents[0].id },
    });
    const rrId = JSON.parse(rrRes.content[0].text).id;

    // Add checklist
    const clRes: any = await client.callTool({
      name: "syncpoint_review_checklist_add",
      arguments: { reviewRequestId: rrId, title: "Build OK", required: true },
    });
    const clData = JSON.parse(clRes.content[0].text);
    expect(clData.status).toBe("OPEN");

    // Pass checklist item
    const passRes: any = await client.callTool({
      name: "syncpoint_review_checklist_update",
      arguments: { itemId: clData.id, status: "PASSED", notes: "All good" },
    });
    expect(JSON.parse(passRes.content[0].text).status).toBe("PASSED");

    // Add evidence
    const evRes: any = await client.callTool({
      name: "syncpoint_review_evidence_add",
      arguments: { reviewRequestId: rrId, kind: "build", title: "pnpm build", content: "6 packages" },
    });
    expect(JSON.parse(evRes.content[0].text).kind).toBe("build");

    // Gate should be PASSED
    const gateRes: any = await client.callTool({
      name: "syncpoint_review_gate",
      arguments: { reviewRequestId: rrId },
    });
    expect(JSON.parse(gateRes.content[0].text).status).toBe("PASSED");

    // Approve
    const appRes: any = await client.callTool({
      name: "syncpoint_review_approve",
      arguments: { reviewRequestId: rrId, summary: "LGTM" },
    });
    expect(JSON.parse(appRes.content[0].text).approvalRecord.decision).toBe("approved");
  });

  it("review workflow tools — block + changes + address", async () => {
    const agents = repo.listAgents();
    const blockTask = repo.createTask({ title: "Block test task", description: "" });

    const sessRes: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Block Test" },
    });
    const sid = JSON.parse(sessRes.content[0].text).session.id;
    await client.callTool({ name: "syncpoint_session_plan_task", arguments: { sessionId: sid, taskId: blockTask.id, assigneeAgentId: agents[0].id } });
    const rrRes: any = await client.callTool({
      name: "syncpoint_session_request_review",
      arguments: { sessionId: sid, taskId: blockTask.id, reviewerAgentId: agents[0].id },
    });
    const rrId = JSON.parse(rrRes.content[0].text).id;

    // Block
    const blockRes: any = await client.callTool({
      name: "syncpoint_review_block",
      arguments: { reviewRequestId: rrId, summary: "Missing tests", requestedChanges: "Add tests" },
    });
    const blockData = JSON.parse(blockRes.content[0].text);
    expect(blockData.approvalRecord.decision).toBe("blocked");
    expect(blockData.changeRequest.summary).toContain("Add tests");

    // Address change
    const addrRes: any = await client.callTool({
      name: "syncpoint_review_changes_address",
      arguments: { changeRequestId: blockData.changeRequest.id },
    });
    expect(JSON.parse(addrRes.content[0].text).status).toBe("ADDRESSED");

    // Review packet
    const packetRes: any = await client.callTool({
      name: "syncpoint_review_packet",
      arguments: { reviewRequestId: rrId },
    });
    const pkt = JSON.parse(packetRes.content[0].text);
    expect(pkt.gate).toBeDefined();
    expect(pkt.approvalRecords.length).toBe(1);
  });
});

// ── Playbook Tools ──────────────────────────────────

describe("playbook tools", () => {
  it("syncpoint_next_action should return actions for architect", async () => {
    const agents = repo.listAgents();
    const sessRes: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Next Action Test", architectId: agents[0].id },
    });
    const sid = JSON.parse(sessRes.content[0].text).session.id;
    const result: any = await client.callTool({
      name: "syncpoint_next_action",
      arguments: { sessionId: sid, agentId: agents[0].id },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.sessionId).toBe(sid);
    expect(data.actions.length).toBeGreaterThan(0);
    expect(data.actions[0].action).toBe("plan-tasks");
  });

  it("syncpoint_capture_evidence should record test output", async () => {
    // Create session + task + review for evidence
    const agents = repo.listAgents();
    const evTask = repo.createTask({ title: "Evidence capture task", description: "" });
    const sessRes: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Capture Test" },
    });
    const sid = JSON.parse(sessRes.content[0].text).session.id;
    await client.callTool({ name: "syncpoint_session_plan_task", arguments: { sessionId: sid, taskId: evTask.id, assigneeAgentId: agents[0].id } });
    const rrRes: any = await client.callTool({
      name: "syncpoint_session_request_review",
      arguments: { sessionId: sid, taskId: evTask.id, reviewerAgentId: agents[0].id },
    });
    const rrId = JSON.parse(rrRes.content[0].text).id;

    const result: any = await client.callTool({
      name: "syncpoint_capture_evidence",
      arguments: { reviewRequestId: rrId, command: "pnpm test", output: "162 tests passed", exitCode: 0 },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.kind).toBe("test");
    expect(data.evidence.content).toContain("162 tests");
  });

  it("syncpoint_active_session should return null for unassigned agent", async () => {
    const lonely = repo.createAgent({ name: "lonely-mcp", provider: "cursor", role: "other" });
    const result: any = await client.callTool({
      name: "syncpoint_active_session",
      arguments: { agentId: lonely.id },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.active).toBe(false);
  });

  it("syncpoint_active_session should return session for active agent", async () => {
    const agents = repo.listAgents();
    const result: any = await client.callTool({
      name: "syncpoint_active_session",
      arguments: { agentId: agents[0].id },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.sessionId).toBeDefined();
    expect(data.actions.length).toBeGreaterThan(0);
  });
});

// ── Prompts ────────────────────────────────────────

describe("prompts", () => {
  it("should list available prompts", async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p: any) => p.name);
    expect(names).toContain("syncpoint_resume");
    expect(names).toContain("syncpoint_checkpoint");
    expect(names).toContain("syncpoint_handoff");
    expect(names).toContain("syncpoint_project_onboarding");
    expect(names).toContain("syncpoint_memory_review");
    expect(names).toContain("syncpoint_executor_resume");
    expect(names).toContain("syncpoint_reviewer_checklist");
    expect(names).toContain("syncpoint_architect_briefing");
    expect(names).toContain("syncpoint_user_memory_review");
    expect(names).toContain("syncpoint_architect_plan");
    expect(names).toContain("syncpoint_review_task");
    expect(names).toContain("syncpoint_review_with_evidence");
    expect(names).toContain("syncpoint_session_playbook");
    expect(prompts.length).toBeGreaterThanOrEqual(13);
  });

  it("syncpoint_resume should contain task info", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result = await client.getPrompt({
      name: "syncpoint_resume",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Build MCP");
  });

  it("syncpoint_checkpoint should contain guide fields", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result = await client.getPrompt({
      name: "syncpoint_checkpoint",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("summary");
    expect(text).toContain("nextSteps");
    expect(text).toContain("syncpoint_loop_checkpoint");
  });

  it("syncpoint_project_onboarding should contain project memory", async () => {
    const result = await client.getPrompt({
      name: "syncpoint_project_onboarding",
      arguments: {},
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Project Onboarding");
    expect(text).toContain("MCP Architecture");
  });

  it("syncpoint_memory_review should list all statuses", async () => {
    const result = await client.getPrompt({
      name: "syncpoint_memory_review",
      arguments: {},
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Draft");
    expect(text).toContain("Approved");
    expect(text).toContain("Deprecated");
  });

  it("syncpoint_executor_resume should return resume prompt", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result = await client.getPrompt({
      name: "syncpoint_executor_resume",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Build MCP");
    // P3B: must NOT contain raw Project Knowledge
    expect(text).not.toContain("## Project Knowledge");
  });

  it("syncpoint_reviewer_checklist should contain review checklist", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result = await client.getPrompt({
      name: "syncpoint_reviewer_checklist",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Review Context");
    expect(text).toContain("Review Checklist");
  });

  it("syncpoint_architect_briefing should contain project memory", async () => {
    const result = await client.getPrompt({
      name: "syncpoint_architect_briefing",
      arguments: {},
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Architect Planning Context");
    expect(text).toContain("MCP Architecture");
  });

  it("syncpoint_user_memory_review should list all statuses", async () => {
    const result = await client.getPrompt({
      name: "syncpoint_user_memory_review",
      arguments: {},
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Project Memory Review");
    expect(text).toContain("Draft");
    expect(text).toContain("Approved");
  });

  it("syncpoint_architect_plan should include session context", async () => {
    // Create session for prompt test
    const agents = repo.listAgents();
    const sessResult: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Prompt Test Session", architectId: agents[0].id },
    });
    const sessData = JSON.parse(sessResult.content[0].text);
    const result = await client.getPrompt({
      name: "syncpoint_architect_plan",
      arguments: { sessionId: sessData.session.id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Architect Planning Context");
    expect(text).toContain("Prompt Test Session");
  });

  it("syncpoint_review_task should return review context", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result = await client.getPrompt({
      name: "syncpoint_review_task",
      arguments: { taskId: tasks[0].id, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Review Context");
  });

  it("syncpoint_review_with_evidence should show review packet", async () => {
    // First create a full review setup via tools
    const agents = repo.listAgents();
    const createSess: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Evidence Prompt Test", architectId: agents[0].id },
    });
    const sid = JSON.parse(createSess.content[0].text).session.id;
    const tasks = repo.listTasks();

    // Assign executor role + plan task
    await client.callTool({ name: "syncpoint_session_assign_role", arguments: { sessionId: sid, agentId: agents[0].id, role: "executor" } });
    const planRes: any = await client.callTool({ name: "syncpoint_session_plan_task", arguments: { sessionId: sid, taskId: tasks[0].id, assigneeAgentId: agents[0].id } });

    // Request review
    const rrRes: any = await client.callTool({ name: "syncpoint_session_request_review", arguments: { sessionId: sid, taskId: tasks[0].id, reviewerAgentId: agents[0].id } });
    const rrId = JSON.parse(rrRes.content[0].text).id;

    // Add checklist + evidence
    await client.callTool({ name: "syncpoint_review_checklist_add", arguments: { reviewRequestId: rrId, title: "Tests pass" } });
    await client.callTool({ name: "syncpoint_review_evidence_add", arguments: { reviewRequestId: rrId, kind: "test", title: "pnpm test", content: "All pass" } });

    const result = await client.getPrompt({ name: "syncpoint_review_with_evidence", arguments: { reviewRequestId: rrId } });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Review with Evidence");
    expect(text).toContain("Checklist");
    expect(text).toContain("Evidence");
    expect(text).toContain("Tests pass");
  });

  it("syncpoint_session_playbook should contain role guidance and actions", async () => {
    const agents = repo.listAgents();
    const sessCreate: any = await client.callTool({
      name: "syncpoint_session_create",
      arguments: { title: "Playbook Prompt Test", architectId: agents[0].id },
    });
    const sid = JSON.parse(sessCreate.content[0].text).session.id;
    const result = await client.getPrompt({
      name: "syncpoint_session_playbook",
      arguments: { sessionId: sid, agentId: agents[0].id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("Session Playbook");
    expect(text).toContain("Playbook Prompt Test");
    expect(text).toContain("Architect");
    expect(text).toContain("Recommended Next Actions");
  });

  it("syncpoint_handoff should reference agents", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    // Need a second agent
    repo.createAgent({ name: "claude-code", provider: "claude-code", role: "backend" });
    const agents2 = repo.listAgents();
    const to = agents2.find(a => a.name === "claude-code")!;

    const result = await client.getPrompt({
      name: "syncpoint_handoff",
      arguments: { taskId: tasks[0].id, fromAgentId: agents[0].id, toAgentId: to.id },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("handing off");
    expect(text).toContain(to.id);
  });
});

// ── SyncGate MCP tools smoke ────────────────────────

describe("sync gate MCP tools", () => {
  let gateId: string;

  it("syncpoint_sync_request creates a gate", async () => {
    const agents = repo.listAgents();
    const tasks = repo.listTasks();
    const result: any = await client.callTool({
      name: "syncpoint_sync_request",
      arguments: {
        taskId: tasks[0].id,
        requestedByAgentId: agents[0].id,
        requiredAgentIds: agents.map(a => a.id),
        reason: "manual_request",
        description: "MCP smoke test gate",
      },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.gate).toBeDefined();
    expect(data.gate.status).toBe("SYNC_REQUESTED");
    gateId = data.gate.id;
  });

  it("syncpoint_sync_status returns detailed status with policy and votes", async () => {
    const agents = repo.listAgents();
    const result: any = await client.callTool({
      name: "syncpoint_sync_status",
      arguments: { gateId, agentId: agents[0].id },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.gate).toBeDefined();
    expect(data.policy).toBeDefined();
    expect(data.pendingAgentIds).toBeDefined();
    expect(data.eligibleVoterIds).toBeDefined();
    expect(data.voteCounts).toBeDefined();
    expect(data.availableActions).toBeDefined();
    expect(data.isBlocking).toBe(true);
  });

  it("syncpoint_sync_vote casts a vote and returns status", async () => {
    const agents = repo.listAgents();
    // agents[0] is both owner and required — eligible to vote
    const result: any = await client.callTool({
      name: "syncpoint_sync_vote",
      arguments: { gateId, agentId: agents[0].id, vote: "approve", summary: "looks good" },
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.message).toContain("Vote 'approve' cast");
    expect(data.gate).toBeDefined();
  });
});
