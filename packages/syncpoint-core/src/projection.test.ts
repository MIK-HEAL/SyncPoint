/**
 * P3A — Pure unit tests for Projection Compiler.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  compileProjection,
  computeProjectionCacheKey,
  computeContentHash,
  resolveProjectionRoute,
  registerScopeMatcher,
  clearScopeMatcherRegistry,
  type ProjectionInput,
  type ProjectionContext,
} from "./projection.ts";

// Register prefix/glob scope matchers so appliesTo filtering works like a real plugin
beforeEach(() => {
  clearScopeMatcherRegistry();
  const prefixFindOverlaps = (patterns: string[], targets: string[]): string[] =>
    targets.filter(t =>
      patterns.some(p => {
        const prefix = p.replace(/\*\*?\/?$/, "");
        return t === p || t.startsWith(prefix);
      }),
    );
  registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps });
  registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps });
});

function makeCtx(overrides?: Partial<ProjectionContext>): ProjectionContext {
  return {
    taskId: "task-1",
    memoryVersion: 1,
    workingResources: [],
    currentModules: [],
    ...overrides,
  };
}

function makeMem(overrides?: Partial<ProjectionInput>): ProjectionInput {
  return {
    id: `mem-${Math.random().toString(36).slice(2, 8)}`,
    category: "decision",
    title: "Test Memory",
    content: "Test content.",
    fingerprint: `fp-${Math.random().toString(36).slice(2, 10)}`,
    kind: "fact",
    projectionTarget: null,
    appliesTo: "",
    severity: "info",
    validityStatus: "fresh",
    ...overrides,
  };
}

describe("compileProjection — kind→bucket mapping", () => {
  it("fact → capsulePatch.verifiedFacts", () => {
    const r = compileProjection([makeMem({ kind: "fact" })], makeCtx());
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("soft_convention → capsulePatch.activeConstraints", () => {
    const r = compileProjection([makeMem({ kind: "soft_convention" })], makeCtx());
    expect(r.capsulePatch.activeConstraints).toHaveLength(1);
  });

  it("risk → capsulePatch.risks", () => {
    const r = compileProjection([makeMem({ kind: "risk" })], makeCtx());
    expect(r.capsulePatch.risks).toHaveLength(1);
  });

  it("do_not_touch → capsulePatch.doNotTouch", () => {
    const r = compileProjection([makeMem({ kind: "do_not_touch" })], makeCtx());
    expect(r.capsulePatch.doNotTouch).toHaveLength(1);
  });

  it("hard_constraint → constraintRules", () => {
    const r = compileProjection([makeMem({ kind: "hard_constraint" })], makeCtx());
    expect(r.constraintRules).toHaveLength(1);
  });

  it("protocol_rule → protocolRules", () => {
    const r = compileProjection([makeMem({ kind: "protocol_rule" })], makeCtx());
    expect(r.protocolRules).toHaveLength(1);
  });
});

describe("compileProjection — traceability", () => {
  it("every item has sourceMemoryId and projectionReason", () => {
    const mem = makeMem({ kind: "fact", id: "mem-trace" });
    const r = compileProjection([mem], makeCtx());
    const item = r.capsulePatch.verifiedFacts[0];
    expect(item.source.sourceMemoryId).toBe("mem-trace");
    expect(item.source.projectionReason).toContain("fact");
  });

  it("createdFrom contains taskId and memoryVersion", () => {
    const r = compileProjection([], makeCtx({ taskId: "t-42", memoryVersion: 7 }));
    expect(r.createdFrom.taskId).toBe("t-42");
    expect(r.createdFrom.memoryVersion).toBe(7);
  });

  it("projectionId is non-empty", () => {
    const r = compileProjection([], makeCtx());
    expect(r.projectionId).toBeTruthy();
    expect(r.projectionId.length).toBeGreaterThan(0);
  });
});

describe("compileProjection — validity gating", () => {
  it("skips invalid memories", () => {
    const mem = makeMem({ validityStatus: "invalid", kind: "fact" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.verifiedFacts).toHaveLength(0);
    expect(r.skippedStale).toHaveLength(1);
    expect(r.skippedStale[0].sourceMemoryId).toBe(mem.id);
  });

  it("skips stale memories", () => {
    const mem = makeMem({ validityStatus: "stale", kind: "risk" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.risks).toHaveLength(0);
    expect(r.skippedStale).toHaveLength(1);
  });

  it("includes needs_revalidation but degrades projectionValidity", () => {
    const mem = makeMem({ validityStatus: "needs_revalidation", kind: "fact" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
    expect(r.projectionValidity).toBe("needs_revalidation");
  });

  it("fresh-only projection yields fresh validity", () => {
    const r = compileProjection([makeMem({ validityStatus: "fresh" })], makeCtx());
    expect(r.projectionValidity).toBe("fresh");
  });
});

describe("compileProjection — appliesTo filtering", () => {
  it("includes memory with no appliesTo (project-wide)", () => {
    const mem = makeMem({ appliesTo: "" });
    const r = compileProjection([mem], makeCtx({ workingResources: ["src/foo.ts"] }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("includes memory whose file scope matches working files", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["src/**"] }) });
    const r = compileProjection([mem], makeCtx({ workingResources: ["src/main.ts"] }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("excludes memory whose file scope does NOT match working files", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["test/**"] }) });
    const r = compileProjection([mem], makeCtx({ workingResources: ["src/main.ts"] }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(0);
  });

  it("includes memory whose module scope matches", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ modules: ["core"] }) });
    const r = compileProjection([mem], makeCtx({ currentModules: ["core"] }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("excludes memory whose module scope does NOT match", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ modules: ["ui"] }) });
    const r = compileProjection([mem], makeCtx({ currentModules: ["core"] }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(0);
  });
});

describe("compileProjection — resource-type-aware appliesTo filtering", () => {
  beforeEach(() => {
    clearScopeMatcherRegistry();
    const prefixFindOverlaps = (patterns: string[], targets: string[]): string[] =>
      targets.filter(t =>
        patterns.some(p => {
          const prefix = p.replace(/\*\*?\/?$/, "");
          return t === p || t.startsWith(prefix);
        }),
      );
    // Register with resourceTypes: ["file"] like the real code plugin
    registerScopeMatcher({ field: "files", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });
    registerScopeMatcher({ field: "modules", findOverlaps: prefixFindOverlaps, resourceTypes: ["file"] });
  });

  it("excludes file-scoped memory when only non-file resources are working", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["src/auth/"] }) });
    const r = compileProjection([mem], makeCtx({
      workingResources: ["src/auth/logo.png"],
      workingResourceRefs: [{ type: "binary_asset", locator: "src/auth/logo.png", metadata: "" }],
    }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(0);
  });

  it("includes file-scoped memory when file resources are working", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["src/auth/"] }) });
    const r = compileProjection([mem], makeCtx({
      workingResources: ["src/auth/session.ts"],
      workingResourceRefs: [{ type: "file", locator: "src/auth/session.ts", metadata: "" }],
    }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("mixed resources: file-scoped memory included only due to file resource", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["src/auth/"] }) });
    const r = compileProjection([mem], makeCtx({
      workingResources: ["src/auth/session.ts", "src/auth/logo.png"],
      workingResourceRefs: [
        { type: "file", locator: "src/auth/session.ts", metadata: "" },
        { type: "binary_asset", locator: "src/auth/logo.png", metadata: "" },
      ],
    }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("module-scoped memory still uses currentModules when typed resources are provided", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ modules: ["core"] }) });
    const r = compileProjection([mem], makeCtx({
      currentModules: ["core"],
      workingResources: ["src/unrelated.ts"],
      workingResourceRefs: [{ type: "file", locator: "src/unrelated.ts", metadata: "" }],
    }));
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });

  it("falls back to string-only matching when workingResourceRefs not provided", () => {
    const mem = makeMem({ appliesTo: JSON.stringify({ files: ["src/auth/"] }) });
    // No workingResourceRefs — should fall back to scopeContext (all locators)
    const r = compileProjection([mem], makeCtx({
      workingResources: ["src/auth/logo.png"],
    }));
    // Without resourceRefs, the locator text matches — backward compat
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
  });
});

describe("compileProjection — conflict detection", () => {
  it("detects scope_collision between two constraint rules", () => {
    const a = makeMem({
      kind: "hard_constraint",
      id: "c1",
      appliesTo: JSON.stringify({ files: ["src/db.ts"] }),
    });
    const b = makeMem({
      kind: "hard_constraint",
      id: "c2",
      appliesTo: JSON.stringify({ files: ["src/db.ts"] }),
    });
    const r = compileProjection([a, b], makeCtx({ workingResources: ["src/db.ts"] }));
    expect(r.constraintRules).toHaveLength(2);
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].kind).toBe("scope_collision");
  });

  it("no conflict when scopes don't overlap", () => {
    const a = makeMem({
      kind: "hard_constraint",
      id: "c3",
      appliesTo: JSON.stringify({ files: ["src/a.ts"] }),
    });
    const b = makeMem({
      kind: "hard_constraint",
      id: "c4",
      appliesTo: JSON.stringify({ files: ["src/b.ts"] }),
    });
    const r = compileProjection([a, b], makeCtx({ workingResources: ["src/a.ts", "src/b.ts"] }));
    expect(r.conflicts).toHaveLength(0);
  });

  it("conflicts degrade projectionValidity to needs_revalidation", () => {
    const a = makeMem({
      kind: "protocol_rule",
      id: "p1",
      appliesTo: JSON.stringify({ files: ["src/**"] }),
    });
    const b = makeMem({
      kind: "protocol_rule",
      id: "p2",
      appliesTo: JSON.stringify({ files: ["src/**"] }),
    });
    const r = compileProjection([a, b], makeCtx({ workingResources: ["src/x.ts"] }));
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.projectionValidity).toBe("needs_revalidation");
  });
});

describe("computeProjectionCacheKey", () => {
  it("same inputs produce same key", () => {
    const fps = ["fp1", "fp2"];
    const ctx = makeCtx({ memoryVersion: 3, capsuleHash: "h1" });
    const k1 = computeProjectionCacheKey(ctx, fps);
    const k2 = computeProjectionCacheKey(ctx, fps);
    expect(k1).toBe(k2);
  });

  it("different memoryVersion changes key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ memoryVersion: 1 }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ memoryVersion: 2 }), fps);
    expect(k1).not.toBe(k2);
  });

  it("different taskId changes key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ taskId: "a" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ taskId: "b" }), fps);
    expect(k1).not.toBe(k2);
  });

  it("different fingerprints change key", () => {
    const ctx = makeCtx();
    const k1 = computeProjectionCacheKey(ctx, ["fp1"]);
    const k2 = computeProjectionCacheKey(ctx, ["fp2"]);
    expect(k1).not.toBe(k2);
  });

  // PR1: cache key uses hashes, not IDs
  it("same-content-different-ID produces same key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ capsuleId: "cap-aaa", capsuleHash: "hash-x" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ capsuleId: "cap-bbb", capsuleHash: "hash-x" }), fps);
    expect(k1).toBe(k2);
  });

  it("same-ID-different-content changes key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ capsuleId: "cap-1", capsuleHash: "hash-old" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ capsuleId: "cap-1", capsuleHash: "hash-new" }), fps);
    expect(k1).not.toBe(k2);
  });

  it("checkpointHash change affects key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ checkpointHash: "a" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ checkpointHash: "b" }), fps);
    expect(k1).not.toBe(k2);
  });

  it("contractHash change affects key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ contractHash: "v1" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ contractHash: "v2" }), fps);
    expect(k1).not.toBe(k2);
  });

  it("createdFrom still tracks IDs even though key ignores them", () => {
    const ctx = makeCtx({ capsuleId: "cap-42", checkpointId: "cp-7", contractId: "con-1" });
    const r = compileProjection([], ctx);
    expect(r.createdFrom.capsuleId).toBe("cap-42");
    expect(r.createdFrom.checkpointId).toBe("cp-7");
    expect(r.createdFrom.contractId).toBe("con-1");
  });
});

describe("computeContentHash", () => {
  it("same fields produce same hash", () => {
    expect(computeContentHash("a", "b")).toBe(computeContentHash("a", "b"));
  });

  it("different fields produce different hash", () => {
    expect(computeContentHash("a", "b")).not.toBe(computeContentHash("a", "c"));
  });

  it("returns 16-char hex string", () => {
    const h = computeContentHash("test");
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("compileProjection — mixed scenario", () => {
  it("compiles a realistic mixed memory set", () => {
    const memories: ProjectionInput[] = [
      makeMem({ id: "m1", kind: "fact", title: "TypeScript", content: "We use TS", validityStatus: "fresh" }),
      makeMem({ id: "m2", kind: "risk", title: "Memory leak", content: "Watch for leaks", validityStatus: "fresh", severity: "warning" }),
      makeMem({ id: "m3", kind: "hard_constraint", title: "No eval", content: "eval() is banned", validityStatus: "fresh", severity: "blocking" }),
      makeMem({ id: "m4", kind: "protocol_rule", title: "Review gate", content: "All PRs need review", validityStatus: "fresh" }),
      makeMem({ id: "m5", kind: "do_not_touch", title: "Legacy DB", content: "Do not touch db.ts", validityStatus: "fresh", appliesTo: JSON.stringify({ files: ["src/db.ts"] }) }),
      makeMem({ id: "m6", kind: "fact", title: "Stale fact", content: "Outdated", validityStatus: "stale" }),
      makeMem({ id: "m7", kind: "soft_convention", title: "UI only", content: "UI convention", validityStatus: "fresh", appliesTo: JSON.stringify({ modules: ["ui"] }) }),
    ];
    const ctx = makeCtx({ workingResources: ["src/main.ts"], currentModules: ["core"] });
    const r = compileProjection(memories, ctx);

    // m1 → verifiedFacts
    expect(r.capsulePatch.verifiedFacts).toHaveLength(1);
    expect(r.capsulePatch.verifiedFacts[0].source.sourceMemoryId).toBe("m1");
    // m2 → risks
    expect(r.capsulePatch.risks).toHaveLength(1);
    // m3 → constraintRules
    expect(r.constraintRules).toHaveLength(1);
    // m4 → protocolRules
    expect(r.protocolRules).toHaveLength(1);
    // m5 → doNotTouch EXCLUDED (file scope src/db.ts doesn't match src/main.ts)
    expect(r.capsulePatch.doNotTouch).toHaveLength(0);
    // m6 → skipped (stale)
    expect(r.skippedStale.some(s => s.sourceMemoryId === "m6")).toBe(true);
    // m7 → excluded (module ui not in current modules core)
    expect(r.capsulePatch.activeConstraints).toHaveLength(0);
    // Overall validity fresh (no needs_revalidation sources included)
    expect(r.projectionValidity).toBe("fresh");
  });
});

// ── PR2: resolveProjectionRoute tests ─────────────────────

describe("resolveProjectionRoute", () => {
  it("default: fact → verifiedFacts", () => {
    const r = resolveProjectionRoute("fact", null);
    expect(r.buckets).toEqual(["verifiedFacts"]);
  });

  it("default: hard_constraint → constraintRules", () => {
    const r = resolveProjectionRoute("hard_constraint", null);
    expect(r.buckets).toEqual(["constraintRules"]);
  });

  it("default: protocol_rule → protocolRules", () => {
    const r = resolveProjectionRoute("protocol_rule", null);
    expect(r.buckets).toEqual(["protocolRules"]);
  });

  it("default: do_not_touch → dual-write doNotTouch + constraintRules", () => {
    const r = resolveProjectionRoute("do_not_touch", null);
    expect(r.buckets).toEqual(["doNotTouch", "constraintRules"]);
    expect(r.reason).toContain("dual-write");
  });

  it("explicit target: risk → constraint_runtime routes to constraintRules", () => {
    const r = resolveProjectionRoute("risk", "constraint_runtime");
    expect(r.buckets).toEqual(["constraintRules"]);
    expect(r.reason).toContain("explicit target");
  });

  it("explicit target: risk → capsule routes to risks", () => {
    const r = resolveProjectionRoute("risk", "capsule");
    expect(r.buckets).toEqual(["risks"]);
    expect(r.reason).toContain("explicit target: capsule");
  });

  it("explicit target: fact → protocol_gate routes to protocolRules", () => {
    const r = resolveProjectionRoute("fact", "protocol_gate");
    expect(r.buckets).toEqual(["protocolRules"]);
  });

  it("explicit target: do_not_touch → capsule does NOT dual-write", () => {
    const r = resolveProjectionRoute("do_not_touch", "capsule");
    expect(r.buckets).toEqual(["doNotTouch"]);
    expect(r.buckets).not.toContain("constraintRules");
  });

  it("explicit target: do_not_touch → constraint_runtime only constraintRules", () => {
    const r = resolveProjectionRoute("do_not_touch", "constraint_runtime");
    expect(r.buckets).toEqual(["constraintRules"]);
    expect(r.buckets).not.toContain("doNotTouch");
  });

  it("unknown target falls through to default routing", () => {
    const r = resolveProjectionRoute("fact", "unknown_target");
    expect(r.buckets).toEqual(["verifiedFacts"]);
  });
});

describe("compileProjection — target routing integration", () => {
  it("risk with projectionTarget=constraint_runtime goes to constraintRules not risks", () => {
    const mem = makeMem({ kind: "risk", projectionTarget: "constraint_runtime" });
    const r = compileProjection([mem], makeCtx());
    expect(r.constraintRules).toHaveLength(1);
    expect(r.capsulePatch.risks).toHaveLength(0);
  });

  it("risk with projectionTarget=capsule goes to risks (same as default)", () => {
    const mem = makeMem({ kind: "risk", projectionTarget: "capsule" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.risks).toHaveLength(1);
    expect(r.constraintRules).toHaveLength(0);
  });

  it("do_not_touch with projectionTarget=capsule → doNotTouch only (no constraintRules)", () => {
    const mem = makeMem({ kind: "do_not_touch", projectionTarget: "capsule" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.doNotTouch).toHaveLength(1);
    expect(r.constraintRules).toHaveLength(0);
  });

  it("do_not_touch with projectionTarget=constraint_runtime → constraintRules only", () => {
    const mem = makeMem({ kind: "do_not_touch", projectionTarget: "constraint_runtime" });
    const r = compileProjection([mem], makeCtx());
    expect(r.constraintRules).toHaveLength(1);
    expect(r.capsulePatch.doNotTouch).toHaveLength(0);
  });

  it("do_not_touch without target → dual-write (backward compat)", () => {
    const mem = makeMem({ kind: "do_not_touch" });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.doNotTouch).toHaveLength(1);
    expect(r.constraintRules).toHaveLength(1);
  });

  it("projectionReason includes target info when target is explicit", () => {
    const mem = makeMem({ kind: "risk", projectionTarget: "constraint_runtime" });
    const r = compileProjection([mem], makeCtx());
    expect(r.constraintRules[0].source.projectionReason).toContain("explicit target");
  });

  it("null projectionTarget uses default kind→bucket reason", () => {
    const mem = makeMem({ kind: "fact", projectionTarget: null });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.verifiedFacts[0].source.projectionReason).toContain("fact →");
  });
});

// ── P1: Cache hash contract regression tests ──────────────

describe("P1: Cache key hash contract hardening", () => {
  it("IDs do NOT affect cache key — capsuleId variation", () => {
    const fps = ["fp-stable"];
    const ctx1 = makeCtx({ capsuleId: "id-aaa", capsuleHash: "hash-same" });
    const ctx2 = makeCtx({ capsuleId: "id-bbb", capsuleHash: "hash-same" });
    expect(computeProjectionCacheKey(ctx1, fps)).toBe(computeProjectionCacheKey(ctx2, fps));
  });

  it("IDs do NOT affect cache key — checkpointId variation", () => {
    const fps = ["fp-stable"];
    const ctx1 = makeCtx({ checkpointId: "cp-1", checkpointHash: "hash-same" });
    const ctx2 = makeCtx({ checkpointId: "cp-2", checkpointHash: "hash-same" });
    expect(computeProjectionCacheKey(ctx1, fps)).toBe(computeProjectionCacheKey(ctx2, fps));
  });

  it("IDs do NOT affect cache key — contractId variation", () => {
    const fps = ["fp-stable"];
    const ctx1 = makeCtx({ contractId: "con-x", contractHash: "hash-same" });
    const ctx2 = makeCtx({ contractId: "con-y", contractHash: "hash-same" });
    expect(computeProjectionCacheKey(ctx1, fps)).toBe(computeProjectionCacheKey(ctx2, fps));
  });

  it("content hash changes DO affect cache key", () => {
    const fps = ["fp-stable"];
    const k1 = computeProjectionCacheKey(makeCtx({ capsuleHash: "v1" }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ capsuleHash: "v2" }), fps);
    expect(k1).not.toBe(k2);
  });

  it("fingerprint changes DO affect cache key", () => {
    const ctx = makeCtx();
    const k1 = computeProjectionCacheKey(ctx, ["fp-a"]);
    const k2 = computeProjectionCacheKey(ctx, ["fp-b"]);
    expect(k1).not.toBe(k2);
  });

  it("working file changes DO affect cache key", () => {
    const fps = ["fp1"];
    const k1 = computeProjectionCacheKey(makeCtx({ workingResources: ["a.ts"] }), fps);
    const k2 = computeProjectionCacheKey(makeCtx({ workingResources: ["b.ts"] }), fps);
    expect(k1).not.toBe(k2);
  });

  it("compiled projection uses content hashes in cache key", () => {
    const mem = makeMem({ kind: "fact" });
    const ctx1 = makeCtx({ capsuleId: "cap-1", capsuleHash: "hash-same" });
    const ctx2 = makeCtx({ capsuleId: "cap-2", capsuleHash: "hash-same" });
    const r1 = compileProjection([mem], ctx1);
    const r2 = compileProjection([mem], ctx2);
    expect(r1.cacheKey).toBe(r2.cacheKey);
  });

  it("compiled projection cacheKey changes when content hash changes", () => {
    const mem = makeMem({ kind: "fact" });
    const ctx1 = makeCtx({ capsuleHash: "old-hash" });
    const ctx2 = makeCtx({ capsuleHash: "new-hash" });
    const r1 = compileProjection([mem], ctx1);
    const r2 = compileProjection([mem], ctx2);
    expect(r1.cacheKey).not.toBe(r2.cacheKey);
  });

  it("createdFrom still tracks IDs for audit trail", () => {
    const ctx = makeCtx({ capsuleId: "cap-A", checkpointId: "cp-B", contractId: "con-C" });
    const r = compileProjection([], ctx);
    expect(r.createdFrom.capsuleId).toBe("cap-A");
    expect(r.createdFrom.checkpointId).toBe("cp-B");
    expect(r.createdFrom.contractId).toBe("con-C");
  });
});

// ── P3: projectionTarget as authoritative routing contract ──

describe("P3: projectionTarget authoritative routing", () => {
  it("explicit capsule target overrides default kind routing for fact", () => {
    const route = resolveProjectionRoute("fact", "capsule");
    expect(route.reason).toContain("explicit target: capsule");
  });

  it("explicit protocol_gate target overrides default routing for fact", () => {
    const route = resolveProjectionRoute("fact", "protocol_gate");
    expect(route.buckets).toEqual(["protocolRules"]);
    expect(route.reason).toContain("explicit target");
  });

  it("explicit constraint_runtime target overrides default routing for soft_convention", () => {
    const route = resolveProjectionRoute("soft_convention", "constraint_runtime");
    expect(route.buckets).toEqual(["constraintRules"]);
    expect(route.reason).toContain("explicit target");
  });

  it("hard_constraint with explicit protocol_gate routes to protocolRules", () => {
    const route = resolveProjectionRoute("hard_constraint", "protocol_gate");
    expect(route.buckets).toEqual(["protocolRules"]);
  });

  it("hard_constraint without target defaults to constraintRules", () => {
    const route = resolveProjectionRoute("hard_constraint", null);
    expect(route.buckets).toEqual(["constraintRules"]);
  });

  it("do_not_touch without target dual-writes to doNotTouch + constraintRules", () => {
    const route = resolveProjectionRoute("do_not_touch", null);
    expect(route.buckets).toContain("doNotTouch");
    expect(route.buckets).toContain("constraintRules");
    expect(route.buckets.length).toBe(2);
  });

  it("do_not_touch with explicit capsule target routes to capsule bucket only", () => {
    const route = resolveProjectionRoute("do_not_touch", "capsule");
    expect(route.buckets.length).toBe(1);
    expect(route.reason).toContain("explicit target: capsule");
  });

  it("explicit target actually controls compiled projection bucket", () => {
    // fact with explicit protocol_gate → should appear in protocolRules, NOT capsulePatch
    const mem = makeMem({ kind: "fact", projectionTarget: "protocol_gate" });
    const r = compileProjection([mem], makeCtx());
    expect(r.protocolRules.length).toBe(1);
    expect(r.capsulePatch.verifiedFacts.length).toBe(0);
  });

  it("protocol_rule with explicit constraint_runtime → constraintRules", () => {
    const mem = makeMem({ kind: "protocol_rule", projectionTarget: "constraint_runtime" });
    const r = compileProjection([mem], makeCtx());
    expect(r.constraintRules.length).toBe(1);
    expect(r.protocolRules.length).toBe(0);
  });

  it("null target falls back to kind-based routing", () => {
    const mem = makeMem({ kind: "risk", projectionTarget: null });
    const r = compileProjection([mem], makeCtx());
    expect(r.capsulePatch.risks.length).toBe(1);
  });
});
