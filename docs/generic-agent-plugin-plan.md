# Generic Agent Plugin — Implementation Plan

> **Goal**: Build `syncpoint-plugin-generic-agent` — the first non-code plugin that proves SyncPoint is a resource-first agent coordination runtime.

> **MVP acceptance status (2026-05-06)**: Accepted for the generic-agent MVP. S1-S9 and S11 are complete; S10 demo refactor is explicitly deferred to a follow-up PR. Verification: package tests passed for `syncpoint-core` 478/478, `syncpoint-server` 380/380, `syncpoint-mcp` 48/48, `syncpoint-plugin-code` 30/30, `syncpoint-plugin-generic-agent` 77/77, `syncpoint-cli` 1/1, `syncpoint-sdk` 1/1, and `syncpoint-vscode` 4/4; `pnpm typecheck` and `pnpm build` also pass.

---

## Phase 0: Infrastructure Prerequisites

Before building the plugin, two upstream changes are needed:

### 0.1 Extend `KNOWN_VALIDATOR_TYPES` allowlist

**File**: `packages/syncpoint-server/src/application/project-memory-service.ts:146`

Current:
```ts
const KNOWN_VALIDATOR_TYPES = ["file_forbidden", "module_forbidden", "require_review", "custom"] as const;
```

Add:
```ts
const KNOWN_VALIDATOR_TYPES = [
  "file_forbidden", "module_forbidden", "require_review", "custom",
  "resource_forbidden",  // generic resource blocking (from generic-agent plugin)
] as const;
```

This allows Project Memory entries to declare `validatorType: "resource_forbidden"` and enter the blocking constraint path.

### 0.2 Register additional scope matcher fields

The `compileProjection()` scope context currently only builds `files` and `modules` keys:
```ts
const scopeContext: ScopeContextMap = {
  files: workingResources,
  modules: currentModules,
};
```

Implemented as a small core pass-through plus plugin matchers:
- `ProjectionScope` / appliesTo parsing now preserve arbitrary scope fields, not only `files`, `modules`, and `taskTypes`.
- `compileProjection()` includes `resources: workingResources` in the scope context.
- The plugin registers `ScopeMatcher`s for `"resources"` and `"assetTypes"`.

This keeps core generic while allowing `appliesTo: {"resources": ["artifact://hero"]}` to match `workingResources` locators through URI-prefix overlap.

---

## Phase 1: Package Scaffold

```
packages/syncpoint-plugin-generic-agent/
├── src/
│   ├── index.ts                    ← registerGenericAgentPlugin() entry
│   ├── resource-types.ts           ← GENERIC_RESOURCE_TYPES constant
│   ├── operation-types.ts          ← GENERIC_OPERATION_TYPES constant
│   ├── locator.ts                  ← URI locator parsing + overlap logic
│   ├── matchers.ts                 ← ResourceMatcher implementations
│   ├── validators.ts               ← OperationValidator implementations
│   ├── constraint-evaluators.ts    ← ConstraintRuleEvaluator (resource_forbidden)
│   ├── scope-matchers.ts           ← ScopeMatcher for "resources" / "assetTypes"
│   └── __tests__/
│       ├── locator.test.ts
│       ├── matchers.test.ts
│       ├── validators.test.ts
│       ├── constraint-evaluators.test.ts
│       └── integration.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### `package.json`
```json
{
  "name": "syncpoint-plugin-generic-agent",
  "version": "0.1.0",
  "description": "SyncPoint plugin — generic resource ownership and multi-modal operation validation",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepublishOnly": "pnpm run build && pnpm run typecheck && pnpm run test"
  },
  "dependencies": {
    "syncpoint-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0"
  }
}
```

---

## Phase 2: Locator Convention

### URI locator format

```
{type}://{id-or-path}#{fragment}
```

Examples:
```
artifact://landing-page-design
binary://assets/hero-banner.png
doc://PRD-001#section=pricing
image://hero-banner#layer=face
image://hero-banner#bbox=10,20,200,150
video://trailer-v2#frames=120-240
dataset://users-2024#filter=active
```

### `locator.ts` — URI parser

```ts
export interface ParsedLocator {
  scheme: string;      // "artifact", "binary", "image", etc.
  path: string;        // "landing-page-design", "assets/hero-banner.png"
  fragment?: string;   // "layer=face", "bbox=10,20,200,150"
}

export function parseLocator(locator: string): ParsedLocator;
export function locatorPath(locator: string): string;
export function locatorScheme(locator: string): string;
```

### Overlap semantics

For MVP, overlap between two locators of the same resource type:
1. **Exact match** — `a === b`
2. **Path prefix** — `a` is a prefix of `b` (namespace containment)
3. **Same path, different fragment** — overlap if fragments intersect (deferred to Phase 3 for spatial/temporal)

Phase 1 (MVP): **exact match + path prefix** only.

---

## Phase 3: Resource Matchers

### `matchers.ts`

```ts
import { registerResourceMatcher } from "syncpoint-core";
import { locatorPath } from "./locator.js";

// Exact match OR namespace prefix overlap
function uriPrefixOverlap(a: string, b: string): boolean {
  const pa = locatorPath(a);
  const pb = locatorPath(b);
  if (pa === pb) return true;
  if (pa.startsWith(pb + "/") || pb.startsWith(pa + "/")) return true;
  return false;
}

export const RESOURCE_MATCHERS = [
  { type: "artifact",      locatorsOverlap: uriPrefixOverlap },
  { type: "binary_asset",  locatorsOverlap: uriPrefixOverlap },
  { type: "document",      locatorsOverlap: uriPrefixOverlap },
  { type: "design_asset",  locatorsOverlap: uriPrefixOverlap },
  { type: "dataset_slice", locatorsOverlap: uriPrefixOverlap },
] as const;
```

---

## Phase 4: Operation Validators (MVP — 3 checks)

### `validators.ts`

| Validator Name | Fires On | Logic |
|---|---|---|
| `generic_claim_coverage` | all GENERIC_OPERATION_TYPES × all GENERIC_RESOURCE_TYPES | Are all `targetResources` covered by actor's active claims? |
| `generic_no_hard_conflict` | same | Do any `targetResources` collide with another actor's exclusive claim? |
| `generic_payload_present` | same | Does the operation include `payload` or `payloadRef`? (soft warning) |

```ts
export const GENERIC_VALIDATORS: OperationValidator[] = [
  {
    name: "generic_claim_coverage",
    operationTypes: [...GENERIC_OPERATION_TYPES],
    resourceTypes: [...GENERIC_RESOURCE_TYPES],
    validate(ctx) { /* check uncovered targets */ },
  },
  {
    name: "generic_no_hard_conflict",
    operationTypes: [...GENERIC_OPERATION_TYPES],
    resourceTypes: [...GENERIC_RESOURCE_TYPES],
    validate(ctx) { /* check exclusive overlap with other actors */ },
  },
  {
    name: "generic_payload_present",
    operationTypes: [...GENERIC_OPERATION_TYPES],
    resourceTypes: [...GENERIC_RESOURCE_TYPES],
    validate(ctx) { /* warn if no payload or payloadRef is supplied */ },
  },
];
```

---

## Phase 5: Constraint Rule Evaluator

### `constraint-evaluators.ts`

```ts
import { registerConstraintRuleEvaluator } from "syncpoint-core";
import type { ConstraintRuleEvaluator } from "syncpoint-core";
import { locatorPath } from "./locator.js";

/**
 * resource_forbidden — blocks operations touching resources matching
 * a do_not_touch / hard_constraint scope pattern.
 *
 * Scope format: { "resources": ["artifact://landing-page", "binary://brand-logo.png"] }
 */
export const resourceForbiddenEvaluator: ConstraintRuleEvaluator = {
  ruleType: "resource_forbidden",
  evaluate(input, item, spec) {
    const locators = (input.touchedResources ?? []).map(r => r.locator);
    if (!locators.length) return null;
    const forbidden = (item.scope as any)?.resources ?? [];
    if (!forbidden.length) return null;
    const overlaps = locators.filter(loc =>
      forbidden.some((pat: string) => {
        const pl = locatorPath(loc);
        const pp = locatorPath(pat);
        return pl === pp || pl.startsWith(pp + "/") || pp.startsWith(pl + "/");
      }),
    );
    if (overlaps.length === 0) return null;
    return {
      rule: "resource_forbidden",
      sourceMemoryId: item.source.sourceMemoryId,
      projectionId: input.projection.projectionId,
      message: spec.message ?? `Touches forbidden resources: ${overlaps.join(", ")}`,
      evidence: overlaps,
    };
  },
};
```

---

## Phase 6: Scope Matchers for Projection

### `scope-matchers.ts`

```ts
import { registerScopeMatcher } from "syncpoint-core";
import { locatorPath } from "./locator.js";

/**
 * Scope matcher for "resources" field in appliesTo.
 * Patterns are URI-style locators; targets are working resource locators.
 * Prefix overlap matching.
 */
export function resourcesScopeMatcher(patterns: string[], targets: string[]): string[] {
  return targets.filter(t => {
    const tp = locatorPath(t);
    return patterns.some(p => {
      const pp = locatorPath(p);
      return tp === pp || tp.startsWith(pp + "/") || pp.startsWith(tp + "/");
    });
  });
}

/**
 * Scope matcher for "assetTypes" field in appliesTo.
 * Exact string match.
 */
export function assetTypesScopeMatcher(patterns: string[], targets: string[]): string[] {
  const pSet = new Set(patterns);
  return targets.filter(t => pSet.has(t));
}
```

---

## Phase 7: Plugin Entry Point

### `index.ts`

```ts
import { registerResourceMatcher, getResourceMatcher,
         registerOperationValidator, getValidatorsForOperation,
         registerConstraintRuleEvaluator, getConstraintRuleEvaluator,
         registerScopeMatcher, getScopeMatcher } from "syncpoint-core";
import { RESOURCE_MATCHERS } from "./matchers.js";
import { GENERIC_VALIDATORS } from "./validators.js";
import { resourceForbiddenEvaluator } from "./constraint-evaluators.js";
import { resourcesScopeMatcher, assetTypesScopeMatcher } from "./scope-matchers.js";

let _registered = false;

export function registerGenericAgentPlugin(): void {
  // 1. Resource matchers
  for (const m of RESOURCE_MATCHERS) {
    if (!getResourceMatcher(m.type)) {
      registerResourceMatcher(m);
    }
  }

  // 2. Operation validators (idempotent via name check)
  const registeredNames = new Set(
    getValidatorsForOperation("artifact_update", ["artifact"]).map(v => v.name),
  );
  for (const v of GENERIC_VALIDATORS) {
    if (!registeredNames.has(v.name)) {
      registerOperationValidator(v);
      registeredNames.add(v.name);
    }
  }

  // 3. Constraint rule evaluator
  if (!getConstraintRuleEvaluator("resource_forbidden")) {
    registerConstraintRuleEvaluator(resourceForbiddenEvaluator);
  }

  // 4. Scope matchers for projection filtering
  if (!getScopeMatcher("resources")) {
    registerScopeMatcher({ field: "resources", findOverlaps: resourcesScopeMatcher });
  }
  if (!getScopeMatcher("assetTypes")) {
    registerScopeMatcher({ field: "assetTypes", findOverlaps: assetTypesScopeMatcher });
  }

  _registered = true;
}

export function isGenericAgentPluginRegistered(): boolean {
  return _registered;
}

export function _resetGenericAgentPlugin(): void {
  _registered = false;
}
```

---

## Phase 8: Tests

### Test matrix

| Test file | Covers |
|---|---|
| `locator.test.ts` | URI parsing, path extraction, scheme extraction |
| `matchers.test.ts` | Overlap for each resource type, prefix vs exact vs no-match |
| `validators.test.ts` | claim_coverage, no_hard_conflict, payload_present for generic ops |
| `constraint-evaluators.test.ts` | resource_forbidden blocks/permits based on scope |
| `integration.test.ts` | Full pipeline: claim → conflict → operation → validator → constraint |

### Key test scenarios

```text
1. Agent A claims artifact://landing-page-design (exclusive)
   Agent B claims artifact://landing-page-design (exclusive) → CONFLICT

2. Agent submits artifact_update on unclaimed resource → FAIL (claim_coverage)

3. Project Memory: do_not_touch { resources: ["binary://brand-logo.png"] }
   Agent touches binary://brand-logo.png → BLOCKED (resource_forbidden)

4. Two agents claim different artifacts → no conflict (different locators)

5. Agent claims artifact://ui/ (namespace)
   Agent operates on artifact://ui/header → PASS (covered)
   Agent operates on artifact://api/routes → FAIL (uncovered)
```

---

## Phase 9: Upstream Wiring

### 9.1 Add `resource_forbidden` to `KNOWN_VALIDATOR_TYPES`

```diff
- const KNOWN_VALIDATOR_TYPES = ["file_forbidden", "module_forbidden", "require_review", "custom"] as const;
+ const KNOWN_VALIDATOR_TYPES = ["file_forbidden", "module_forbidden", "require_review", "custom", "resource_forbidden"] as const;
```

### 9.2 Auto-register in `_plugin-init.ts`

```ts
import { registerCodePlugin } from "syncpoint-plugin-code";
import { registerGenericAgentPlugin } from "syncpoint-plugin-generic-agent";

registerCodePlugin();
registerGenericAgentPlugin();
```

### 9.3 Update existing demo

Refactor `packages/syncpoint-cli/src/commands/demo.ts` `runResourceDemo()` to import and use the plugin's registered validators instead of inline definitions. This removes ~90 lines of inline validator code.

---

## Phase 10: CLI & MCP Surface (UX)

### CLI

The existing `syncpoint claim` command already accepts `--type <type>`. No CLI changes needed for generic resource types — they work out of the box:

```bash
syncpoint claim "artifact://landing-page-design" --type artifact --agent designer --task t1
syncpoint claim "binary://logo.png" --type binary_asset --agent optimizer --task t2
```

### MCP

`syncpoint_resource_claim` already accepts any `type` in the resources array. No MCP tool changes needed.

### Important: Code UX unchanged

```bash
# These still work exactly as before for code users:
syncpoint claim "src/auth/*" --agent coder --task t1
syncpoint checkpoint
syncpoint patch submit
```

---

## Phase 11: Demo Script

Add a `syncpoint demo generic` subcommand (or extend `syncpoint demo resource`):

```text
Scenario: Multi-modal agent coordination
  Agent "content-writer" claims artifact://landing-page-copy
  Agent "designer" claims design_asset://landing-page-hero
  Agent "designer" tries to claim artifact://landing-page-copy → CONFLICT (SyncGate)
  Project Memory: do_not_touch { resources: ["binary://brand-logo.png"] }
  Agent submits asset_edit touching binary://brand-logo.png → BLOCKED
```

---

## Implementation Order

| Step | Effort | Dependency |
|---|---|---|
| **S1** Package scaffold + tsconfig + vitest | 10 min | — |
| **S2** `locator.ts` + `locator.test.ts` | 20 min | S1 |
| **S3** `resource-types.ts` + `operation-types.ts` | 5 min | S1 |
| **S4** `matchers.ts` + `matchers.test.ts` | 20 min | S2, S3 |
| **S5** `validators.ts` + `validators.test.ts` | 30 min | S4 |
| **S6** `constraint-evaluators.ts` + test | 20 min | S2 |
| **S7** `scope-matchers.ts` + test | 15 min | S2 |
| **S8** `index.ts` + `integration.test.ts` | 20 min | S5, S6, S7 |
| **S9** Upstream: `KNOWN_VALIDATOR_TYPES` + `_plugin-init.ts` | 5 min | S8 |
| **S10** Refactor demo.ts to use plugin | 15 min | S9 |
| **S11** README.md | 10 min | S8 |

**Total estimated: ~2.5 hours**

---

## What This Does NOT Include (deferred)

| Item | Phase |
|---|---|
| Spatial overlap (bbox, mask, layer) | v0.3 image plugin |
| Temporal overlap (frame ranges) | v0.4 video plugin |
| Semantic conflict detection | v1.0+ |
| Custom locator fragment parsers | v0.3 |
| Plugin discovery / dynamic loading | v0.5 |
| `ProjectionContext` extension for asset types | v0.3 (if (B) proves insufficient) |

---

## Success Criteria

1. `pnpm test` passes in new package (target: 20+ tests)
2. All existing 942+ tests still pass (no regression)
3. 8/8 packages typecheck clean
4. `syncpoint demo resource` refactor to plugin-registered validators is deferred to S10 follow-up
5. A Project Memory `do_not_touch` with `resources: ["binary://brand-logo.png"]` actually blocks at constraint runtime
6. Two agents claiming the same `artifact://` locator produce a conflict + SyncGate
