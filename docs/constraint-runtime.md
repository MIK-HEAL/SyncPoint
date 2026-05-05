# SyncPoint — Constraint Runtime

> **Status**: Implemented (P4A–P4D)  
> **Principle**: Capsule tells the agent what reality is. Constraint Runtime decides whether the agent has execution permission.

---

## Overview

The Constraint Runtime is the enforcement layer of SyncPoint's reality architecture. It consumes projected constraints from the Projection Layer and makes permit/deny decisions at every execution entry point. It is **not** a prompt — it is executable blocking logic.

```
Project Memory → Projection Layer → constraintRules → Constraint Runtime → permit / deny
```

---

## Architecture

### Core Evaluator

**File**: `syncpoint-core/src/constraint-runtime.ts`

Pure function, no I/O:

```ts
evaluateConstraints(input: ConstraintInput): ConstraintDecision
```

**Input**:

| Field | Type | Description |
|-------|------|-------------|
| `action` | `RuntimeAction` | `resume`, `start_assignment`, `wake_start`, `operation_submit`, `operation_apply` |
| `projection` | `ProjectedReality` | From `buildProjection()` — contains `constraintRules`, `conflicts`, `projectionValidity` |
| `touchedResources` | `ResourceRef[]` | Resources the agent will read/write in this action |

**Output** (`ConstraintDecision`):

| Field | Type | Description |
|-------|------|-------------|
| `permitted` | `boolean` | `false` if any blocker fires |
| `blockers` | `ConstraintViolation[]` | Hard blocks with rule, message, evidence, sourceMemoryId, projectionId |
| `warnings` | `ConstraintViolation[]` | Advisory notices (never block) |
| `projectionId` | `string` | Which projection was evaluated |

### Six Evaluation Rules

| Rule | Blocks? | Trigger |
|------|---------|---------|
| `projection_invalid` | Yes | Projection validity is `invalid` |
| `projection_conflict` | Yes | Unresolved `blocking` conflicts in projection |
| `do_not_touch_file_overlap` | Yes | `touchedResources` overlap with `do_not_touch` scope from `constraintRules` |
| `protocol_gate_blocked` | Yes | Active protocol gate blocks the action |
| `capsule_locked_invalid` | Yes | `capsule-locked` mode with failed capsule validation |
| `hard_constraint_advisory` | No | `hard_constraint` exists in projection (warning only) |

### Scope Matching

Resource overlap uses the registered `ScopeMatcher` for the scope field. For files, the built-in file scope matcher uses prefix matching:

- `"src/auth"` matches `"src/auth.ts"` and `"src/auth/session.ts"`
- `"src/auth/"` only matches resources **under** that directory (not `"src/auth.ts"`)

---

## Enforcement Entry Points (P4C)

The Constraint Runtime is called at every execution boundary:

| Entry Point | Action | workingResources Source | On Violation |
|-------------|--------|------------------------|-------------|
| `loopResume` | `resume` | Latest capsule `.workingResources` | capsule-locked: throws; default: `constraintWarnings[]` |
| `orchStartAssignment` | `start_assignment` | Agent's active resource claims | Throws `Error("Constraint violation: ...")` |
| `wakeStart` | `wake_start` | Latest capsule `.workingResources` | Throws |
| `wakeNext` | `wake_start` | Latest capsule `.workingResources` | Returns `null` (graceful skip) |
| `opCheck` | `operation_submit` | `operation.targetResources` | `constraintViolations[]` on check result |

All entry points use try/catch around `buildProjection` — if projection is unavailable, execution is **allowed** (graceful degradation, not silent failure).

---

## Visibility Layer (P4D)

### Service

**File**: `syncpoint-server/src/application/constraint-runtime-service.ts`

```ts
constraintCheck(input): ConstraintRuntimeView
```

Read-only unified query that reproduces P4C enforcement decisions exactly, without exposing raw Project Memory content.

**Input resolution per action**:

| Action | Resolves `touchedResources` from |
|--------|----------------------------------|
| `resume` | Latest capsule workingResources (or explicit `touchedResources` override) |
| `start_assignment` | Agent's active resource claims via `assignmentId` |
| `wake_start` | Latest capsule workingResources via `wakeRequestId` or `taskId`+`agentId` |
| `operation_submit` / `operation_apply` | Operation touchedResources via `operationId` |

**Output** (`ConstraintRuntimeView`):

```ts
{
  permitted: boolean
  action: RuntimeAction
  blockers: Array<{ rule, sourceMemoryId, projectionId, message, evidence }>
  warnings: Array<{ rule, sourceMemoryId, projectionId, message, evidence }>
  projection: { projectionId, cacheKey, validity, memoryVersion, createdFrom }
  inputs: { taskId, agentId, workingResources, touchedResources, source }
  runtimeUnavailable?: string   // set when projection fails (graceful degradation)
}
```

**Security**: No raw Project Memory `content` appears in output — only projected references (`sourceMemoryId`, `projectionId`, rule name, evidence array).

### Transport

| Layer | Endpoint | Format |
|-------|----------|--------|
| tRPC | `constraint.check` query | JSON |
| MCP | `syncpoint_constraint_check` tool | JSON |
| CLI | `syncpoint constraint check` | Human-readable or `--json` |

### Snapshot Integration

The sync snapshot (`buildSnapshot()`) includes lightweight constraint fields per agent:

| Field | Type | Description |
|-------|------|-------------|
| `constraintBlocked` | `boolean` | `true` if any active assignment is constraint-blocked |
| `constraintBlockerCount` | `number` | Number of active blockers |
| `constraintWarningCount` | `number` | Number of active warnings |

Summary adds:

| Field | Description |
|-------|-------------|
| `constraintBlockedAgents` | Count of agents with `constraintBlocked = true` |
| `constraintBlockedTasks` | Count of distinct tasks with constraint blocks |

---

## Design Boundaries

1. **Read-only**: `constraintCheck` never mutates state. It reproduces the same decision that P4C enforcement would make.

2. **No raw PM content**: Output contains `sourceMemoryId` references but never the memory's `content` field. The `evidence` array contains file paths and scope descriptions, not memory text.

3. **Graceful degradation**: If `buildProjection` fails (e.g., no memories exist yet), the result is `permitted: true` with `runtimeUnavailable` set. This matches P4C behavior — projection unavailable means "allow".

4. **Orthogonal to capsule**: A valid capsule does NOT imply execution permission. An execution permit does NOT imply the capsule is current. These are separate concerns.

---

## Test Coverage

| Suite | File | Count |
|-------|------|-------|
| P4A Core | `syncpoint-core/src/constraint-runtime.test.ts` | 24 |
| P4B Patch | `syncpoint-server/src/tests/p4b-patch-enforcement.test.ts` | 4 |
| P4C Entry Points | `syncpoint-server/src/tests/p4c-constraint-enforcement.test.ts` | 7 |
| P4D Visibility | `syncpoint-server/src/tests/p4d-constraint-visibility.test.ts` | 17 |
| **Total** | | **52** |
