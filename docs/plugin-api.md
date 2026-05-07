# SyncPoint Plugin API

SyncPoint's core protocol is **resource-type agnostic**. Files, images, database tables, API endpoints — any addressable resource can be claimed, tracked, and conflict-checked through the same primitives.

Plugins teach SyncPoint how to handle specific resource types and operation types by registering extensions at startup. There are four extension point categories.

---

## Extension Points

### 1. ResourceMatcher — overlap detection

A `ResourceMatcher` tells the core conflict detector how two locators of the same resource type overlap.

```ts
import { registerResourceMatcher } from "syncpoint-core";

registerResourceMatcher({
  type: "file",
  locatorsOverlap(a: string, b: string): boolean {
    // e.g. "src/auth" overlaps "src/auth/session.ts"
    const na = a.replace(/\/+$/, "");
    const nb = b.replace(/\/+$/, "");
    if (na === nb) return true;
    if (na.startsWith(nb + "/") || nb.startsWith(na + "/")) return true;
    return false;
  },
});
```

**Interface** (`syncpoint-core`):

```ts
interface ResourceMatcher {
  type: string;
  locatorsOverlap(a: string, b: string): boolean;
}
```

**Registry functions** (all exported from `syncpoint-core`):

| Function | Purpose |
|---|---|
| `registerResourceMatcher(m)` | Register a matcher for a resource type (overwrites previous) |
| `getResourceMatcher(type)` | Retrieve the registered matcher, or `undefined` |
| `clearResourceMatcherRegistry()` | Remove all matchers (testing only) |

**How core uses it**: `resourceLocatorsOverlap(a, b)` delegates to the registered matcher for `a.type`. If no matcher is registered, it falls back to **exact locator equality**. `detectResourceClaimConflicts(claims)` calls `resourceLocatorsOverlap` for every pair of active claims.

### 2. OperationValidator — operation checks

An `OperationValidator` runs domain-specific checks when an operation is submitted or checked. Validators are matched by operation type and/or resource type.

```ts
import { registerOperationValidator } from "syncpoint-core";

registerOperationValidator({
  name: "image_dimensions",
  operationTypes: ["image_edit"],
  resourceTypes: ["image"],
  validate(ctx) {
    const valid = ctx.operation.targetResources.some(r => r.metadata.includes("width"));
    return [{
      check: "image_dimensions",
      passed: valid,
      detail: valid ? "Dimensions specified" : "Missing image dimensions",
    }];
  },
});
```

**Interface** (`syncpoint-core`):

```ts
interface OperationValidator {
  name: string;
  operationTypes: string[];   // empty = applies to all types
  resourceTypes: string[];    // empty = applies to all types
  validate(ctx: OperationValidationContext): OperationCheckItem[];
}

interface OperationValidationContext {
  operation: Operation;
  actorClaims: ResourceClaim[];      // claims belonging to the operation's actor
  allActiveClaims: ResourceClaim[];  // claims across all actors
  payload?: string;                  // optional operation payload, if supplied by the caller
}

interface OperationCheckItem {
  check: string;     // machine-readable check name
  passed: boolean;
  detail: string;    // human-readable explanation
}
```

**Registry functions** (all exported from `syncpoint-core`):

| Function | Purpose |
|---|---|
| `registerOperationValidator(v)` | Add a validator to the registry |
| `getValidatorsForOperation(type, resourceTypes?)` | Query applicable validators |
| `runOperationValidation(ctx)` | Run all matching validators, return combined `OperationCheckItem[]` |
| `clearValidatorRegistry()` | Remove all validators (testing only) |

**Matching rules**: A validator fires when:
1. Its `operationTypes` is empty (wildcard) **or** contains the operation's `type`, **AND**
2. Its `resourceTypes` is empty (wildcard) **or** overlaps with the operation's `targetResources` types.

The current application `opCheck()` path passes operation metadata and resource claims to validators. The core validation interface supports optional `payload`, but callers must explicitly supply it when using `runOperationValidation()` directly.

### 3. ScopeMatcher — projection scoping

A `ScopeMatcher` tells the projection engine how to match `appliesTo` scope fields against a task's working context. This controls which Project Memory entries are relevant to a given agent's work.

```ts
import { registerScopeMatcher } from "syncpoint-core";

registerScopeMatcher({
  field: "tables",
  findOverlaps(patterns: string[], targets: string[]): string[] {
    return targets.filter(t =>
      patterns.some(p => t === p || t.startsWith(p + "."))
    );
  },
});
```

**Interface** (`syncpoint-core`):

```ts
interface ScopeMatcher {
  field: string;
  findOverlaps(patterns: string[], targets: string[]): string[];
}
```

**Registry functions** (all exported from `syncpoint-core`):

| Function | Purpose |
|---|---|
| `registerScopeMatcher(m)` | Register a matcher for a scope field (overwrites previous) |
| `getScopeMatcher(field)` | Retrieve the registered matcher, or `undefined` |
| `clearScopeMatcherRegistry()` | Remove all matchers (testing only) |

**Built-in registrations** (`_scope-matchers.ts` in `syncpoint-server`):

| Field | Semantics |
|---|---|
| `files` | Prefix/glob overlap against working resource locators |
| `modules` | Prefix/glob overlap against current module context |

**How core uses it**: During `compileProjection()`, each memory's `appliesTo` JSON is parsed (e.g. `{"files": ["src/**"]}`). For each field, the registered `ScopeMatcher.findOverlaps()` checks if any pattern overlaps with the task's working resources or module context. Unmatched memories are excluded from the projected reality.

### 4. ConstraintRuleEvaluator — typed constraint enforcement

A `ConstraintRuleEvaluator` handles domain-specific constraint evaluation. When a Project Memory entry has `kind: "hard_constraint"` and a `validatorType`, the constraint runtime dispatches to the matching evaluator.

```ts
import { registerConstraintRuleEvaluator } from "syncpoint-core";

registerConstraintRuleEvaluator({
  ruleType: "table_forbidden",
  evaluate(input, item, spec) {
    const locators = input.touchedResources
      ?.filter(r => r.type === "db_table")
      .map(r => r.locator) ?? [];
    const forbidden = ((item.scope as any)?.tables ?? []) as string[];
    const overlap = locators.filter(l => forbidden.includes(l));
    if (overlap.length > 0) {
      return {
        rule: "table_forbidden",
        message: `Touches forbidden tables: ${overlap.join(", ")}`,
        sourceMemoryId: item.source.sourceMemoryId,
        projectionId: input.projection.projectionId,
        evidence: overlap,
      };
    }
    return null;
  },
});
```

**Interface** (`syncpoint-core`):

```ts
interface ConstraintRuleEvaluator {
  ruleType: string;
  evaluate(
    input: ConstraintInput,
    item: ProjectionItem,
    spec: ConstraintRuntimeSpec,
  ): ConstraintViolation | null;
}
```

**Registry functions** (all exported from `syncpoint-core`):

| Function | Purpose |
|---|---|
| `registerConstraintRuleEvaluator(e)` | Register an evaluator for a rule type (overwrites previous) |
| `getConstraintRuleEvaluator(ruleType)` | Retrieve the registered evaluator, or `undefined` |
| `clearConstraintRuleEvaluatorRegistry()` | Remove all evaluators (testing only) |

**Known rule types**:

| Rule Type | Semantics |
|---|---|
| `file_forbidden` | Reserved validator type; blocks only when a matching evaluator is registered |
| `module_forbidden` | Reserved validator type; blocks only when a matching evaluator is registered |
| `require_review` | Core-handled rule for operation submit/apply contexts |
| `custom` | Reserved custom type; advisory unless claimed by runtime logic |

**How core uses it**: `evaluateConstraints()` iterates over projected `hard_constraint` entries. If an entry has a `validatorType` that is handled by core or has a matching registered `ConstraintRuleEvaluator`, the runtime evaluates it. If the evaluator returns a `ConstraintViolation`, it becomes a blocker. `UnknownValidatorTypeError` is thrown earlier by Project Memory create/update validation when a blocking `hard_constraint` uses an unrecognized `validatorType`.

---

## Core Types

### StateSnapshot

A generic point-in-time snapshot of an actor's work state, referencing the resources they are working with. Generalizes checkpoint + capsule concepts for any resource type.

```ts
interface StateSnapshot {
  id: string;
  actorId: string;
  taskId: string;
  sessionId: string;
  summary: string;
  resourceRefs: ResourceRef[];
  createdAt: string;
}
```

### ResourceRef

The universal resource reference. Every resource in SyncPoint is addressed by a `(type, locator)` pair.

```ts
interface ResourceRef {
  type: string;      // e.g. "file", "image", "db_table", "api_endpoint"
  locator: string;   // type-specific address, e.g. "src/auth.ts", "assets/logo.png"
  metadata: string;  // optional type-specific metadata
  id?: string;       // optional stable ID
}
```

### Operation

A tracked unit of work with a status lifecycle.

```ts
enum OperationStatus {
  DRAFT → SUBMITTED → APPROVED → APPLIED
                    → REJECTED → SUBMITTED (resubmit)
                    → CONFLICTING → SUBMITTED (resubmit)
                    → CANCELLED (from any non-terminal)
}

interface Operation {
  id: string;
  type: string;                    // e.g. "code_patch", "image_edit"
  actorId: string;
  taskId: string;
  sessionId: string;
  title: string;
  summary: string;
  targetResources: ResourceRef[];  // resources this operation touches
  payloadRef: string;              // reference to payload content
  status: OperationStatus;
  checkResult: string;
  decisionSummary: string;
  createdAt: string;
  updatedAt: string;
}
```

### ResourceClaim

An ownership declaration over one or more resources.

```ts
interface ResourceClaim {
  id: string;
  actorId: string;
  taskId: string;
  sessionId: string;
  resources: ResourceRef[];
  mode: "exclusive" | "shared";
  status: "ACTIVE" | "RELEASED";
  createdAt: string;
  releasedAt: string;
}
```

---

## First-Party Plugin: syncpoint-plugin-code

`syncpoint-plugin-code` is the reference implementation. It teaches SyncPoint how to handle `type: "file"` resources and `type: "code_patch"` operations.

### What it provides

| Module | Exports | Purpose |
|---|---|---|
| `file-resource.ts` | `parseClaimPaths`, `pathsOverlap`, `filePathsToResourceRefs`, `resourceRefsToFilePaths` | File path parsing, glob-aware overlap, ResourceRef conversion |
| `code-patch.ts` | `extractTouchedFiles`, `isValidPatchFormat`, `findUncoveredFiles`, `findConflictingClaims`, `runCodePatchChecks` | Unified diff parsing and claim checks |
| `validators.ts` | `codePatchFormatValidator`, `codePatchClaimCoverageValidator`, `codePatchNoHardConflictValidator` | OperationValidators for `code_patch` + `file` |
| `index.ts` | `registerCodePlugin()` | One-call registration entry point |

### Validators registered

| Name | Checks |
|---|---|
| `code_patch_format` | Payload is a valid unified diff when payload text is supplied |
| `code_patch_claim_coverage` | All touched files are covered by the actor's active claims |
| `code_patch_no_hard_conflict` | No other agent's exclusive claims conflict with touched files |

### Registration

```ts
import { registerCodePlugin } from "syncpoint-plugin-code";

registerCodePlugin();
// Safe to call multiple times — idempotent via name-based dedup.
```

---

## First-Party Plugin: syncpoint-plugin-generic-agent

`syncpoint-plugin-generic-agent` teaches SyncPoint how to handle non-code resource types. It is the protocol-level plugin for any shared resource that is not a source file.

### What it provides

| Module | Exports | Purpose |
|---|---|---|
| `matchers.ts` | `GENERIC_RESOURCE_MATCHERS` | URI-path-prefix overlap for `artifact`, `binary_asset`, `document`, `design_asset`, `dataset_slice` |
| `validators.ts` | `genericClaimCoverageValidator`, `genericNoHardConflictValidator`, `genericPayloadPresentValidator` | Claim coverage, hard conflict, payload presence for generic operations |
| `constraint-evaluators.ts` | `resourceForbiddenEvaluator` | Blocks operations touching resources listed in a `resource_forbidden` hard constraint |
| `scope-matchers.ts` | `resourcesScopeMatcher`, `assetTypesScopeMatcher` | Scope field matching for `resources` and `assetTypes` in appliesTo |
| `index.ts` | `registerGenericAgentPlugin()` | One-call idempotent registration |

### Supported resource types

`artifact`, `binary_asset`, `document`, `design_asset`, `dataset_slice`

### Supported operation types

`artifact_update`, `artifact_review`, `artifact_transform`, `asset_generate`, `asset_edit`, `asset_update`

### Validators registered

| Name | Checks |
|---|---|
| `generic_claim_coverage` | All target resources are covered by the actor's active claims |
| `generic_no_hard_conflict` | No other agent's exclusive claims conflict with target resources |
| `generic_payload_present` | Operation has a payload or payloadRef |

### Constraint rule evaluators registered

| Rule Type | Behavior |
|---|---|
| `resource_forbidden` | Blocks when operation's `targetResources` overlap with forbidden resource locators defined in a `hard_constraint`'s `appliesTo.resources` scope |

### Registration

```ts
import { registerGenericAgentPlugin } from "syncpoint-plugin-generic-agent";

registerGenericAgentPlugin();
// Safe to call multiple times — idempotent.
```

Auto-registered at server startup via `_plugin-init.ts` alongside `syncpoint-plugin-code`.

---

## Operation Constraint Enforcement

Starting with PR5, `opCheck()` and `opApply()` integrate the **Constraint Runtime** as a hard blocker alongside the existing `OperationValidator` pipeline.

### opCheck flow

```text
opCheck(operationId)
  │
  ├── runOperationValidation()     → OperationCheckItem[]
  │     └── generic_claim_coverage, generic_no_hard_conflict, generic_payload_present, ...
  │
  ├── evaluateConstraints()        → ConstraintDecision
  │     └── resource_forbidden, do_not_touch, projection gates, ...
  │
  ├── if blockers:
  │     ├── add "constraint_runtime" check item (passed: false)
  │     ├── write constraintViolations to checkResult
  │     └── transition SUBMITTED → CONFLICTING
  │
  └── return { operation, checkResult }
```

### opApply flow

```text
opApply(operationId)
  │
  ├── validate transition (APPROVED → APPLIED)
  │
  ├── evaluateConstraints(action: "operation_apply")
  │     └── if blockers → throw Error (apply rejected)
  │
  └── update status → APPLIED
```

This ensures that even if a constraint was added between check and apply, the operation is re-evaluated before it takes effect.

---

## Writing a New Plugin

### Step 1: Define your resource type

Pick a `type` string (e.g. `"db_table"`, `"api_endpoint"`, `"binary_asset"`).

### Step 2: Register a ResourceMatcher (optional)

If your resource type has overlap semantics beyond exact string equality, register a matcher:

```ts
import { registerResourceMatcher } from "syncpoint-core";

registerResourceMatcher({
  type: "db_table",
  locatorsOverlap(a, b) {
    // "users" overlaps "users", "users.*" overlaps "users.email"
    if (a === b) return true;
    if (a.endsWith(".*")) return b.startsWith(a.slice(0, -1));
    if (b.endsWith(".*")) return a.startsWith(b.slice(0, -1));
    return false;
  },
});
```

### Step 3: Register OperationValidators (optional)

Define validators for your operation type:

```ts
import { registerOperationValidator } from "syncpoint-core";

registerOperationValidator({
  name: "migration_has_rollback",
  operationTypes: ["db_migration"],
  resourceTypes: ["db_table"],
  validate(ctx) {
    const hasRollback = ctx.operation.summary.includes("rollback");
    return [{
      check: "migration_has_rollback",
      passed: hasRollback,
      detail: hasRollback
        ? "Migration includes rollback section"
        : "Migration is missing a rollback section",
    }];
  },
});
```

### Step 4: Create an entry point

Follow the `registerCodePlugin()` pattern — one idempotent function that registers all matchers and validators:

```ts
import { getValidatorsForOperation, registerOperationValidator } from "syncpoint-core";

const VALIDATORS = [myValidator1, myValidator2];

export function registerDbPlugin(): void {
  const existing = new Set(
    getValidatorsForOperation("db_migration", ["db_table"]).map(v => v.name),
  );
  for (const v of VALIDATORS) {
    if (!existing.has(v.name)) {
      registerOperationValidator(v);
      existing.add(v.name);
    }
  }
}
```

### Step 5: Package structure

```text
packages/syncpoint-plugin-yourtype/
├── package.json          # depends on syncpoint-core (workspace:*)
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts          # registerYourPlugin() + re-exports
    ├── your-resource.ts  # ResourceRef helpers, overlap logic
    ├── your-operation.ts # operation-specific helpers
    └── validators.ts     # OperationValidator implementations
```

---

## How Plugins Integrate with the Runtime

```text
Plugin registers at startup
       │
       ├── ResourceMatcher ──────► detectResourceClaimConflicts()
       │                            └── used by rcClaim, rcDetectConflicts
       │
       ├── OperationValidator ───► runOperationValidation()
       │                            └── used by opCheck, opSubmit
       │
       ├── ScopeMatcher ─────────► compileProjection()
       │                            └── appliesTo filtering for Project Memory
       │
       └── ConstraintRuleEvaluator ► evaluateConstraints()
                                     └── typed hard_constraint enforcement
                                     └── used by opCheck, opApply (PR5)
```

When an agent calls `syncpoint_resource_claim`, core's conflict detection delegates to the registered `ResourceMatcher` for the resource type. When an agent calls `syncpoint_operation_submit` or `syncpoint_operation_check`, core's validation pipeline runs all matching `OperationValidator`s **and** the Constraint Runtime evaluates all projected constraints against the operation's target resources. During `loopResume`, the projection engine uses `ScopeMatcher`s to filter relevant Project Memory, and the constraint runtime uses `ConstraintRuleEvaluator`s to enforce typed constraints.

If no extension is registered for a given type, core falls back to safe defaults:
- **No ResourceMatcher** → exact locator equality for overlap detection
- **No OperationValidator** → operation passes all checks (empty check result)
- **No ScopeMatcher** → exact string matching on scope field values
- **No ConstraintRuleEvaluator** → reserved typed constraints are not claimed at runtime and fall back to advisory unless core handles the rule

---

## Current Status

The plugin API is functional and auto-wired:

- **`syncpoint-plugin-code`** is registered at server startup via `_plugin-init.ts`. File `ResourceMatcher`, three `OperationValidator`s for `code_patch` + `file`, and scope matchers for `files`/`modules` are active.
- **`syncpoint-plugin-generic-agent`** is registered at server startup via `_plugin-init.ts`. Five `ResourceMatcher`s for generic resource types, three `OperationValidator`s for generic operations, `resource_forbidden` `ConstraintRuleEvaluator`, and scope matchers for `resources`/`assetTypes` are active.
- `opCheck()` and `opApply()` run both the `OperationValidator` pipeline and the `Constraint Runtime` as hard blockers (PR5).
- Five `ConstraintRuleEvaluator` types are recognized: `file_forbidden`, `module_forbidden`, `resource_forbidden`, `require_review`, `custom`.
