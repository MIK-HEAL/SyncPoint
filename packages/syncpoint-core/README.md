# syncpoint-core

SyncPoint protocol core — types, state machines, Zod schemas, and pure functions for resource locking, constraint evaluation, and sync gates.

## Usage

```typescript
import {
  detectResourceClaimConflicts,
  evaluateConstraints,
  SyncPointConfigSchema,
  ResourceClaimStateMachine,
} from "syncpoint-core";

// Validate a claim transition
const nextState = ResourceClaimStateMachine.transition(
  currentState,
  "ACTIVATE"
);
```

## Key Exports

- **Types**: `ResourceClaim`, `Constraint`, `SyncGate`, `Checkpoint` `ContextSnapshot`
- **State Machines**: `ResourceClaim`, `SyncGate`, `CheckpointReview`
- **Validation**: `SyncPointConfigSchema` (Zod), constraint evaluation
- **Pure Functions**: conflict detection, path normalization, function parsing

📖 See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for system design and [docs/API.md](../docs/API.md) for the full API reference.
