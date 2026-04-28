# Core Synchronization Protocol

SyncPoint is an **AI Agent Synchronization Protocol**. It is not a multi-agent runtime, workflow builder, or memory platform.

Every feature in SyncPoint exists to answer four questions:

| # | Question | Example |
|---|----------|---------|
| 1 | **Who is changing what?** | Agent A claims `src/auth.ts`, Agent B claims `src/api/*` |
| 2 | **When must they synchronize?** | When file claims overlap, when a task completes, when context drifts |
| 3 | **What must be confirmed at sync?** | Checkpoint summary, evidence, contract terms, conflict resolution |
| 4 | **Who continues after confirmation?** | Wake the reviewer, resume the executor, hand off to the next agent |

If a feature does not answer one of these four questions, it does not belong in SyncPoint.

---

## What SyncPoint Is Not

| It is not… | Why |
|-----------|-----|
| A multi-agent runtime | SyncPoint does not run models or schedule autonomous loops |
| A workflow builder | No visual DAGs, no LangGraph-style graphs |
| A memory platform | Project memory exists to support sync context, not as a general knowledge base |
| An auto-pilot | Wake requests notify agents at sync points — they do not drive continuous execution |

---

## Core Primitives

### 1. Sync State

A shared, local record of:
- Which agents exist and what roles they hold
- Which tasks are assigned, in progress, blocked, or done
- Which session phase the collaboration is in (PLANNING → EXECUTING → REVIEWING → COMPLETED)

**Sync question**: *Who is changing what?*

### 2. Checkpoint / Context Capsule

- **Checkpoint**: A point-in-time snapshot of an agent's progress — summary, decisions made, risks, blockers
- **Context Capsule**: A compressed, task-scoped context bundle that minimizes token consumption when resuming

Together they ensure that when an agent stops and another picks up, the receiver gets exactly the context they need — no more, no less.

**Sync question**: *What must be confirmed at sync?*

### 3. Conflict Awareness (FileClaim)

Agents declare which files they intend to modify:
- `FileClaim` records agent + task + file paths (exact or glob)
- Claims can be `exclusive` (only this agent) or `shared` (multiple agents, but aware)
- When claims overlap, the system flags a **conflict** and suggests a sync gate

**Sync question**: *When must they synchronize?*

### 4. Handoff / Resume

Structured context transfer between agents:
- The outgoing agent writes a handoff summary with context capsule
- The incoming agent gets a resume prompt with all relevant state
- No information is lost in the transition

**Sync question**: *Who continues after confirmation?*

### 5. Sync Gate

A synchronization barrier that must be cleared before work continues:
- Triggered by file conflicts, phase transitions, or manual request
- All required agents must acknowledge the gate
- Until the gate passes, affected agents are blocked from proceeding

**Sync question**: *When must they synchronize?* + *What must be confirmed?*

### 6. Wake (Sync Verbs Only)

Wake requests notify agents that a sync point requires their attention. Wake actions are limited to **synchronization verbs**:

| Wake Action | Sync Semantic |
|------------|---------------|
| `plan` | Architect must decompose work (sync on scope) |
| `accept` | Agent must confirm assignment (sync on responsibility) |
| `checkpoint` | Agent must save progress (sync on state) |
| `sync` | Agent must resolve a conflict or gate (sync on boundary) |
| `review` | Reviewer must evaluate work (sync on quality) |
| `handoff` | Agent must transfer context (sync on continuity) |
| `resume` | Agent must pick up transferred work (sync on continuity) |
| `approve` | Gate keeper must approve (sync on decision) |

Wake does **not** trigger open-ended "keep working" actions. Every wake has a specific sync obligation.

---

## Relationship Modes

Different collaboration patterns have different sync rules:

| Mode | Pattern | Sync Rule |
|------|---------|-----------|
| **manager-delegate** | Architect assigns, executor reports back | delegate → work → checkpoint → report → review |
| **peer-contract** | Two agents agree on interface boundaries | contract → parallel work → checkpoint sync → merge |
| **handoff-resume** | One agent passes work to another | capsule → handoff → accept → resume |

The relationship mode determines when sync gates fire and what evidence is required.

---

## Supporting Capabilities

These features support the core protocol but are not the protocol itself:

- **Session Orchestration** — phases and role assignments for structured collaboration
- **Review Workflow** — checklist + evidence + approval gate for quality sync
- **Project Memory** — curated knowledge that informs sync context
- **Auto-Wake** — event-driven notification at sync points
- **MCP / CLI / SDK** — entry points that all go through the same application layer

---

## Design Principles

1. **Sync constraints over automation** — Make agents stop at the right moments, don't make them run forever
2. **Local-first** — SQLite database, no cloud dependency, works offline
3. **Protocol over platform** — Core is portable types + state machines, runtime is pluggable
4. **Evidence-based** — Every sync point should have auditable evidence (checkpoint, capsule, review)
5. **Entry-point agnostic** — Same logic whether called from CLI, MCP, tRPC, or SDK
