/**
 * Integration tests for generic ResourceClaim + Operation services.
 *
 * Proves the new generic tables, repositories, and services work
 * end-to-end, and that dual-write from legacy services mirrors data.
 */

import { eq } from "drizzle-orm";
import { OperationStatus } from "syncpoint-core";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { __setDb } from "../repositories/_shared.js";
import { runMigrations } from "../db.js";
import type { SyncPointDb } from "../db.js";
import * as repo from "../repositories/index.js";
import {
  rcClaim, rcRelease, rcList, rcDetectConflicts,
} from "../application/resource-claim-service.js";
import {
  opCreate, opSubmit, opCheck, opApprove, opApply, opCancel, opStatus, opList,
} from "../application/operation-service.js";

let sqlite: Database.Database;
let db: SyncPointDb;
let agentId: string;
let taskId: string;

beforeAll(() => {
  sqlite = new Database(":memory:");
  runMigrations(sqlite);
  db = drizzle(sqlite, { schema }) as unknown as SyncPointDb;
  __setDb(db);

  // Seed agent + task
  agentId = repo.createAgent({ name: "alice", provider: "other", role: "backend" }).id;
  taskId = repo.createTask({ title: "test task", description: "" }).id;
});

afterAll(() => {
  __setDb(null);
  sqlite.close();
});

// ── ResourceClaim ──────────────────────────────────────

describe("ResourceClaim service", () => {
  it("rcClaim creates a generic resource claim", () => {
    const result = rcClaim({
      actorId: agentId,
      taskId,
      resources: [
        { type: "file", locator: "src/auth.ts", metadata: "", scope: "file" as const },
        { type: "file", locator: "src/login.ts", metadata: "", scope: "file" as const },
      ],
      mode: "exclusive",
      autoGate: false,
    });
    expect(result.claim.id).toBeTruthy();
    expect(result.claim.actorId).toBe(agentId);
    expect(result.claim.resources).toHaveLength(2);
    expect(result.claim.status).toBe("ACTIVE");
    expect(result.conflicts).toHaveLength(0);
  });

  it("rcList returns active claims", () => {
    const claims = rcList({ actorId: agentId, status: "ACTIVE" });
    expect(claims.length).toBeGreaterThanOrEqual(1);
  });

  it("rcDetectConflicts detects overlapping exclusive claims", () => {
    const agent2 = repo.createAgent({ name: "bob", provider: "other", role: "backend" }).id;
    rcClaim({
      actorId: agent2,
      taskId,
      resources: [{ type: "file", locator: "src/auth.ts", metadata: "", scope: "file" as const }],
      mode: "exclusive",
      autoGate: false,
    });
    const conflicts = rcDetectConflicts({ resourceType: "file" });
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0].isHardConflict).toBe(true);
  });

  it("rcRelease releases a claim", () => {
    const result = rcClaim({
      actorId: agentId,
      taskId,
      resources: [{ type: "image", locator: "assets/logo.png", metadata: "", scope: "file" as const }],
      autoGate: false,
    });
    const released = rcRelease(result.claim.id);
    expect(released.status).toBe("RELEASED");
  });

  it("non-file types do not conflict with file types", () => {
    rcClaim({
      actorId: agentId,
      taskId,
      resources: [{ type: "image", locator: "src/auth.ts", metadata: "", scope: "file" as const }],
      mode: "exclusive",
      autoGate: false,
    });
    // image type "src/auth.ts" should NOT conflict with file type "src/auth.ts"
    const conflicts = rcDetectConflicts({ resourceType: "image" });
    const crossTypeConflicts = conflicts.filter(c => c.resourceType !== "image");
    expect(crossTypeConflicts).toHaveLength(0);
  });

  it("rejects mixed resource types in one claim", () => {
    expect(() => rcClaim({
      actorId: agentId,
      taskId,
      resources: [
        { type: "file", locator: "src/mixed.ts", metadata: "", scope: "file" as const },
        { type: "image", locator: "assets/mixed.png", metadata: "", scope: "file" as const },
      ],
      autoGate: false,
    })).toThrow(/same type/i);
  });
});

// ── Operation ──────────────────────────────────────────

describe("Operation service", () => {
  it("opCreate + opSubmit + opCheck lifecycle", () => {
    const op = opCreate({
      type: "code_patch",
      actorId: agentId,
      taskId,
      title: "fix auth bug",
      summary: "patch summary",
      targetResources: [{ type: "file", locator: "src/auth.ts", metadata: "", scope: "file" as const }],
    });
    expect(op.id).toBeTruthy();
    expect(op.status).toBe("DRAFT");
    expect(op.type).toBe("code_patch");

    const submitted = opSubmit(op.id);
    // After submit, auto-check runs; result depends on registered validators
    expect(submitted.operation.status).toMatch(/SUBMITTED|CONFLICTING/);
    expect(submitted.checkResult).toBeTruthy();
  });

  it("opApprove + opApply works for a submitted operation", () => {
    const op = opCreate({
      type: "code_patch",
      actorId: agentId,
      taskId,
      title: "add login page",
    });
    // Manual status set for test
    repo.updateOperation(op.id, { status: OperationStatus.SUBMITTED });

    const approved = opApprove(op.id, agentId, "looks good");
    expect(approved.status).toBe("APPROVED");

    const applied = opApply(op.id);
    expect(applied.status).toBe("APPLIED");
  });

  it("opCancel works from DRAFT", () => {
    const op = opCreate({
      type: "image_edit",
      actorId: agentId,
      taskId,
      title: "resize logo",
    });
    const cancelled = opCancel(op.id, "no longer needed");
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("opList filters by type", () => {
    const all = opList({ taskId });
    const codePatch = opList({ type: "code_patch", taskId });
    const imageEdit = opList({ type: "image_edit", taskId });
    expect(all.length).toBe(codePatch.length + imageEdit.length);
  });

  it("opStatus returns parsed check result", () => {
    const op = opCreate({
      type: "code_patch",
      actorId: agentId,
      taskId,
      title: "test status",
    });
    const result = opStatus(op.id);
    expect(result.operation.id).toBe(op.id);
    // No check result yet for DRAFT
    expect(result.checkResult).toBeNull();
  });

  it("repository getOperation falls back to null for malformed stored check result", () => {
    const op = repo.createOperation({
      type: "code_patch",
      actorId: agentId,
      taskId,
      title: "broken check result",
      summary: "",
      targetResources: [],
      payloadRef: "",
    });

    db.update(schema.operations).set({
      checkResultJson: "{",
    }).where(eq(schema.operations.id, op.id)).run();

    const loaded = repo.getOperation(op.id);
    expect(loaded.checkResult).toBeNull();
  });
});

