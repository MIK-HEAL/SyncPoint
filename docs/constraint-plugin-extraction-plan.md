# Constraint Plugin Extraction Plan (PR0 + PR1)

> **Goal**: Move all file/module constraint logic out of core into plugins; make the validator type allowlist plugin-driven.

> **Status**: 2026-05-06 — PR0–PR4 complete

---

## Audit Summary

### What's already clean
- `ConstraintInput` uses `touchedResources: ResourceRef[]` (no `touchedFiles`)
- `ConstraintRuleEvaluator` interface is fully pluggable
- `evaluateHardConstraintTyped()` dispatches to plugin evaluators for unknown rule types
- Core only handles `require_review` and `custom` as built-ins
- `findAllScopeOverlaps()` uses registered `ScopeMatcher`s, not hardcoded file logic

### What's still file-first

| Location | Issue |
|---|---|
| `constraint-runtime.test.ts:36-83` | Inline `file_forbidden` + `module_forbidden` evaluator registration in `beforeEach` — these are test-only, never in production |
| `constraint-runtime.ts:27,50,53,82,307` | JSDoc examples mention `file_forbidden` — cosmetic but misleading |
| `project-memory-service.ts:146` | `KNOWN_VALIDATOR_TYPES` hardcodes `["file_forbidden", "module_forbidden", "require_review", "custom", "resource_forbidden"]` |
| `_scope-matchers.ts` | Server registers `files`/`modules` scope matchers — should move to code plugin |
| `projection.ts:30-32` | `ProjectionScope` has named `files?/modules?/taskTypes?` fields (+ index sig) |
| `projection.ts:224-228` | `ParsedAppliesTo` mirrors the same named fields |
| `projection.ts:244-248` | `ScopeContextMap` has required `files`/`modules` fields |
| `projection.ts:82` | JSDoc example says `"file_forbidden", "module_forbidden"` |

---

## PR0: Code Plugin Owns file_forbidden + module_forbidden

### 0a. Add constraint evaluators to `syncpoint-plugin-code`

Create `packages/syncpoint-plugin-code/src/constraint-evaluators.ts`:

```ts
// Two evaluators: fileForbiddenEvaluator, moduleForbiddenEvaluator
// Logic identical to current inline code in constraint-runtime.test.ts
// Uses pathsOverlap from file-resource.ts for file matching
// Uses prefix matching for module matching
```

Export from `src/index.ts`, register in `registerCodePlugin()`.

### 0b. Add scope matcher registration to code plugin

Move `files` and `modules` scope matcher registration from `_scope-matchers.ts` into `registerCodePlugin()`. The server's `_scope-matchers.ts` becomes empty or deleted (code plugin handles it).

### 0c. Update core constraint-runtime tests

Replace inline evaluator registration with a generic `dummy_rule` evaluator pattern:
- Tests that exercise the typed evaluator dispatch use `ruleType: "test_forbidden"` with trivial logic
- Tests that exercise `file_forbidden` / `module_forbidden` by name move to `syncpoint-plugin-code` as integration tests
- Core tests only prove: dispatch works, advisory fallback works, action allowlist works

### 0d. Add integration tests to code plugin

New `packages/syncpoint-plugin-code/src/constraint-evaluators.test.ts`:
- `file_forbidden` blocks on file path prefix overlap
- `file_forbidden` permits when no overlap
- `module_forbidden` blocks on module prefix overlap
- `module_forbidden` permits when no module overlap
- E2E: `compileProjection` + `evaluateConstraints` with `validatorType=file_forbidden`
- Custom message from validatorConfig

### 0e. Update JSDoc in constraint-runtime.ts

Change examples from `"file_forbidden"` to generic plugin examples like `"resource_forbidden"`.

### Files touched

| Package | File | Change |
|---|---|---|
| `syncpoint-plugin-code` | `src/constraint-evaluators.ts` | **NEW** — `fileForbiddenEvaluator`, `moduleForbiddenEvaluator` |
| `syncpoint-plugin-code` | `src/constraint-evaluators.test.ts` | **NEW** — tests |
| `syncpoint-plugin-code` | `src/index.ts` | Register evaluators + scope matchers in `registerCodePlugin()` |
| `syncpoint-core` | `src/constraint-runtime.test.ts` | Replace file/module evaluators with generic test dummies |
| `syncpoint-core` | `src/constraint-runtime.ts` | JSDoc updates only |
| `syncpoint-server` | `src/application/_scope-matchers.ts` | Remove or delegate to plugin |

### Verification

- `syncpoint-core` tests pass (no regression, evaluator dispatch still tested via dummies)
- `syncpoint-plugin-code` tests pass (new constraint evaluator tests + existing validator tests)
- `syncpoint-server` tests pass (scope matchers still registered via plugin init)

---

## PR1: Plugin-ize KNOWN_VALIDATOR_TYPES

### 1a. Add `isConstraintRuleKnown()` to core

In `constraint-runtime.ts`:

```ts
const CORE_RULE_TYPES = ["require_review", "custom"] as const;

export function isConstraintRuleKnown(type: string): boolean {
  return (CORE_RULE_TYPES as readonly string[]).includes(type)
    || _ruleEvaluators.has(type);
}
```

Export from `index.ts`.

### 1b. Server uses core function instead of hardcoded list

In `project-memory-service.ts`:
- Remove `KNOWN_VALIDATOR_TYPES` const
- `requireValidatorForBlockingConstraint()` calls `isConstraintRuleKnown(validatorType)` from core
- Error messages become dynamic: "registered rule types" instead of listing a static array

### 1c. Update server tests

- Tests that create `validatorType=file_forbidden` memories must ensure code plugin is registered first
- Tests for unknown types still work (no evaluator registered = rejected)
- Add test: register a new evaluator → that type becomes valid for Project Memory creation

### Files touched

| Package | File | Change |
|---|---|---|
| `syncpoint-core` | `src/constraint-runtime.ts` | Add `isConstraintRuleKnown()` |
| `syncpoint-core` | `src/index.ts` | Export `isConstraintRuleKnown` |
| `syncpoint-server` | `src/application/project-memory-service.ts` | Replace `KNOWN_VALIDATOR_TYPES` with `isConstraintRuleKnown()` |
| `syncpoint-server` | `src/tests/p2-schema-v2.test.ts` | Ensure plugin registered before creating typed memories |

### Verification

- `syncpoint-core` tests pass
- `syncpoint-server` tests pass (typed memory creation works because plugins register evaluators at init)
- New test: unregistered type rejected, then register evaluator, then accepted

---

## Ordering & Dependencies

```
PR0 (code plugin constraint evaluators)
  └── PR1 (plugin-ize allowlist) — depends on PR0 because server needs
      evaluators registered before accepting validatorType on write
```

PR0 can land independently. PR1 depends on PR0.

---

## PR2: Resource-type-aware scope matching (DONE)

- `ScopeMatcher.resourceTypes?: string[]` — scope field declares which resource types it cares about
- `findAllScopeOverlaps()` accepts `ResourceRef[]`, pre-filters by `resourceTypes` before extracting locators
- Code plugin: `files`/`modules` matchers declare `resourceTypes: ["file"]`
- Generic-agent plugin: `resources` matcher declares `resourceTypes: [...GENERIC_RESOURCE_TYPES]`
- 3 new core tests: non-matching type skipped, matching type blocks, mixed types
- `do_not_touch_scope_overlap` no longer produces cross-domain false positives

## PR3: ProjectionScope generalization (DONE)

- `ProjectionScope` → `{ [key: string]: string[] | undefined }` (removed `files?/modules?/taskTypes?`)
- `ParsedAppliesTo` → same
- `ScopeContextMap` → `{ [key: string]: string[] }` (removed `files`/`modules` required fields)
- All existing code still compiles — index signature handles arbitrary field access

## PR4: Resource-type-aware projection filtering (DONE)

- `ProjectionContext.workingResourceRefs?: ResourceRef[]` — typed resource refs for appliesTo filtering
- `isRelevantToContext()` now pre-filters by `ScopeMatcher.resourceTypes` when `workingResourceRefs` provided
- Falls back to string-only `scopeContext` when `workingResourceRefs` not provided (backward compat)
- 4 new projection tests: non-file excluded, file included, mixed resources, backward compat fallback
- Symmetric with runtime's `findAllScopeOverlaps` resource-type filtering

---

## NOT in scope (future PRs)

- PR5: docs canonical = resource, file_forbidden = compat recommendation
- PR6: thin domain plugins (binary, document, design_asset)
