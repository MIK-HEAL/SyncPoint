# Beyond Code

SyncPoint is a **resource-first synchronization protocol**. It is not a multimodal semantic engine.

---

## What This Means

Every SyncPoint primitive — `ResourceClaim`, `Operation`, `SyncGate`, `Checkpoint`, `Constraint Runtime` — operates on `(type, locator)` pairs. The protocol does not parse, interpret, or understand the content of a resource. It coordinates **ownership**, **change lifecycle**, and **constraint enforcement** across any addressable resource type.

```text
type: "file"          locator: "src/auth.ts"
type: "binary_asset"  locator: "assets/hero-banner.png"
type: "artifact"      locator: "artifact://design/homepage"
type: "document"      locator: "doc://api-spec/v2"
type: "dataset_slice" locator: "dataset://training/batch-42"
type: "design_asset"  locator: "figma://project/component-library"
```

The same `ResourceClaim → Operation → Constraint Runtime` loop works for all of them.

## What SyncPoint Does

| Capability | Mechanism |
|---|---|
| Prevent two agents from editing the same resource | `ResourceClaim` (exclusive/shared) + `SyncGate` |
| Check an operation before it is treated as safe | `OperationValidator` pipeline + `Constraint Runtime` |
| Block operations that touch forbidden resources | `resource_forbidden` constraint rule evaluator |
| Track change lifecycle | `Operation` status: DRAFT → SUBMITTED → APPROVED → APPLIED |
| Enforce project-level rules | `hard_constraint` in Project Memory → projected into Constraint Runtime |
| Detect stale context | Checkpoints + context capsules + projection validity |

## What SyncPoint Does NOT Do

SyncPoint does not:

- **Parse images** — it does not understand pixel content, dimensions, or visual semantics
- **Analyze video** — it does not check temporal consistency or frame coherence
- **Run embeddings** — it does not compute or compare vector representations
- **Perform model-specific reasoning** — it does not invoke LLMs to decide if a change is correct
- **Build resource dependency graphs** — it does not infer relationships between resources

These are the domain of specialized tools and model capabilities. SyncPoint's job is to ensure that when those tools produce a change, the change goes through a coordinated, constraint-checked protocol before it is accepted.

## The Generic Agent Plugin

`syncpoint-plugin-generic-agent` is a first-party plugin that teaches SyncPoint how to handle non-code resource types. It provides:

| Component | Purpose |
|---|---|
| `ResourceMatcher` (5 types) | Path-prefix overlap detection for `artifact`, `binary_asset`, `document`, `design_asset`, `dataset_slice` |
| `OperationValidator` (3 validators) | Claim coverage, hard conflict, payload presence for generic operation types |
| `ConstraintRuleEvaluator` | `resource_forbidden` — blocks operations touching forbidden resources |
| `ScopeMatcher` (2 matchers) | `resources` and `assetTypes` scope field matching for projection filtering |

### Supported operation types

`artifact_update`, `artifact_review`, `artifact_transform`, `asset_generate`, `asset_edit`, `asset_update`

### Auto-registration

The plugin is registered at server startup via `_plugin-init.ts`. No manual registration is needed. All application services that build projections or evaluate constraints automatically have access to the generic agent plugin's matchers, validators, and evaluators.

## Constraint Runtime Integration

When a Project Memory entry has:

```text
kind: "hard_constraint"
validatorType: "resource_forbidden"
appliesTo: { resources: ["binary://brand-logo.png"] }
severity: "blocking"
```

The Constraint Runtime evaluates this during `opCheck()` and `opApply()`:

1. `buildProjection()` compiles the Project Memory into a `ProjectedReality`
2. `evaluateConstraints()` runs all constraint rules against the operation's `targetResources`
3. If the `resource_forbidden` evaluator finds an overlap → **blocker**
4. The blocker is written to `checkResult.constraintViolations`
5. The operation transitions to `CONFLICTING`

At `opApply()` time, a final constraint check runs. If the constraint is still active, the apply is rejected.

## Demo

```bash
syncpoint demo resource
```

See [`examples/generic-agent-collaboration/README.md`](../examples/generic-agent-collaboration/README.md) for a walkthrough.
