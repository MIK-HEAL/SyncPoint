# SyncPoint — Reality Runtime Architecture

> **Status**: Implemented — P0 through P4 complete
> **Scope**: Memory → Executable Layered Reality upgrade

---

## 1. Problem

The current system conflates four distinct concerns into prompt material:

- **Project Memory** — long-lived project knowledge (architecture, decisions, conventions) is stored as flat Markdown and injected as-is into agent prompts. Duplicates accumulate. There is no versioning, no dedup, no schema for distinguishing hard constraints from soft conventions.

- **Context Capsule** — the agent's working snapshot. It captures the right fields (goal, phase, files, blockers), but nothing prevents stale capsules from being trusted, and there is no mechanism to inject only the *relevant* subset of project memory into a capsule.

- **Checkpoint** — a progress record. Currently treated as evidence but not as a structured input to reality compilation. Checkpoints and capsules have no formal freshness relationship beyond timestamp comparison.

- **Peer Contract / Protocol Gate** — collaboration rules exist but live alongside capsule content. Hard constraints (do-not-touch, file boundaries) can only be expressed as prompt text — they cannot block execution.

The result:

| Symptom | Root cause |
|---------|-----------|
| Agents act on stale reality | No projection validity lifecycle |
| Duplicate project memories pollute context | No fingerprint / dedup / supersedes |
| Hard constraints ignored | Constraints are prompt text, not executable gates |
| Conflicts silently merged | No explicit conflict surface |
| History material re-contaminates current context | No projection filter between long-term memory and working context |

---

## 2. Core Thesis

```
Reality is runtime state. Prompt is only a view of reality.
```

The prompt an agent receives must be a **compiled projection** of current reality — not a concatenation of stored materials. Compilation means: filter, scope, validate, detect conflicts, enforce constraints, and cache.

---

## 3. Layered Reality Architecture

Five layers, strict separation:

```
┌──────────────────────────────────────────────┐
│  Project Memory         Long-term reality    │ ← source of truth
│                         source code          │
├──────────────────────────────────────────────┤
│  Projection Layer       Reality Compiler     │ ← reads memory + task state,
│                                              │    outputs ProjectedReality
├──────────────────────────────────────────────┤
│  Context Capsule        Current task         │ ← agent's working snapshot,
│                         reality mirror       │    patched by projection
├──────────────────────────────────────────────┤
│  Protocol Gate          Collaboration        │ ← hard/soft rules from contract,
│                         boundary             │    claims, gates, transactions
├──────────────────────────────────────────────┤
│  Constraint Runtime     Reality enforcer     │ ← blocks execution when reality
│                                              │    is violated
└──────────────────────────────────────────────┘
```

**Data flow**:

```
Project Memory (versioned, deduped, typed)
        │
        ▼
  Projection Layer  ◄── task, capsule, checkpoint, contract, workingResources
        │
        ▼
  ProjectedReality {
    capsulePatch        → merged into Context Capsule
    protocolRules       → fed to Protocol Gate
    constraintRules     → fed to Constraint Runtime
    conflicts           → surfaced explicitly
    projectionValidity  → lifecycle management
  }
        │
        ├──► Context Capsule (patched)  → agent prompt
        ├──► Protocol Gate (enriched)   → agent prompt + blocking logic
        └──► Constraint Runtime         → execution permit / deny
```

**Layer responsibilities**:

| Layer | Reads | Writes | Never does |
|-------|-------|--------|------------|
| Project Memory | — | memory CRUD | prompt generation |
| Projection Layer | memory, task state, capsule, checkpoint, contract | ProjectedReality | direct DB writes, prompt formatting |
| Context Capsule | projected patch | capsule state | constraint enforcement |
| Protocol Gate | rules from projection + existing gate sources | gate summary | memory retrieval |
| Constraint Runtime | projected constraints + protocol state | permit/deny decision | prompt content |

---

## 4. Projection Principles

Five invariants that the Projection Layer must enforce:

### 4.1 Minimal Reality

> Only project what the agent needs for the current task scope.

Memory entries with `appliesTo` that don't match the task's files/modules/taskType are excluded. The agent never sees the full memory corpus.

### 4.2 Traceable Reality

> Every projected item carries `sourceMemoryId` and `projectionReason`.

When the agent acts on a convention or constraint, audit can trace it back to the exact project memory entry that caused the projection.

### 4.3 Explicit Conflict

> Conflicting projections are never silently merged.

If two approved memories contradict (e.g., one says "use SQL" and another says "use ORM-only"), the conflict is surfaced as a `ProjectionConflict` with both sources. The agent must see it. The Constraint Runtime may block on it.

### 4.4 Auditable Projection

> ProjectedReality records `createdFrom` so any projection can be reproduced.

```ts
createdFrom: {
  taskId: string
  capsuleId: string
  checkpointId: string
  contractId: string
  memoryVersion: number
}
```

`capsuleId` and `checkpointId` are the specific entity IDs used — for audit trail reconstruction.

### 4.5 Reality Freshness

> Projections have a validity lifecycle; they are not immortal.

A projection starts `fresh`, may become `needs_revalidation` when signals arrive, decays to `stale` when known-outdated, and becomes `invalid` when conflicting with current state. The system never mechanically recompiles on every checkpoint, but never blindly trusts old projections either.

---

## 5. ProjectedReality Schema

Core output of the Projection Layer:

```ts
interface ProjectedReality {
  /** Unique projection identifier */
  projectionId: string

  /** Audit trail — which inputs produced this projection */
  createdFrom: {
    taskId: string
    capsuleId: string
    checkpointId: string
    contractId: string
    memoryVersion: number
  }

  /**
   * Cache key for hit/miss determination.
   * Uses hashes (not IDs) of capsule/checkpoint content.
   * IDs change even when content is identical; hashes don't.
   */
  cacheKey: string  // hash(memoryVersion + taskId + workingResourcesHash + contractVersion + checkpointHash + capsuleHash)

  /** Items to merge into the agent's Context Capsule */
  capsulePatch: ProjectedItem[]

  /** Rules to feed to Protocol Gate */
  protocolRules: ProjectedItem[]

  /** Constraints to feed to Constraint Runtime */
  constraintRules: ProjectedItem[]

  /** Unresolved conflicts that must be surfaced */
  conflicts: ProjectionConflict[]

  /** Current validity of this projection */
  projectionValidity: ProjectionValidity
}
```

Supporting types:

```ts
interface ProjectedItem {
  text: string
  sourceMemoryId: string
  projectionReason: string
  confidence: "low" | "medium" | "high"
}

interface ProjectionConflict {
  type: "contradiction" | "scope_overlap" | "constraint_clash"
  sources: string[]          // memory IDs
  description: string
  severity: "info" | "warning" | "blocking"
}
```

---

## 6. Projection Cache

### Cache key design

```
cacheKey = hash(
  memoryVersion +
  taskId +
  workingResourcesHash +
  contractVersion +
  checkpointHash +
  capsuleHash
)
```

**Why hashes, not IDs, for checkpoint/capsule?**

- `checkpointId` / `capsuleId` → used in `createdFrom` for **audit trail** (which exact entity was used).
- `checkpointHash` / `capsuleHash` → used in `cacheKey` for **cache hit** determination (has the content actually changed?).

An agent may create a new checkpoint with the same content — the ID changes but the hash doesn't. The projection cache should hit in that case.

### Cache invalidation signals

| Signal | Effect on cached projection |
|--------|-----------------------------|
| New project memory approved | `needs_revalidation` |
| Memory deprecated or superseded | `needs_revalidation` |
| New checkpoint with different hash | `needs_revalidation` |
| New capsule with different hash | `needs_revalidation` |
| Contract version changed | `stale` |
| Memory version bumped | `stale` |
| Projection conflict detected | `invalid` |
| Protocol gate hard block appeared | `invalid` |

---

## 7. Projection Validity

```ts
type ProjectionValidityStatus =
  | "fresh"
  | "needs_revalidation"
  | "stale"
  | "invalid"
```

### Semantics

| Status | Meaning | Agent action |
|--------|---------|--------------|
| `fresh` | Projection is current and trustworthy | Use directly |
| `needs_revalidation` | Change signal detected but impact unknown | Lightweight recheck before use |
| `stale` | Known outdated — should not be trusted as primary reality | Recompile before use |
| `invalid` | Conflicts with current state — dangerous to use | Block or force recompile |

### Lifecycle

```
fresh ──► needs_revalidation ──► stale ──► invalid
  ▲              │                  │          │
  │              ▼                  ▼          ▼
  └────── recompile ◄─────── recompile ◄── recompile
```

A fresh projection stays fresh until an invalidation signal arrives. The system checks signals lazily (on access) or eagerly (on event), depending on configuration.

**Key design constraint**: The system must NOT recompile on every checkpoint. It must NOT trust old projections blindly. Projection Validity is the mechanism that balances these two forces.

---

## 8. Implementation Roadmap

### P0: Permission & Path Security ✅

**Goal**: Close security holes before building new architecture.

**Implemented**:
- `requireCallerIdentity()` guard on all 5 mutation functions in `project-memory-service.ts`
- `CallerIdentityError` thrown when `createdBy`/`updatedBy`/`callerBy` is missing
- `validateExportPath()` restricts export to `.syncpoint/` or direct children of project root
- tRPC inputs enforce `z.string().min(1)` on all caller identity fields
- CLI uses `--by` as `requiredOption` on all write commands
- MCP auto-resolves via `resolveBoundAgentId()`

**Tests**: 13 in `p0-security.test.ts`

---

### P1: Project Memory Dedup & Governance ✅

**Goal**: Long-term memory stops being a pile of duplicate Markdown notes.

**Implemented**:
- `computeMemoryFingerprint(category, title, content)` — SHA-256 hash (32 hex chars)
- `DuplicateMemoryError` thrown on collision; deprecated memories don't block
- `supersedeProjectMemory(newId, oldId, updatedBy)` — deprecates old, links chain
- `memory_version` table — global counter, bumps on approve/deprecate/supersede
- `collectProjectMemories()` excludes superseded, deduplicates by fingerprint
- Exposed via tRPC, CLI (`knowledge supersede`, `knowledge version`), MCP tools

**Tests**: 7 core fingerprint + 15 server in `p1-governance.test.ts`

---

### P2: Project Memory Schema V2 ✅

**Goal**: Upgrade memory from plain text to projectable source code.

**Implemented fields**:

```ts
kind:       MemoryKind        // fact | soft_convention | risk | do_not_touch | hard_constraint | protocol_rule
appliesTo:  AppliesToSchema   // { files?: string[], modules?: string[], taskTypes?: string[] }
projectionTarget: ProjectionTarget  // capsule | protocol_gate | constraint_runtime
severity:   MemorySeverity    // info | warning | blocking
validity:   ValiditySchema    // { status: ValidityStatus, staleReason?: string }
```

**Routing rules** (enforced in `reality-projection.ts` compiler):

```
fact                  → capsulePatch.verifiedFacts
soft_convention       → capsulePatch.activeConstraints
risk                  → capsulePatch.risks
do_not_touch          → capsulePatch.doNotTouch + constraintRules
hard_constraint       → protocolRules + constraintRules
protocol_rule         → protocolRules
```

**Guards**: `InvalidProjectionError` thrown when `hard_constraint`/`protocol_rule` targets capsule-only.  
**Files**: `project-memory.ts` (core enums/schemas), `schema.ts` + `db.ts` (DB migrations)  
**Tests**: 14 core + 12 server in `p2-schema-v2.test.ts`

---

### P3: Projection Service (Reality Compiler) ✅

**Goal**: The architectural core — compile long-term memory into task-scoped reality.

**P3A — Core Compiler** (`syncpoint-core/src/reality-projection.ts`):
- `compileProjection(memories, ctx)` — pure compiler, no I/O
- `computeProjectionCacheKey(ctx, fingerprints)` — stable hash for cache invalidation
- All five principles enforced: Minimal Reality, Traceable Reality, Explicit Conflict, Auditable Projection, Reality Freshness
- Kind→bucket routing, `appliesTo` scope filtering, `file_scope_collision` conflict detection
- Stale/invalid memories gated via `skippedStale`; `needs_revalidation` degrades `projectionValidity`

**P3A — Server Service** (`syncpoint-server/src/application/reality-projection-service.ts`):
- `buildProjection(ctx)` — orchestrates `collectProjectMemories` → `compileProjection`
- Auto-fetches `memoryVersion` from DB
- tRPC: `projectMemory.projection` query

**P3B — Raw PM Leak Closure**:
- 17 surfaces audited and sealed: raw `projectMemories` stripped from all agent-facing outputs
- `ctx.projectMemories = []` on every loop/resume/checkpoint/handoff/context path
- Regression tests verify `JSON.stringify(result)` contains no raw PM content

**Core types**: `ProjectedReality`, `ProjectionItem`, `ProjectionConflict`, `ProjectionSource`, `CapsulePatch`, `ProjectionCreatedFrom`, `ProjectionContext`

**Tests**: 26 core pure + 10 server integration (`p3a-projection.test.ts`, `p3b-projection-integration.test.ts`) + 3 context-policy leak tests

---

### P4: Constraint Evaluation Runtime ✅

**Goal**: Hard constraints become executable — they can block agent execution.

**P4A — Core Evaluator** (`syncpoint-core/src/constraint-evaluation.ts`):
- `evaluateConstraints(input): ConstraintDecision` — pure function, no I/O
- Core evaluators: `projection_invalid`, `projection_conflict`, `do_not_touch_scope_overlap`, `protocol_gate_blocked`, `snapshot_locked_invalid`, typed hard constraints, and advisory hard constraints
- Scope prefix matching for file overlap detection
- Returns `{ permitted, blockers[], warnings[], projectionId }`

**P4B — Operation Validation** (`operation-service.ts`):
- `opCheck()` runs registered `OperationValidator`s for the operation type/resource types
- Code patch validation is provided by `syncpoint-plugin-code`
- Constraint Runtime visibility for operation contexts is exposed through `constraintCheck(action: "operation_submit" | "operation_apply")`

**P4C — Execution Entry Points**:
- `loopResume` — capsule-locked mode throws; default mode returns `constraintWarnings[]`
- `orchStartAssignment` — throws on violation (uses agent's resource claims)
- `wakeStart` — throws on violation (uses latest capsule workingResources)
- `wakeNext` — returns `null` when constraint-blocked

**P4D — Visibility Layer** (`constraint-evaluation-service.ts`):
- `constraintCheck(input): ConstraintRuntimeView` — unified read-only query
- Input resolution per action: capsule workingResources, resource claims, operation touchedResources
- Output: projected refs only (no raw PM content), projection metadata, resolved inputs
- tRPC: `constraint.check` query
- MCP: `syncpoint_constraint_check` tool
- CLI: `syncpoint constraint check` command
- Snapshot: `constraintBlocked`, `constraintBlockerCount`, `constraintWarningCount` per agent

**Design principle**:

> **Capsule tells the agent what reality is.**  
> **Constraint Runtime decides whether the agent has execution permission.**

These are orthogonal concerns. A valid capsule does NOT imply permission to proceed. An execution permit does NOT imply the capsule is current.

**Tests**: covered by core constraint tests, server execution-entry tests, visibility tests, and Project Memory validator guard tests.

---

### P5: Documentation Realignment 🔄

**Goal**: Docs match the new architecture.

**Completed**:

```
docs/reality-runtime.md         ← this document (architecture + roadmap status)
docs/constraint-runtime.md      ← P4 constraint system: rules, enforcement, visibility
docs/ARCHITECTURE.md            ← layer boundary principles (updated with reality runtime)
```

**Existing related docs**:

```
docs/core-synchronization.md    ← sync truncation mechanics
docs/runtime-identity.md        ← P11 runtime binding
docs/review-workflow.md         ← review/approval gate
docs/session-playbook.md        ← session orchestration
```

---

## Design Boundaries

These invariants must be maintained across all phases:

1. **Capsule dominant ≠ protocol dominant.** `capsule-only` means the agent sees only its working context — it does NOT mean only protocol rules apply. Protocol Gate is always an external, independent layer.

2. **Checkpoint is evidence, not a substitute for capsule.** A checkpoint can validate a capsule but cannot replace it. Agents resume from capsules, not checkpoints.

3. **Project Memory projects reality but does not pollute context.** Raw memory entries never appear in agent prompts. Only compiled projections (filtered, scoped, traced) reach the capsule or gate.

4. **Hard constraints must enter gate/runtime, not just capsule.** A `hard_constraint` memory that only appears as capsule text is a bug. It must be a protocol rule AND a constraint runtime rule.

5. **Projection conflicts must be explicit.** Two contradicting memories cannot be silently resolved by the compiler. The conflict must surface as a `ProjectionConflict` visible to the agent and potentially blocking via the runtime.

---

## Implementation History

| Phase | Scope | Status | Tests |
|-------|-------|--------|-------|
| P0 | Security: caller identity + export path containment | ✅ | 13 |
| P1 | Memory fingerprint + dedup + supersedes + version | ✅ | 22 |
| P2 | Schema V2 fields (kind, appliesTo, severity, validity) | ✅ | 26 |
| P3A | Projection compiler (pure core + server service) | ✅ | 36 |
| P3B | Raw PM leak closure (17 surfaces sealed) | ✅ | 6 |
| P4A | Constraint evaluator (pure core, 6 rules) | ✅ | 24 |
| P4B | Operation validation and operation-context visibility | ✅ | see current test output |
| P4C | Execution entry points (loop/orch/wake blocking) | ✅ | 7 |
| P4D | Visibility layer (service + tRPC + MCP + CLI + snapshot) | ✅ | 17 |
| P5 | Documentation realignment | 🔄 | — |

Current package-level test counts are maintained by the test runner output rather than this historical architecture document.

---

## Summary

> Project Memory is long-term reality source code.  
> Projection Layer is the Reality Compiler.  
> Context Capsule is the current reality mirror.  
> Protocol Gate is the collaboration boundary.  
> Constraint Runtime is the reality enforcer.  
> Projection Cache / Validity / Freshness manages reality lifecycle.

This is not a memory feature plan. This is SyncPoint's **runtime reality architecture**.
