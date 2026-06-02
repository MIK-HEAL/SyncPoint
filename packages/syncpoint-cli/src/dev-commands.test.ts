/**
 * Tests for CLI dev commands — registration, status, tail, reset.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Command } from "commander";
import { closeDb, getDb, getRawDb } from "syncpoint-server";
import { ensureApplicationBootstrap } from "syncpoint-server/application";
import * as repo from "syncpoint-server/repositories";
import { ResourceClaimMode } from "syncpoint-core";
import { registerDevCommands } from "./commands/dev.js";

let tmpDir = "";

beforeEach(() => {
  closeDb();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-cli-dev-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  ensureApplicationBootstrap();
  getDb();
});

afterEach(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("dev command registration", () => {
  it("registers dev subcommands", () => {
    const program = new Command();
    registerDevCommands(program);

    const dev = program.commands.find(c => c.name() === "dev");
    expect(dev).toBeDefined();
    expect(dev?.commands.map(c => c.name())).toEqual(["status", "tail", "reset", "integrity", "recover"]);
  });
});

describe("dev status data", () => {
  it("returns empty lists when DB is fresh", () => {
    const agents = repo.listAgents();
    const claims = repo.listResourceClaims();
    const gates = repo.listSyncGates();
    const operations = repo.listOperations();
    const permits = repo.listWritePermits();

    expect(agents).toHaveLength(0);
    expect(claims).toHaveLength(0);
    expect(gates).toHaveLength(0);
    expect(operations).toHaveLength(0);
    expect(permits).toHaveLength(0);
  });

  it("returns populated lists after creating entities", () => {
    const agent = repo.createAgent({ name: "dev-test", provider: "other", role: "other" });
    const task = repo.createTask({ title: "Dev test task", description: "" });
    repo.assignTask(task.id, agent.id);

    const agents = repo.listAgents();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0].name).toBe("dev-test");
  });
});

describe("dev tail recent events", () => {
  it("reads recent events from DB", () => {
    const raw = getRawDb();
    // Create an agent to generate an event
    repo.createAgent({ name: "tail-test", provider: "other", role: "other" });

    const rows = raw.prepare(
      `SELECT id, event_type, entity_type, entity_id, detail, created_at FROM event ORDER BY created_at DESC LIMIT 10`
    ).all() as Array<{ event_type: string }>;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].event_type).toBe("AGENT_REGISTERED");
  });
});

describe("dev reset", () => {
  it("clears collaboration state but keeps agents and tasks", () => {
    const agent = repo.createAgent({ name: "reset-test", provider: "other", role: "other" });
    const task = repo.createTask({ title: "Reset test task", description: "" });
    repo.assignTask(task.id, agent.id);

    // Create a claim
    repo.createResourceClaim({
      actorId: agent.id,
      taskId: task.id,
      resources: [{ type: "file", locator: "src/test.ts", metadata: "" }],
      mode: ResourceClaimMode.EXCLUSIVE,
    });

    // Verify state exists
    expect(repo.listResourceClaims().length).toBeGreaterThan(0);
    expect(repo.listAgents().length).toBeGreaterThan(0);

    // Reset
    const raw = getRawDb();
    const tables = [
      "resource_claim_resource",
      "resource_claim",
      "sync_gate_required_agent",
      "sync_gate_ack",
      "sync_gate_vote",
      "sync_gate_resource",
      "sync_gate_related_claim",
      "sync_gate",
      "operation_resource",
      "operation",
      "write_permit_resource",
      "write_permit",
      "event",
    ];
    let deleted = 0;
    for (const table of tables) {
      try {
        const result = raw.prepare(`DELETE FROM \`${table}\``).run();
        deleted += result.changes;
      } catch { /* skip */ }
    }
    raw.exec(`UPDATE agent SET current_task_id = NULL WHERE current_task_id IS NOT NULL`);
    raw.exec(`UPDATE task SET owner_agent_id = NULL WHERE owner_agent_id IS NOT NULL`);

    // Verify claims are gone but agents remain
    expect(repo.listResourceClaims()).toHaveLength(0);
    expect(repo.listAgents().length).toBeGreaterThan(0);
    expect(deleted).toBeGreaterThan(0);
  });
});
