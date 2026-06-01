/**
 * Integration tests for Escalation Routing Service.
 */

import { eq, sql } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../db.js";
import * as schema from "../schema.js";
import { createAgent, createTask } from "../repositories/index.js";
import { sgRequest } from "./sync-gate-service.js";
import { updateSyncGateStatus } from "../repositories/sync-gate-repository.js";
import { SyncGateStatus, AgentAvailability, EscalationOptIn, GatePolicyKind, GateTimeoutAction } from "syncpoint-core";
import {
  manifestUpsert, manifestGet, manifestList, manifestDelete,
  routeGateEscalation,
} from "./escalation-routing-service.js";

let tmpDir: string;
let a1: string, a2: string, e1: string, e2: string, human: string;
let taskId: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-esc-test-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  a1 = createAgent({ name: "esc-a1", provider: "other", role: "backend" }).id;
  a2 = createAgent({ name: "esc-a2", provider: "other", role: "frontend" }).id;
  e1 = createAgent({ name: "esc-e1", provider: "other", role: "reviewer" }).id;
  e2 = createAgent({ name: "esc-e2", provider: "human", role: "manager" }).id;
  human = createAgent({ name: "esc-human", provider: "human", role: "manager" }).id;
  taskId = createTask({ title: "Escalation test task", description: "" }).id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── Manifest CRUD ───────────────────────────────────

describe("manifestUpsert / manifestGet", () => {
  it("creates a new manifest", () => {
    const m = manifestUpsert(e1, {
      capabilities: [{ domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] }],
      canHandleHumanEscalation: false,
      tags: ["reviewer"],
    });
    expect(m.agentId).toBe(e1);
    expect(m.capabilities).toHaveLength(1);
    expect(m.capabilities[0].domain).toBe("code-review");
    expect(m.tags).toContain("reviewer");
  });

  it("updates existing manifest", () => {
    manifestUpsert(e1, { availability: AgentAvailability.BUSY });
    const m = manifestGet(e1);
    expect(m?.availability).toBe(AgentAvailability.BUSY);
    // Capabilities should still be present
    expect(m?.capabilities).toHaveLength(1);
  });

  it("manifestList returns all manifests", () => {
    manifestUpsert(e2, {
      canHandleHumanEscalation: true,
      escalationPreference: { optIn: EscalationOptIn.ALWAYS, priority: 90 },
    });
    const all = manifestList();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("manifestGet tolerates malformed persisted JSON", () => {
    manifestUpsert(e1, {
      capabilities: [{ domain: "code-review", skills: ["typescript"], resourceTypes: ["file"] }],
      tags: ["reviewer"],
    });

    // Write malformed JSON directly via raw SQL — Drizzle's mode:"json" columns
    // would stringify a plain string, so we bypass to store truly broken text.
    getDb().run(
      sql`UPDATE agent_manifest SET
        capabilities_json = ${"{"},
        escalation_preference_json = ${"{"},
        tags_json = ${"{"},
        updated_at = ${new Date().toISOString()}
        WHERE agent_id = ${e1}`
    );

    const manifest = manifestGet(e1);
    expect(manifest?.agentId).toBe(e1);
    expect(manifest?.capabilities).toEqual([]);
    expect(manifest?.tags).toEqual([]);
    expect(manifest?.escalationPreference.optIn).toBe(EscalationOptIn.WHEN_AVAILABLE);
  });

  it("manifestDelete removes manifest", () => {
    const tempId = createAgent({ name: "temp-agent", provider: "other", role: "other" }).id;
    manifestUpsert(tempId, {});
    expect(manifestGet(tempId)).not.toBeNull();
    manifestDelete(tempId);
    expect(manifestGet(tempId)).toBeNull();
  });
});

// ── Escalation routing ──────────────────────────────

describe("routeGateEscalation", () => {
  it("routes to available agents, excluding required agents on the gate", () => {
    // Reset e1 to online
    manifestUpsert(e1, { availability: AgentAvailability.ONLINE });

    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    // Escalate the gate
    updateSyncGateStatus(gate.gate.id, SyncGateStatus.ESCALATED, "test escalation");

    const candidates = routeGateEscalation(gate.gate.id);
    // Should not include a1 or a2 (they are required agents)
    expect(candidates.map(c => c.agentId)).not.toContain(a1);
    expect(candidates.map(c => c.agentId)).not.toContain(a2);
    // Should include e1 and/or e2
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("explicit escalation agents score highest", () => {
    // Normalize manifests for clean comparison
    manifestUpsert(e1, { availability: AgentAvailability.ONLINE, canHandleHumanEscalation: false });
    manifestUpsert(e2, { availability: AgentAvailability.ONLINE, canHandleHumanEscalation: false,
      escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 50 } });

    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
      policy: { kind: GatePolicyKind.ALL_REQUIRED, timeoutAction: GateTimeoutAction.ESCALATE, escalationAgentIds: [e1] },
    });
    updateSyncGateStatus(gate.gate.id, SyncGateStatus.ESCALATED, "test");

    const candidates = routeGateEscalation(gate.gate.id);
    if (candidates.length > 0) {
      expect(candidates[0].agentId).toBe(e1);
    }
  });

  it("human-capable agents prioritized when gate requires human", () => {
    manifestUpsert(e1, { canHandleHumanEscalation: false, availability: AgentAvailability.ONLINE });
    manifestUpsert(e2, { canHandleHumanEscalation: true, availability: AgentAvailability.ONLINE,
      escalationPreference: { optIn: EscalationOptIn.WHEN_AVAILABLE, priority: 50 } });

    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
      policy: { kind: GatePolicyKind.HUMAN_REQUIRED, timeoutAction: GateTimeoutAction.ESCALATE },
    });
    updateSyncGateStatus(gate.gate.id, SyncGateStatus.ESCALATED, "needs human");

    const candidates = routeGateEscalation(gate.gate.id);
    // e2 has canHandleHumanEscalation=true, should rank higher
    const e2idx = candidates.findIndex(c => c.agentId === e2);
    const e1idx = candidates.findIndex(c => c.agentId === e1);
    if (e2idx >= 0 && e1idx >= 0) {
      expect(e2idx).toBeLessThan(e1idx);
    }
  });

  it("agents with optIn=NEVER are excluded", () => {
    manifestUpsert(human, {
      escalationPreference: { optIn: EscalationOptIn.NEVER },
    });

    const gate = sgRequest({
      taskId,
      requestedByAgentId: a1,
      requiredAgentIds: [a1, a2],
    });
    updateSyncGateStatus(gate.gate.id, SyncGateStatus.ESCALATED, "test");

    const candidates = routeGateEscalation(gate.gate.id);
    expect(candidates.map(c => c.agentId)).not.toContain(human);
  });
});
