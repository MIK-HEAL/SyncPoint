import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { AgentStatus, TaskStatus, ContractStatus, HandoffStatus, InvalidTransition } from "syncpoint-core";

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
`;

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(MIGRATION_SQL);
  return drizzle(sqlite, { schema });
}

let testDb: ReturnType<typeof drizzle<typeof schema>>;

vi.mock("./db.js", () => ({
  getDb: () => testDb,
  closeDb: () => {},
  runMigrations: () => {},
}));

// Import after mock is set up — use explicit source path
const repo = await import("./repositories.ts");

describe("Repositories", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  afterEach(() => {
    testDb = undefined as any;
  });

  describe("Agent CRUD", () => {
    it("creates an agent", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      expect(a.name).toBe("codex");
      expect(a.provider).toBe("codex");
      expect(a.role).toBe("backend");
      expect(a.status).toBe(AgentStatus.IDLE);
    });

    it("lists agents", () => {
      repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      repo.createAgent({ name: "claude", provider: "claude-code", role: "frontend" });
      const agents = repo.listAgents();
      expect(agents).toHaveLength(2);
    });

    it("gets agent by id", () => {
      const created = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const found = repo.getAgent(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe("codex");
    });

    it("throws NotFoundError for non-existent agent", () => {
      expect(() => repo.getAgent("nonexistent")).toThrow();
    });

    it("updates agent status", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const updated = repo.updateAgentStatus(a.id, AgentStatus.RUNNING);
      expect(updated.status).toBe(AgentStatus.RUNNING);
    });

    it("rejects invalid agent status transition", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      expect(() => repo.updateAgentStatus(a.id, AgentStatus.DONE)).toThrow(InvalidTransition);
    });
  });

  describe("Task CRUD", () => {
    it("creates a task", () => {
      const t = repo.createTask({ title: "Build auth", description: "JWT auth" });
      expect(t.title).toBe("Build auth");
      expect(t.status).toBe(TaskStatus.OPEN);
    });

    it("assigns a task to an agent", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      const assigned = repo.assignTask(t.id, a.id);
      expect(assigned.status).toBe(TaskStatus.ASSIGNED);
      expect(assigned.ownerAgentId).toBe(a.id);
    });

    it("updates task status", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const updated = repo.updateTaskStatus(t.id, TaskStatus.IN_PROGRESS);
      expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
    });
  });

  describe("Checkpoint CRUD", () => {
    it("creates a checkpoint", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const cp = repo.createCheckpoint({
        taskId: t.id,
        agentId: a.id,
        summary: "Auth scaffold done",
        progress: "60%",
        currentUnderstanding: "Need refresh tokens",
        changedFiles: ["src/auth/*.ts"],
        risks: "Token expiry",
        blockers: "",
        nextSteps: "Add refresh endpoint",
        needSync: true,
      });
      expect(cp.summary).toBe("Auth scaffold done");
      expect(cp.needSync).toBe(true);
    });
  });

  describe("Contract CRUD", () => {
    it("creates and transitions a contract", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const c = repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: ["codex", "claude"],
        scope: "Auth API",
        responsibilities: ["codex: backend"],
        interfaceSpec: ["POST /auth/login"],
        fileBoundaries: ["src/auth/"],
        dependencies: [],
        testPlan: "Integration test",
        risks: "Token mismatch",
      });
      expect(c.status).toBe(ContractStatus.DRAFT);

      const reviewing = repo.updateContractStatus(c.id, ContractStatus.REVIEWING);
      expect(reviewing.status).toBe(ContractStatus.REVIEWING);

      const approved = repo.updateContractStatus(c.id, ContractStatus.APPROVED);
      expect(approved.status).toBe(ContractStatus.APPROVED);
    });

    it("rejects DRAFT → APPROVED", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const c = repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: [],
        scope: "",
        responsibilities: [],
        interfaceSpec: [],
        fileBoundaries: [],
        dependencies: [],
        testPlan: "",
        risks: "",
      });
      expect(() => repo.updateContractStatus(c.id, ContractStatus.APPROVED)).toThrow(InvalidTransition);
    });

    it("contract creation drives task to NEEDS_CONTRACT", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.ASSIGNED);

      repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: [],
        scope: "",
        responsibilities: [],
        interfaceSpec: [],
        fileBoundaries: [],
        dependencies: [],
        testPlan: "",
        risks: "",
      });
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.NEEDS_CONTRACT);
    });

    it("contract review drives task to CONTRACT_REVIEW", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const c = repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: [],
        scope: "",
        responsibilities: [],
        interfaceSpec: [],
        fileBoundaries: [],
        dependencies: [],
        testPlan: "",
        risks: "",
      });
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.NEEDS_CONTRACT);

      repo.updateContractStatus(c.id, ContractStatus.REVIEWING);
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.CONTRACT_REVIEW);
    });

    it("contract approve drives task to READY_TO_WORK", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const c = repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: [],
        scope: "",
        responsibilities: [],
        interfaceSpec: [],
        fileBoundaries: [],
        dependencies: [],
        testPlan: "",
        risks: "",
      });
      repo.updateContractStatus(c.id, ContractStatus.REVIEWING);
      repo.updateContractStatus(c.id, ContractStatus.APPROVED);
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.READY_TO_WORK);
    });

    it("contract reject drives task back to NEEDS_CONTRACT", () => {
      const a = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a.id);
      const c = repo.createContract({
        taskId: t.id,
        title: "Auth contract",
        participants: [],
        scope: "",
        responsibilities: [],
        interfaceSpec: [],
        fileBoundaries: [],
        dependencies: [],
        testPlan: "",
        risks: "",
      });
      repo.updateContractStatus(c.id, ContractStatus.REVIEWING);
      repo.updateContractStatus(c.id, ContractStatus.REJECTED);
      expect(repo.getTask(t.id)!.status).toBe(TaskStatus.NEEDS_CONTRACT);
    });
  });

  describe("Handoff CRUD", () => {
    it("creates and accepts a handoff, transferring task ownership", () => {
      const a1 = repo.createAgent({ name: "codex", provider: "codex", role: "backend" });
      const a2 = repo.createAgent({ name: "claude", provider: "claude-code", role: "frontend" });
      const t = repo.createTask({ title: "Build auth", description: "" });
      repo.assignTask(t.id, a1.id);

      const h = repo.createHandoff({
        fromAgentId: a1.id,
        toAgentId: a2.id,
        taskId: t.id,
        contextSummary: "Auth API ready",
      });
      expect(h.status).toBe(HandoffStatus.PENDING);

      const accepted = repo.acceptHandoff(h.id);
      expect(accepted.status).toBe(HandoffStatus.ACCEPTED);

      // Task ownership transferred
      const task = repo.getTask(t.id);
      expect(task!.ownerAgentId).toBe(a2.id);
    });
  });
});
