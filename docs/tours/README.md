# SyncPoint Tours

These tours are the fastest way to understand why SyncPoint exists.

Do not start with architecture. Start with a small disaster:

```text
Without SyncPoint:
  two agents keep working
  resource ownership is implicit
  stale checkpoints look usable
  constraints live only in prompts
  zombie blockers stay invisible
  the failure appears late

With SyncPoint:
  ResourceClaim records ownership
  SyncGate cuts off unsafe continuation
  SyncTransaction protects checkpoint purity
  Constraint Runtime enforces hard boundaries
  liveness policies make blockers explainable and actionable
```

Each tour is both onboarding material and protocol specification. If a future implementation changes the behavior, update the tour with the same care as a test fixture.

## Read In This Order

| Tour | Disaster | What you should see |
|---|---|---|
| [01 — File Shield](01-file-shield-tour.md) | Concurrent edits to `src/shared-config.ts` | The second agent creates a resource-conflict `SyncGate` before continuing |
| [02 — Transaction Purity](02-transaction-purity-tour.md) | Work resumes from an unapproved checkpoint | A checkpoint approval transaction blocks unsafe resume |
| [03 — Constraint Enforcement](03-constraint-enforcement-tour.md) | An agent touches `src/auth/*` despite a freeze | Constraint Runtime returns `BLOCKED` with `do_not_touch_scope_overlap` |
| [04 — Liveness And Escalation](04-liveness-and-escalation-tour.md) | A gate becomes a zombie blocker | Status, deadline, votes, and liveness preview make the gate actionable |

## Current CLI Reality

The tours avoid pretending that every protocol edge has a polished terminal command today.

- **Fully CLI-runnable now**: claims, gates, gate status, gate acknowledgements, gate votes, checkpoint transactions, constraint visibility.
- **Compatibility naming**: `syncpoint patch ...` still names the command group `patch`, but it manages generic `Operation` lifecycle state.
- **Integration-level paths**: scoped Project Memory authoring, generic operations with `targetResources`, and claim release are already in application/MCP layers, but not all have first-class short CLI commands yet.

That distinction is intentional. The tours should be honest enough to guide implementation priorities instead of hiding gaps behind fake commands.
