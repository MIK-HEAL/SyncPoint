# syncpoint-core

> **⚠️ Compatibility layer only.** All new development should use the layered packages.

SyncPoint protocol core — now serving as a **backward-compatible aggregation facade** for consumers that haven't yet migrated to the layered package architecture.

## Migration Path

As of 2026-06-04, all four layered packages host their source code independently:

| Package | Purpose | Import from |
|---------|---------|-------------|
| `syncpoint-kernel` | Resource claims, sync gates, operations, write permits, errors, events | `syncpoint-kernel` |
| `syncpoint-governance` | Checkpoint reviews, constraints, wake engine, review workflow | `syncpoint-governance` |
| `syncpoint-context` | Project memory, reality projection, context policy, prompt templates | `syncpoint-context` |
| `syncpoint-adapters` | Orchestration, negotiation, agent manifests, agent messaging, runtime | `syncpoint-adapters` |

**Existing code** can continue to use `syncpoint-core` — it re-exports everything from the legacy copies. **New code** should import from the appropriate layered package.

```typescript
// ❌ Old — monolithic import
import { ResourceClaim, CheckpointReviewStatus, AgentStatus } from "syncpoint-core";

// ✅ New — layered imports
import { ResourceClaim } from "syncpoint-kernel";
import { CheckpointReviewStatus } from "syncpoint-governance";
import { AgentStatus } from "syncpoint-adapters";
```

## Key Exports (compatibility)

- **Types**: `ResourceClaim`, `Constraint`, `SyncGate`, `Checkpoint`, `ContextSnapshot`
- **State Machines**: `ResourceClaim`, `SyncGate`, `CheckpointReview`
- **Validation**: `SyncPointConfigSchema` (Zod), constraint evaluation
- **Pure Functions**: conflict detection, path normalization, function parsing

📖 See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for system design, [docs/API.md](../docs/API.md) for the full API reference, and [TASK/CORE_MIGRATION_ACCEPTANCE_PLAN.md](../TASK/CORE_MIGRATION_ACCEPTANCE_PLAN.md) for the migration roadmap.
