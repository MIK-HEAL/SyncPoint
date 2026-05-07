/**
 * PR5 Acceptance Tests — Generic Agent Collaboration MVP.
 *
 * Proves that SyncPoint core can coordinate any model's safe changes
 * to any shared resource using ResourceClaim + Operation + Constraint Runtime.
 *
 * Case A: Ownership conflict — Agent B submits on a resource exclusively
 *         claimed by Agent A → operation becomes CONFLICTING.
 * Case B: Constraint Runtime blocks — a hard_constraint with
 *         validatorType: "resource_forbidden" blocks an operation touching
 *         the forbidden resource and writes constraintViolations.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { __setDb } from "../repositories/_shared.js";
import { runMigrations } from "../db.js";
import type { SyncPointDb } from "../db.js";
import * as repo from "../repositories.js";
import {
  ProjectMemoryScope,
  ProjectMemoryCategory,
  ProjectMemorySourceType,
  ProjectMemoryConfidence,
  MemoryKind,
  ProjectionTarget,
  MemorySeverity,
} from "syncpoint-core";
import {
  rcClaim,
} from "../application/resource-claim-service.js";
import {
  opCreate,
  opSubmit,
  opCheck,
  opApprove,
  opApply,
} from "../application/operation-service.js";
import {
  pmAdd,
  pmUpdate,
  pmApprove,
} from "../application/project-memory-service.js";

let sqlite: Database.Database;
let db: SyncPointDb;
let agentA: string;
let agentB: string;
let agentC: string;
let taskId: string;

beforeAll(() => {
  sqlite = new Database(":memory:");
  runMigrations(sqlite);
  db = drizzle(sqlite, { schema }) as unknown as SyncPointDb;
  __setDb(db);

  // Seed agents + task
  agentA = repo.createAgent({ name: "agent-a-designer", provider: "other", role: "frontend" }).id;
  agentB = repo.createAgent({ name: "agent-b-optimizer", provider: "other", role: "other" }).id;
  agentC = repo.createAgent({ name: "agent-c-editor", provider: "other", role: "backend" }).id;
  taskId = repo.createTask({ title: "PR5 acceptance task", description: "" }).id;
});

afterAll(() => {
  __setDb(null);
  sqlite.close();
});

// ── Case A: Ownership conflict ─────────────────────────

describe("Case A: ownership conflict blocks operation", () => {
  it("Agent B's operation on Agent A's exclusively-claimed resource becomes CONFLICTING", () => {
    // Agent A claims artifact://design/homepage exclusively
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [{ type: "artifact", locator: "artifact://design/homepage", metadata: "" }],
      mode: "exclusive",
      autoGate: false,
    });

    // Agent B creates and submits an asset_edit touching the same resource
    const op = opCreate({
      type: "asset_edit",
      actorId: agentB,
      taskId,
      title: "Redesign homepage hero section",
      summary: "Updated hero layout",
      targetResources: [{ type: "artifact", locator: "artifact://design/homepage", metadata: "" }],
      payloadRef: "s3://bucket/hero-v2.png",
    });

    const result = opSubmit(op.id);

    // Operation should be CONFLICTING because:
    //   1. Agent B has no claim on the resource (claim_coverage fails)
    //   2. Agent A has exclusive claim (no_hard_conflict fails)
    expect(result.operation.status).toBe("CONFLICTING");
    expect(result.checkResult).toBeTruthy();
    expect(result.checkResult!.allPassed).toBe(false);

    // Check items should contain the ownership conflict
    const conflictItem = result.checkResult!.items.find(
      i => i.check === "generic_no_hard_conflict",
    );
    expect(conflictItem).toBeDefined();
    expect(conflictItem!.passed).toBe(false);
  });
});

// ── Case B: Constraint Runtime blocks via resource_forbidden ─

describe("Case B: Constraint Runtime blocks on resource_forbidden", () => {
  it("Agent C's operation touching a forbidden resource gets constraintViolations", () => {
    // Create a blocking hard_constraint with resource_forbidden
    const memory = pmAdd({
      scope: ProjectMemoryScope.PROJECT,
      category: ProjectMemoryCategory.DECISION,
      title: "Brand logo is frozen for Q2",
      content: "Do not modify the brand logo until Q3 review.",
      tags: "brand,frozen",
      sourceType: ProjectMemorySourceType.AGENT,
      sourceRef: "brand-policy",
      confidence: ProjectMemoryConfidence.HIGH,
      taskId,
      createdBy: agentA,
      // V2 fields for constraint runtime
      kind: MemoryKind.HARD_CONSTRAINT,
      projectionTarget: ProjectionTarget.CONSTRAINT_RUNTIME,
      severity: MemorySeverity.BLOCKING,
      validatorType: "resource_forbidden",
      validatorConfig: JSON.stringify({ message: "Brand logo is frozen for Q2" }),
    });
    // Set appliesTo with resources scope field (raw JSON string via update)
    pmUpdate(memory.id, {
      appliesTo: JSON.stringify({ resources: ["binary://brand-logo.png"] }),
      updatedBy: agentA,
    });
    pmApprove(memory.id, agentA);

    // Agent C claims the resource (so claim_coverage passes)
    rcClaim({
      actorId: agentC,
      taskId,
      resources: [{ type: "binary_asset", locator: "binary://brand-logo.png", metadata: "" }],
      mode: "exclusive",
      autoGate: false,
    });

    // Agent C submits an asset_update touching the forbidden resource
    const op = opCreate({
      type: "asset_update",
      actorId: agentC,
      taskId,
      title: "Update brand logo colors",
      summary: "Refresh brand palette",
      targetResources: [{ type: "binary_asset", locator: "binary://brand-logo.png", metadata: "" }],
      payloadRef: "s3://bucket/logo-v2.svg",
    });

    const result = opSubmit(op.id);

    // Operation blocked by constraint runtime
    expect(result.operation.status).toBe("CONFLICTING");
    expect(result.checkResult).toBeTruthy();
    expect(result.checkResult!.allPassed).toBe(false);

    // Should have constraint_runtime check item
    const crItem = result.checkResult!.items.find(i => i.check === "constraint_runtime");
    expect(crItem).toBeDefined();
    expect(crItem!.passed).toBe(false);
    expect(crItem!.detail).toContain("resource_forbidden");

    // Should have constraintViolations array
    expect(result.checkResult!.constraintViolations).toBeDefined();
    expect(result.checkResult!.constraintViolations!.length).toBeGreaterThanOrEqual(1);
    const violation = result.checkResult!.constraintViolations![0];
    expect(violation.rule).toBe("resource_forbidden");
    expect(violation.evidence).toContain("binary://brand-logo.png");
  });

  it("opApply is blocked by constraint runtime on forbidden resource", () => {
    // Agent C creates another operation, manually approve it, then try to apply
    const op = opCreate({
      type: "asset_update",
      actorId: agentC,
      taskId,
      title: "Force-apply brand logo change",
      summary: "Trying to bypass check",
      targetResources: [{ type: "binary_asset", locator: "binary://brand-logo.png", metadata: "" }],
      payloadRef: "s3://bucket/logo-v3.svg",
    });

    // Force status to APPROVED for test (simulating manual override)
    repo.updateOperation(op.id, { status: "SUBMITTED" });
    const approved = opApprove(op.id, agentC, "Force-approved for test");
    expect(approved.status).toBe("APPROVED");

    // opApply should throw because constraint runtime still blocks
    expect(() => opApply(op.id)).toThrow(/blocked by constraint runtime/);
  });
});
