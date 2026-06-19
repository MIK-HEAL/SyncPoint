import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import * as schema from "../../src/schema.js";
import { runMigrations, DatabaseContext } from "../../src/db.js";
import { __setTestContext, __resetContext } from "../../src/repositories/_shared.js";
import { getContract } from "../../src/repositories/contract-repository.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function seedDrizzleBaseline(db: Database.Database): void {
  const drizzleDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");
  const journalPath = path.join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const baseline = journal.entries?.[0];
  if (!baseline) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      hash TEXT NOT NULL,
      created_at NUMERIC
    );
  `);
  db.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(baseline.tag, baseline.when);
}

describe("peer_contract normalization migration", () => {
  let sqlite: Database.Database | null = null;

  afterEach(() => {
    __resetContext();
    if (sqlite) {
      sqlite.close();
      sqlite = null;
    }
  });

  it("moves legacy JSON list columns into child tables and preserves repository hydration", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");
    sqlite.exec(`
      CREATE TABLE task (
        id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN',
        owner_agent_id TEXT,
        parent_task_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE peer_contract (
        id TEXT PRIMARY KEY NOT NULL,
        task_id TEXT NOT NULL REFERENCES task(id),
        title TEXT NOT NULL DEFAULT '',
        participants TEXT NOT NULL DEFAULT '',
        scope TEXT NOT NULL DEFAULT '',
        responsibilities TEXT NOT NULL DEFAULT '',
        interface_spec TEXT NOT NULL DEFAULT '',
        resource_boundaries TEXT NOT NULL DEFAULT '',
        dependencies TEXT NOT NULL DEFAULT '',
        test_plan TEXT NOT NULL DEFAULT '',
        risks TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO task (id, title, description, status, created_at, updated_at)
      VALUES ('t1', 'Task 1', '', 'OPEN', '2024-02-01T00:00:00Z', '2024-02-01T00:00:00Z');
      INSERT INTO peer_contract (
        id, task_id, title, participants, scope, responsibilities, interface_spec, resource_boundaries, dependencies, test_plan, risks, status, created_at, updated_at
      ) VALUES (
        'c1',
        't1',
        'Auth contract',
        '["alice","bob"]',
        'Auth scope',
        '["backend","review"]',
        '["POST /auth/login"]',
        '["src/auth/"]',
        '["token-service","db"]',
        'Integration test',
        'Token mismatch',
        'DRAFT',
        '2024-02-01T00:00:00Z',
        '2024-02-01T00:00:00Z'
      );
      INSERT INTO peer_contract (
        id, task_id, title, participants, scope, responsibilities, interface_spec, resource_boundaries, dependencies, test_plan, risks, status, created_at, updated_at
      ) VALUES (
        'c2',
        't1',
        'Empty contract',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'DRAFT',
        '2024-02-02T00:00:00Z',
        '2024-02-02T00:00:00Z'
      );
    `);

    seedDrizzleBaseline(sqlite);
    runMigrations(sqlite);
    runMigrations(sqlite);

    const columnNames = (sqlite.prepare("PRAGMA table_info(peer_contract)").all() as Array<{ name: string }>).map(column => column.name);
    expect(columnNames).not.toContain("participants");
    expect(columnNames).not.toContain("responsibilities");
    expect(columnNames).not.toContain("interface_spec");
    expect(columnNames).not.toContain("resource_boundaries");
    expect(columnNames).not.toContain("dependencies");

    const participantRows = sqlite.prepare(
      "SELECT position, participant FROM peer_contract_participant WHERE contract_id = 'c1' ORDER BY position"
    ).all() as Array<{ position: number; participant: string }>;
    const responsibilityRows = sqlite.prepare(
      "SELECT position, responsibility FROM peer_contract_responsibility WHERE contract_id = 'c1' ORDER BY position"
    ).all() as Array<{ position: number; responsibility: string }>;
    const dependencyRows = sqlite.prepare(
      "SELECT position, dependency FROM peer_contract_dependency WHERE contract_id = 'c1' ORDER BY position"
    ).all() as Array<{ position: number; dependency: string }>;

    expect(participantRows).toEqual([
      { position: 0, participant: "alice" },
      { position: 1, participant: "bob" },
    ]);
    expect(responsibilityRows).toEqual([
      { position: 0, responsibility: "backend" },
      { position: 1, responsibility: "review" },
    ]);
    expect(dependencyRows).toEqual([
      { position: 0, dependency: "token-service" },
      { position: 1, dependency: "db" },
    ]);

    const ctx = new DatabaseContext({ dbPath: ":memory:", skipWal: true, sqlite });
    __setTestContext(ctx);

    expect(getContract("c1")).toEqual({
      id: "c1",
      taskId: "t1",
      title: "Auth contract",
      participants: ["alice", "bob"],
      scope: "Auth scope",
      responsibilities: ["backend", "review"],
      interfaceSpec: ["POST /auth/login"],
      resourceBoundaries: ["src/auth/"],
      dependencies: ["token-service", "db"],
      testPlan: "Integration test",
      risks: "Token mismatch",
      status: "DRAFT",
      createdAt: "2024-02-01T00:00:00Z",
      updatedAt: "2024-02-01T00:00:00Z",
    });

    expect(getContract("c2")).toEqual({
      id: "c2",
      taskId: "t1",
      title: "Empty contract",
      participants: [],
      scope: "",
      responsibilities: [],
      interfaceSpec: [],
      resourceBoundaries: [],
      dependencies: [],
      testPlan: "",
      risks: "",
      status: "DRAFT",
      createdAt: "2024-02-02T00:00:00Z",
      updatedAt: "2024-02-02T00:00:00Z",
    });
  });
});
