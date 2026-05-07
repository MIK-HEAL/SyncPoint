# Generic Agent Collaboration Example

SyncPoint coordinates safe changes to **any shared resource** — not just code files.

This example shows two agents (a designer and an optimizer) collaborating on binary assets, with the Constraint Runtime enforcing project-level rules.

## Run

```bash
syncpoint demo resource
```

## What happens

### Part 1: Resource claim conflict

1. **Designer** claims `assets/hero-banner.png` (type: `binary_asset`, mode: exclusive)
2. **Optimizer** tries to claim the same resource → **BLOCKED** by SyncGate
3. Gate is resolved: designer finishes first, optimizer proceeds after

### Part 2: Operation lifecycle

1. Designer submits an `asset_edit` operation targeting the claimed banner
2. `opCheck` runs generic validators:
   - `generic_claim_coverage` — target resource is covered by an active claim ✓
   - `generic_no_hard_conflict` — no other exclusive claims conflict ✓
   - `generic_payload_present` — operation has a payload reference ✓
3. If a `resource_forbidden` hard constraint exists in Project Memory for the touched resource, the **Constraint Runtime** blocks the operation and writes `constraintViolations`
4. Operation flows: `DRAFT → SUBMITTED → APPROVED → APPLIED`

## Key takeaway

SyncPoint's protocol primitives — `ResourceClaim`, `Operation`, `SyncGate`, `Constraint Runtime` — work identically for `binary_asset`, `artifact`, `document`, `design_asset`, or any custom resource type.

No code-specific logic is involved. No image understanding, video consistency, or embedding memory is required. The protocol enforces safe change coordination for any shared resource.

## Constraint Runtime integration

When a Project Memory entry has:
- `kind: "hard_constraint"`
- `validatorType: "resource_forbidden"`
- `appliesTo: { resources: ["binary://brand-logo.png"] }`

The Constraint Runtime will **block** any operation whose `targetResources` overlap with the forbidden resources. The violation appears in `checkResult.constraintViolations` and the operation transitions to `CONFLICTING`.

## Related

- [Plugin API](../../docs/plugin-api.md) — how `syncpoint-plugin-generic-agent` registers matchers, validators, and constraint evaluators
- [Beyond Code](../../docs/beyond-code.md) — why SyncPoint is a resource-first protocol
- [Constraint Runtime](../../docs/constraint-runtime.md) — how projected reality drives enforcement
