# Core Synchronization Protocol

AI coding agents drift out of sync surprisingly fast.

One agent changes auth logic. Another updates the frontend token flow. A third refactors API schemas. Each change can be reasonable in isolation, but the agents no longer share the same project reality.

SyncPoint exists for that moment.

```text
Without SyncPoint:
  agents keep working
  assumptions diverge
  ownership is unclear
  stale checkpoints get reused
  handoffs lose blockers
  conflicts appear late

With SyncPoint:
  SyncGate triggered
  pause
  synchronize ownership, checkpoint, review, or operation state
  resume safely
```

The core loop is:

```text
pause -> sync -> resume
```

`SyncGate` prevents AI agents from silently drifting out of sync.

SyncPoint is a protocol layer for **synchronization truncation**:

```text
multiple editor AIs work in one codebase
  -> each agent wants to continue
  -> SyncPoint checks shared local sync state
  -> unresolved claim / gate / transaction / review / operation blocks continuation
  -> the required agents align
  -> only then does work continue
```

It is not a multi-agent runtime, workflow builder, memory platform, or automation runner.

## The Four Questions

Every core primitive answers one of four protocol questions:

| # | Question | Example |
|---|---|---|
| 1 | **Who is changing what?** | Agent A owns `src/auth.ts`; Agent B owns `src/api/*` |
| 2 | **When must they synchronize?** | Resource claims overlap; a checkpoint needs approval; an operation conflicts |
| 3 | **What must be confirmed?** | Checkpoint summary, resource boundary, review evidence, operation safety |
| 4 | **Who continues after confirmation?** | Wake the reviewer, resume the executor, hand off to the next agent |

If a feature does not answer one of these questions, it is supporting infrastructure, not the core protocol.

## What SyncPoint Is Not

| It is not | Boundary |
|---|---|
| Multi-agent runtime | It does not call model APIs or run agent loops |
| Workflow builder | It does not build arbitrary DAGs or visual flows |
| Generic scheduler | Wake is not a job queue for arbitrary work |
| File lock daemon | The core protocol does not stop external processes that bypass SyncPoint |
| Memory product | Project memory only supports synchronization context |

The design assumes agents call SyncPoint before starting, resuming, patching,
reviewing, or handing off work. Hard file-write enforcement is a separate
roadmap: controlled writes first, editor hard-save next, guarded workspace
last. For that filesystem enforcement design, see
[`system-file-lock-design.md`](system-file-lock-design.md).

## Synchronization Truncation

SyncPoint truncates unsafe continuation paths.

```text
agent continuation path
  -> loop resume
  -> assignment start
  -> wake next
  -> wake start
```

Before those paths continue, SyncPoint checks whether the agent is blocked by unresolved sync state.

The most important invariant:

```text
SYNC_ACKED still blocks.
Only READY_TO_CONTINUE or CANCELLED releases a SyncGate.
```

Acknowledgement is awareness. Resolution is permission to continue.

## Core Primitives

### 1. Resource Claim

`ResourceClaim` records resource ownership:

- **actor**: who intends to modify the resources
- **task**: why the files are being touched
- **session**: which collaboration scope owns the claim
- **resources**: typed locators such as `file:src/auth.ts`, `binary_asset:assets/hero.png`, or `db_table:users`
- **mode**: `exclusive` or `shared`

When active claims overlap, SyncPoint detects a conflict. A hard exclusive overlap can create a `SyncGate` automatically.

### 2. SyncGate

`SyncGate` is the hard synchronization barrier.

```text
NEEDS_SYNC
  -> SYNC_REQUESTED
  -> SYNC_ACKED
  -> READY_TO_CONTINUE
```

Gate reasons include:

| Reason | Meaning |
|---|---|
| `resource_conflict` | Agents claim overlapping resource ownership |
| `checkpoint_required` | A checkpoint must be approved before continuing |
| `phase_transition` | Session phase requires coordination |
| `context_drift` | Resume context is unsafe or stale |
| `manual_request` | Human or agent explicitly requests synchronization |

### 3. Sync Transaction

`SyncTransaction` upgrades a checkpoint from a progress log into an approval flow.

```text
checkpoint created
  -> sync transaction opened
  -> bound SyncGate blocks continuation
  -> required approvers approve or reject
  -> transaction resolved
  -> bound gate released
```

This is how SyncPoint turns "I saved progress" into "the next agent may safely continue from this confirmed state."

### 4. Operation

`Operation` makes a tracked unit of work auditable before it is treated as applied. Code patches are represented as `type: "code_patch"` operations, while plugins can define other operation types such as `asset_edit`.

Registered validators can check:

| Check | Purpose |
|---|---|
| Payload or metadata format | Domain-specific payload/metadata is valid when supplied |
| Target resources known | SyncPoint knows which resources are touched |
| Resources covered by claims | The submitting actor owns the touched resources |
| No hard conflict | No other active exclusive claim overlaps |

Submitted or conflicting operations appear as blockers in Sync View until approved, rejected, fixed, or applied.

### 5. Wake with Semantic Intent

Wake is not an auto-runner. It is a synchronization notification.

Valid wake actions are sync verbs:

```text
plan
accept
claim-resources
checkpoint
sync-checkpoint
review
approve
handoff
resume
address-changes
advance-session
```

A wake request must answer:

```text
Who needs attention?
What sync action should they perform?
Which event caused the wake?
Which session/task/review does it belong to?
```

Wake requests are blocked by the same gate checks as other continuation paths.

## Enforcement Points

SyncPoint is enforced in the application layer used by CLI, MCP, SDK, tRPC, and the VS Code extension.

| Entry point | Enforcement behavior |
|---|---|
| `orchStartAssignment()` | Blocks start if the assignee has active gates; `peer-contract` also requires resource claims |
| `loopResume()` | Blocks resume if context policy or hard gates fail |
| `wakeNext()` | Suppresses wake dispatch while the target agent is blocked |
| `wakeStart()` | Prevents starting a queued wake through an unresolved gate |
| `opSubmit()` / `opCheck()` | Blocks approval when operation ownership or conflict checks fail |

This is protocol-level hard truncation. It is not an operating-system file lock,
and it does not intercept arbitrary shell, git, generator, or editor writes by
itself.

The byte-write boundary belongs to the system-level file lock roadmap:

```text
controlled write API
  -> editor hard-save guard
  -> guarded workspace proxy
```

That separation keeps the core protocol portable while future write paths and
filesystem proxies enforce the same claims, gates, operations, constraints, and
projection fail-closed rules before bytes reach protected files.

## Relationship Modes

Relationship mode defines which synchronization rules are expected in a session.

| Mode | Collaboration pattern | Sync rule |
|---|---|---|
| `manager-delegate` | Architect assigns; executor reports; reviewer approves | plan -> accept -> checkpoint -> review -> approve |
| `peer-contract` | Peers work in parallel with explicit boundaries | contract -> claim resources -> checkpoint sync -> operation/review |
| `handoff-resume` | One agent transfers work to another | capsule -> handoff -> accept -> resume |

`peer-contract` is the clearest mode for demonstrating synchronization truncation because resource claims are required before work starts.

## Sync View Model

The VS Code extension reads a single sync snapshot and renders six sections:

| Section | What it shows |
|---|---|
| Sessions | Active sessions, modes, and agent roles |
| Active Work | Assignments, claimed resources, blocked agents |
| Resource Ownership | Claims and hard conflicts |
| Blockers | Gates, sync transactions, handoffs, reviews, submitted/conflicting operations |
| Operations | Operation state and required next action |
| Wake Queue | Pending sync obligations and their semantic source |

The view is not a separate source of truth. It is a visual projection of the same protocol state.

## Design Principles

1. **Synchronization over automation** — Make agents stop at the right moments.
2. **Resolution over acknowledgement** — `SYNC_ACKED` still blocks.
3. **Local-first** — SQLite state under `.syncpoint/`; no cloud dependency.
4. **Protocol over platform** — Core rules are portable; entry points are adapters.
5. **Evidence before continuation** — Checkpoints, reviews, and operations carry auditable state.
6. **One story everywhere** — README, CLI, MCP, and Sync View all describe claims, gates, blockers, transactions, operations, and wakes.
