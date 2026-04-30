/**
 * P12 Protocol Gate & Capsule Validation — integration tests.
 * Uses in-memory DB to test assembleProtocolGate, validateCapsule,
 * and loopResume with context modes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema";
import { TaskStatus, ContractStatus } from "syncpoint-core";

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS agent (id TEXT PRIMARY KEY, name TEXT NOT NULL, provider TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'IDLE', current_task_id TEXT, runtime_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS task (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', owner_agent_id TEXT REFERENCES agent(id), parent_task_id TEXT REFERENCES task(id), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS checkpoint (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task(id), agent_id TEXT NOT NULL REFERENCES agent(id), summary TEXT NOT NULL, progress TEXT NOT NULL DEFAULT '', current_understanding TEXT NOT NULL DEFAULT '', changed_files TEXT NOT NULL DEFAULT '', risks TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', next_steps TEXT NOT NULL DEFAULT '', need_sync INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS diary_entry (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agent(id), task_id TEXT NOT NULL REFERENCES task(id), entry_type TEXT NOT NULL DEFAULT 'NOTE', content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS handoff (id TEXT PRIMARY KEY, from_agent_id TEXT NOT NULL REFERENCES agent(id), to_agent_id TEXT NOT NULL REFERENCES agent(id), task_id TEXT NOT NULL REFERENCES task(id), context_summary TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS peer_contract (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task(id), title TEXT NOT NULL DEFAULT '', participants TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', responsibilities TEXT NOT NULL DEFAULT '', interface_spec TEXT NOT NULL DEFAULT '', file_boundaries TEXT NOT NULL DEFAULT '', dependencies TEXT NOT NULL DEFAULT '', test_plan TEXT NOT NULL DEFAULT '', risks TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS context_capsule (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task(id), agent_id TEXT NOT NULL REFERENCES agent(id), checkpoint_id TEXT NOT NULL REFERENCES checkpoint(id), goal TEXT NOT NULL DEFAULT '', current_phase TEXT NOT NULL DEFAULT '', confirmed_decisions TEXT NOT NULL DEFAULT '', interface_contract TEXT NOT NULL DEFAULT '', working_files TEXT NOT NULL DEFAULT '', completed_work TEXT NOT NULL DEFAULT '', remaining_work TEXT NOT NULL DEFAULT '', risks TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '', next_steps TEXT NOT NULL DEFAULT '', resume_prompt TEXT NOT NULL DEFAULT '', intent_scope TEXT NOT NULL DEFAULT '', non_goals TEXT NOT NULL DEFAULT '', verified_facts TEXT NOT NULL DEFAULT '', unverified_claims TEXT NOT NULL DEFAULT '', evidence_refs TEXT NOT NULL DEFAULT '', active_constraints TEXT NOT NULL DEFAULT '', do_not_touch TEXT NOT NULL DEFAULT '', handoff_instructions TEXT NOT NULL DEFAULT '', validation_status TEXT NOT NULL DEFAULT '', stale_reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS event (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS orchestration_session (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PLANNING', architect_id TEXT, created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS role_profile (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES orchestration_session(id), agent_id TEXT NOT NULL REFERENCES agent(id), role TEXT NOT NULL, capabilities TEXT NOT NULL DEFAULT '', assigned_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS task_assignment (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES orchestration_session(id), task_id TEXT NOT NULL REFERENCES task(id), assignee_agent_id TEXT NOT NULL REFERENCES agent(id), assigned_by TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PROPOSED', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS review_request (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES orchestration_session(id), task_id TEXT NOT NULL REFERENCES task(id), reviewer_agent_id TEXT NOT NULL REFERENCES agent(id), requested_by TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS review_decision (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_request(id), verdict TEXT NOT NULL, summary TEXT NOT NULL, requested_changes TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS review_checklist_item (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_request(id), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', required INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'OPEN', notes TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS review_evidence (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_request(id), kind TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS change_request (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_request(id), summary TEXT NOT NULL, items TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN', evidence_id TEXT, requested_by TEXT NOT NULL DEFAULT '', addressed_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS approval_record (id TEXT PRIMARY KEY, review_request_id TEXT NOT NULL REFERENCES review_request(id), decision TEXT NOT NULL, summary TEXT NOT NULL, requested_changes TEXT NOT NULL DEFAULT '', waiver_reason TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS pinned_memory (id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, content TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'project', task_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS project_memory (id TEXT PRIMARY KEY, scope TEXT NOT NULL DEFAULT 'project', category TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '', source_type TEXT NOT NULL DEFAULT 'human', source_ref TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', confidence TEXT NOT NULL DEFAULT 'medium', task_id TEXT, created_by TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(MIGRATION_SQL);
  return drizzle(sqlite, { schema });
}

let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("../db.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
  runMigrations: () => {},
}));

const repo = await import("../repositories.ts");
const { validateCapsule } = await import("../application/protocol-gate-service.ts");

describe("P12 Capsule Validation", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb = undefined as any; });

  it("returns invalid when no capsule exists", () => {
    const val = validateCapsule(null, null, "task-1", "agent-1");
    expect(val.valid).toBe(false);
    expect(val.notes).toContain("No context capsule found. Create one before resuming.");
  });

  it("returns valid for a fresh capsule with evidence", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "50%", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "Continue", needSync: false,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build feature", currentPhase: "implementation",
      confirmedDecisions: "", interfaceContract: "", workingFiles: "",
      completedWork: "", remainingWork: "rest", risks: "", blockers: "",
      nextSteps: "Continue", resumePrompt: "Keep going",
    });

    const val = validateCapsule(capsule, cp, task.id, agent.id);
    expect(val.valid).toBe(true);
    expect(val.stale).toBe(false);
    expect(val.hasEvidence).toBe(true);
    expect(val.scopeMatch).toBe(true);
  });

  it("detects scope mismatch", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "", needSync: false,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build", currentPhase: "phase", confirmedDecisions: "",
      interfaceContract: "", workingFiles: "", completedWork: "",
      remainingWork: "", risks: "", blockers: "", nextSteps: "",
      resumePrompt: "",
    });

    // Validate against wrong task
    const val = validateCapsule(capsule, cp, "other-task", agent.id);
    expect(val.valid).toBe(false);
    expect(val.scopeMatch).toBe(false);
  });

  it("detects unresolved blockers", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "", needSync: false,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build", currentPhase: "phase", confirmedDecisions: "",
      interfaceContract: "", workingFiles: "", completedWork: "",
      remainingWork: "", risks: "", blockers: "Waiting for API spec",
      nextSteps: "", resumePrompt: "",
    });

    const val = validateCapsule(capsule, cp, task.id, agent.id);
    expect(val.valid).toBe(false);
    expect(val.hasBlockers).toBe(true);
    expect(val.notes.some(n => n.includes("Unresolved blockers"))).toBe(true);
  });

  it("detects needSync from checkpoint", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Need sync",
      progress: "", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "", needSync: true,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build", currentPhase: "phase", confirmedDecisions: "",
      interfaceContract: "", workingFiles: "", completedWork: "",
      remainingWork: "", risks: "", blockers: "", nextSteps: "",
      resumePrompt: "",
    });

    const val = validateCapsule(capsule, cp, task.id, agent.id);
    expect(val.valid).toBe(false);
    expect(val.needsSync).toBe(true);
    expect(val.notes.some(n => n.includes("needSync"))).toBe(true);
  });
});

describe("P12 Extended Capsule Fields", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb = undefined as any; });

  it("stores and retrieves P12 extended fields", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "", needSync: false,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Refactor auth", currentPhase: "implementation",
      confirmedDecisions: "", interfaceContract: "", workingFiles: "",
      completedWork: "", remainingWork: "token refresh",
      risks: "", blockers: "", nextSteps: "Implement refresh",
      resumePrompt: "Continue with token refresh",
      intentScope: "Auth module only",
      nonGoals: "Do not touch billing",
      verifiedFacts: "JWT validated end-to-end",
      unverifiedClaims: "Redis cache assumed fast enough",
      doNotTouch: "packages/billing/*",
      handoffInstructions: "Reviewer: check token expiry logic",
    });

    expect((capsule as any).intentScope).toBe("Auth module only");
    expect((capsule as any).nonGoals).toBe("Do not touch billing");
    expect((capsule as any).verifiedFacts).toBe("JWT validated end-to-end");
    expect((capsule as any).unverifiedClaims).toBe("Redis cache assumed fast enough");
    expect((capsule as any).doNotTouch).toBe("packages/billing/*");
    expect((capsule as any).handoffInstructions).toBe("Reviewer: check token expiry logic");

    // Retrieve via getLatestCapsule
    const latest = repo.getLatestCapsule(task.id, agent.id);
    expect((latest as any).intentScope).toBe("Auth module only");
    expect((latest as any).nonGoals).toBe("Do not touch billing");
  });

  it("defaults P12 fields to empty when not provided", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "", needSync: false,
    });

    const capsule = repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build", currentPhase: "phase", confirmedDecisions: "",
      interfaceContract: "", workingFiles: "", completedWork: "",
      remainingWork: "", risks: "", blockers: "", nextSteps: "",
      resumePrompt: "",
    });

    expect((capsule as any).intentScope).toBe("");
    expect((capsule as any).nonGoals).toBe("");
    expect((capsule as any).doNotTouch).toBe("");
  });
});

describe("P12 ResumeContext includes extended capsule fields", () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb = undefined as any; });

  it("getResumeContext populates P12 fields and contextMode", () => {
    const agent = repo.createAgent({ name: "test", provider: "other", role: "backend" });
    const task = repo.createTask({ title: "Test task", description: "" });
    repo.assignTask(task.id, agent.id);
    repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);

    const cp = repo.createCheckpoint({
      taskId: task.id, agentId: agent.id, summary: "Progress",
      progress: "50%", currentUnderstanding: "", changedFiles: "",
      risks: "", blockers: "", nextSteps: "Continue", needSync: false,
    });

    repo.createCapsule({
      taskId: task.id, agentId: agent.id, checkpointId: cp.id,
      goal: "Build feature", currentPhase: "implementation",
      confirmedDecisions: "", interfaceContract: "", workingFiles: "",
      completedWork: "", remainingWork: "rest", risks: "", blockers: "",
      nextSteps: "Continue", resumePrompt: "Keep going",
      intentScope: "Feature X only",
      nonGoals: "No DB changes",
    });

    const ctx = repo.getResumeContext(task.id, agent.id);
    expect(ctx.contextMode).toBe("capsule-first");
    expect(ctx.latestCapsule).toBeDefined();
    expect((ctx.latestCapsule as any).intentScope).toBe("Feature X only");
    expect((ctx.latestCapsule as any).nonGoals).toBe("No DB changes");
  });
});
