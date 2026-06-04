# SyncPoint Docs

Multiple AI coding agents drift out of sync surprisingly fast.

One agent changes auth logic. Another updates the frontend token flow. A third refactors API schemas. Eventually, nobody shares the same understanding of the project anymore.

SyncPoint experiments with checkpoint-based synchronization for AI coding agents.

```text
Without SyncPoint:
  Claude edits auth.ts
  Cursor edits auth.ts
  a checkpoint goes stale
  a handoff loses blockers
  assumptions drift
  conflict appears late

With SyncPoint:
  SyncGate triggered
  pause
  synchronize ownership, checkpoint, review, or operation state
  resume safely
```

## The Core Idea

SyncPoint is not primarily an agent runner, workflow builder, or AI operating system.

It is the layer agents call before they continue.

```text
pause -> sync -> resume
```

A `SyncGate` prevents AI agents from silently drifting out of sync.

Agents must synchronize before crossing collaboration boundaries: starting work, resuming from context, handing off, waking another agent, or applying an operation.

## What Problem It Solves

AI coding agents do not only break projects by generating bad code. They also break projects by continuing from different realities:

| Failure mode | What it feels like | SyncPoint mechanism |
|---|---|---|
| Two agents edit the same resource | Late merge conflicts or overwritten work | `ResourceClaim` + `SyncGate` |
| One agent resumes from stale context | Correct-looking work built on wrong assumptions | Checkpoints + context capsules |
| A handoff drops blockers and risks | The next agent repeats or undoes prior work | Handoff + projected context |
| A patch touches unowned resources | Review happens after damage is already staged | Operation validation |
| A reviewer approves without evidence | Approval becomes a guess | Review gate |
| A hard constraint is only in a prompt | The agent can ignore it accidentally | Constraint evaluation runtime |

The user-facing promise is simple:

```text
Stop unsafe continuation before agent drift becomes a codebase problem.
```

## Read This First

If you are new to the project, read in this order:

1. **SyncPoint tours** — [`tours/README.md`](tours/README.md)
2. **File shield aha moment** — [`tours/01-file-shield-tour.md`](tours/01-file-shield-tour.md)
3. **Problem and protocol** — [`core-synchronization.md`](core-synchronization.md)
4. **Visible chaos demo** — [`demo-sync-truncation.md`](demo-sync-truncation.md)
5. **Local operator guide** — [`local-operations-guide.md`](local-operations-guide.md)
6. **CLI agent loop** — [`cli-agent-loop.md`](cli-agent-loop.md)

Read these only after the core story is clear:

- **Architecture boundaries** — [`ARCHITECTURE.md`](ARCHITECTURE.md)
- **Architecture decisions** — [`architecture-decisions.md`](architecture-decisions.md)
- **Constraint evaluation runtime** — [`constraint-runtime.md`](constraint-runtime.md)
- **Reality runtime** — [`reality-runtime.md`](reality-runtime.md)
- **Plugin API** — [`plugin-api.md`](plugin-api.md)
- **Resource conventions** — [`resource-conventions.md`](resource-conventions.md)
- **Beyond code** — [`beyond-code.md`](beyond-code.md)

## The One-Sentence Definitions

- **SyncPoint**: A local synchronization protocol that stops AI coding agents from continuing from different realities.
- **SyncGate**: A hard boundary that prevents agents from silently drifting out of sync.
- **ResourceClaim**: A declaration of what an agent intends to change before it starts changing it.
- **Checkpoint**: Evidence of current project reality before another agent resumes from it.
- **Operation**: A tracked unit of change that can be checked before it is treated as safe.
- **Wake**: A synchronization obligation, not an autonomous job trigger.

## What To Show People

Do not start by explaining every primitive. Start with the collapse:

```text
Without SyncPoint:
  Agent A assumes auth tokens are session-based.
  Agent B changes auth tokens to JWT.
  Agent C updates frontend calls using the old assumption.
  Everyone keeps working.
  The break appears much later.

With SyncPoint:
  Agent B crosses a collaboration boundary.
  SyncGate blocks unsafe continuation.
  Agents synchronize the changed assumption and ownership boundary.
  Work resumes with the same project reality.
```

Then explain the implementation.

The implementation matters because it makes the stop real: ownership, gates, checkpoints, reviews, operations, wakes, MCP, CLI, and VS Code all exist to enforce the same `pause -> sync -> resume` loop.

## Tours As Protocol Spec

The tour guides are not marketing samples. They are executable stories for the core protocol:

| Tour | Protocol boundary |
|---|---|
| [`01-file-shield-tour.md`](tours/01-file-shield-tour.md) | `ResourceClaim` overlap creates a `SyncGate` before unsafe continuation |
| [`02-transaction-purity-tour.md`](tours/02-transaction-purity-tour.md) | `CheckpointReview` prevents unapproved checkpoints from becoming base reality |
| [`03-constraint-enforcement-tour.md`](tours/03-constraint-enforcement-tour.md) | Constraint Evaluation runtime blocks a `do_not_touch` scope violation |
| [`04-liveness-and-escalation-tour.md`](tours/04-liveness-and-escalation-tour.md) | liveness policies turn zombie gates into visible decisions |

When changing gate, transaction, constraint, or liveness behavior, update these tours as part of the same change.
