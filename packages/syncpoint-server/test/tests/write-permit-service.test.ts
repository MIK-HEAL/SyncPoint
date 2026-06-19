import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SyncGateReason, SyncGateStatus, WriteIntent } from "syncpoint-kernel";
import * as repo from "../../src/repositories/index.js";
import { __createTestContext, __resetContext } from "../../src/repositories/_shared.js";
import { rcClaim } from "../../src/application/resource-claim-service.js";
import { writeApply, writePrepare } from "../../src/application/write-permit-service.js";
import { resetPathResolverCache } from "../../src/application/path-resolver.js";

let root: string;
let agentA: string;
let agentB: string;
let taskId: string;
let previousRoot: string | undefined;

function fileResource(locator: string) {
  return { type: "file", locator, metadata: "", scope: "file" as const };
}

beforeEach(() => {
  __createTestContext();
  previousRoot = process.env.SYNCPOINT_PROJECT_ROOT;
  root = mkdtempSync(path.join(os.tmpdir(), "syncpoint-write-"));
  process.env.SYNCPOINT_PROJECT_ROOT = root;
  resetPathResolverCache();
  agentA = repo.createAgent({ name: `alice-${Date.now()}`, provider: "other", role: "backend" }).id;
  agentB = repo.createAgent({ name: `bob-${Date.now()}`, provider: "other", role: "backend" }).id;
  taskId = repo.createTask({ title: "write permit", description: "" }).id;
});

afterEach(() => {
  __resetContext();
  rmSync(root, { recursive: true, force: true });
  if (previousRoot === undefined) delete process.env.SYNCPOINT_PROJECT_ROOT;
  else process.env.SYNCPOINT_PROJECT_ROOT = previousRoot;
  resetPathResolverCache();
});

describe("write permit service", () => {
  it("applies a permit-backed write for the claim owner", () => {
    writeFileSync(path.join(root, "auth.js"), "old");
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      autoGate: false,
    });

    const prepared = writePrepare({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      intent: WriteIntent.MODIFY,
    });

    expect(prepared.decision.permitted).toBe(true);
    expect(prepared.permit.status).toBe("issued");

    const applied = writeApply({
      permitId: prepared.permit.id,
      mutations: [{ resource: fileResource("auth.js"), content: "new" }],
    });

    expect(applied.permit.status).toBe("consumed");
    expect(readFileSync(path.join(root, "auth.js"), "utf8")).toBe("new");
  });

  it("denies a write to another actor's exclusive claim", () => {
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      autoGate: false,
    });

    const prepared = writePrepare({
      actorId: agentB,
      taskId,
      resources: [fileResource("auth.js")],
      intent: WriteIntent.MODIFY,
    });

    expect(prepared.decision.permitted).toBe(false);
    expect(prepared.permit.status).toBe("denied");
    expect(prepared.decision.blockers.map(blocker => blocker.type)).toContain("resource_claim");
  });

  it("denies writes while a related SYNC_ACKED gate is unresolved", () => {
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      autoGate: false,
    });
    const gate = repo.createSyncGate({
      sessionId: "",
      taskId,
      requestedByAgentId: agentB,
      requiredAgentIds: [agentA, agentB],
      reason: SyncGateReason.RESOURCE_CONFLICT,
      description: "conflict acknowledged but not resolved",
      relatedFiles: ["auth.js"],
      relatedResources: [fileResource("auth.js")],
      relatedCheckpointId: "",
      relatedClaimIds: [],
    });
    repo.updateSyncGateStatus(gate.id, SyncGateStatus.SYNC_ACKED, "acked only");

    const prepared = writePrepare({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      intent: WriteIntent.MODIFY,
    });

    expect(prepared.decision.permitted).toBe(false);
    expect(prepared.decision.blockers.map(blocker => blocker.type)).toContain("sync_gate");
  });

  it("revokes a permit when the file hash changes before apply", () => {
    writeFileSync(path.join(root, "auth.js"), "old");
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      autoGate: false,
    });
    const prepared = writePrepare({
      actorId: agentA,
      taskId,
      resources: [fileResource("auth.js")],
      intent: WriteIntent.MODIFY,
    });
    writeFileSync(path.join(root, "auth.js"), "external change");

    expect(() => writeApply({
      permitId: prepared.permit.id,
      mutations: [{ resource: fileResource("auth.js"), content: "new" }],
    })).toThrow(/changed since permit/i);

    expect(repo.getWritePermit(prepared.permit.id).status).toBe("revoked");
  });

  it("rejects applying a permit after the guarded project root changes", () => {
    const otherRoot = mkdtempSync(path.join(os.tmpdir(), "syncpoint-write-other-"));
    try {
      rcClaim({
        actorId: agentA,
        taskId,
        resources: [fileResource("auth.js")],
        autoGate: false,
      });
      const prepared = writePrepare({
        actorId: agentA,
        taskId,
        resources: [fileResource("auth.js")],
        intent: WriteIntent.MODIFY,
      });
      process.env.SYNCPOINT_PROJECT_ROOT = otherRoot;

      expect(() => writeApply({
        permitId: prepared.permit.id,
        mutations: [{ resource: fileResource("auth.js"), content: "new" }],
      })).toThrow(/guarded root/i);

      expect(repo.getWritePermit(prepared.permit.id).status).toBe("revoked");
      expect(readFileIfExists(path.join(otherRoot, "auth.js"))).not.toBe("new");
    } finally {
      process.env.SYNCPOINT_PROJECT_ROOT = root;
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("preflights all bulk mutations before writing any file", () => {
    writeFileSync(path.join(root, "a.js"), "a-old");
    writeFileSync(path.join(root, "b.js"), "b-old");
    rcClaim({
      actorId: agentA,
      taskId,
      resources: [fileResource("a.js"), fileResource("b.js")],
      autoGate: false,
    });
    const prepared = writePrepare({
      actorId: agentA,
      taskId,
      resources: [fileResource("a.js"), fileResource("b.js")],
      intent: WriteIntent.BULK,
    });
    writeFileSync(path.join(root, "b.js"), "external change");

    expect(() => writeApply({
      permitId: prepared.permit.id,
      mutations: [
        { resource: fileResource("a.js"), content: "a-new" },
        { resource: fileResource("b.js"), content: "b-new" },
      ],
    })).toThrow(/changed since permit/i);

    expect(readFileSync(path.join(root, "a.js"), "utf8")).toBe("a-old");
    expect(readFileSync(path.join(root, "b.js"), "utf8")).toBe("external change");
    expect(repo.getWritePermit(prepared.permit.id).status).toBe("revoked");
  });

  it("rejects symlink or junction paths that escape the guarded root", () => {
    const outsideRoot = mkdtempSync(path.join(os.tmpdir(), "syncpoint-write-outside-"));
    try {
      rcClaim({
        actorId: agentA,
        taskId,
        resources: [fileResource("linked/escape.js")],
        autoGate: false,
      });
      const prepared = writePrepare({
        actorId: agentA,
        taskId,
        resources: [fileResource("linked/escape.js")],
        intent: WriteIntent.MODIFY,
      });
      symlinkSync(outsideRoot, path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");

      expect(() => writeApply({
        permitId: prepared.permit.id,
        mutations: [{ resource: fileResource("linked/escape.js"), content: "escaped" }],
      })).toThrow(/outside guarded root/i);

      expect(readFileIfExists(path.join(outsideRoot, "escape.js"))).toBeNull();
      expect(repo.getWritePermit(prepared.permit.id).status).toBe("revoked");
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

function readFileIfExists(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}
