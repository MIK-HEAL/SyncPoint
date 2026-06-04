# SyncPoint — Architecture & Layer Boundary Principles

## System Overview

SyncPoint is a local-first synchronization hub for AI coding agents. It coordinates multiple agents working in the same codebase through resource locking, constraint enforcement, checkpoint management, and real-time event streaming.

### Package Dependency Flow

```
syncpoint-core ← syncpoint-server ← syncpoint-cli
                                 ← syncpoint-mcp
                                 ← syncpoint-sdk
```

### Core Concepts

| Concept | Purpose |
|---------|---------|
| **Resource & Claim** | File/function/line_range locking with conflict detection |
| **Constraint** | Policy rules (do_not_touch, require_review) enforced pre-write |
| **SyncGate** | Synchronization barrier requiring multi-agent acknowledgment |
| **Checkpoint** | Saved progress point with summary, risks, and next steps |
| **ContextSnapshot** | Full/delta agent context capture with integrity hashes |
| **Event Bus & SSE** | Real-time event streaming with sequence numbers and replay |

### State Machine Quick Reference

- **ResourceClaim**: `ACTIVE` → `RELEASED`
- **SyncGate**: `NEEDS_SYNC` → `WAITING_APPROVAL` → `APPROVED` → `READY_TO_CONTINUE` (or `CANCELLED`)
- **CheckpointReview**: `OPEN` → `WAITING_APPROVAL` → `APPROVED`/`REJECTED` → `RESOLVED`

---

Where does new code go? Use this decision tree before creating a new file
or adding logic to an existing one.

## Four Layers

| Layer | Location | Responsibility | May import |
|-------|----------|---------------|------------|
| **Protocol rule** | `syncpoint-kernel`, `syncpoint-context`, `syncpoint-governance`, `syncpoint-adapters` | Pure functions, types, state machines, validation. No I/O. | nothing outside own layer |
| **Facade** | `syncpoint-core` | Re-exports all four domain packages as a unified surface. | kernel, context, governance, adapters |
| **Use case / state transition** | `syncpoint-server/src/application/` | Orchestrates repo calls, enforces invariants, emits events. One public function ≈ one use case. | core, repositories, other services (sparingly) |
| **Read model / query aggregation** | `syncpoint-server/src/application/` (suffix: `-service.ts`) | Assembles cross-domain read views (e.g. `sync-status-service.ts`). No writes. | core, repositories, other services |
| **Transport adapter** | routers (`tRPC`), CLI commands, MCP tools, VS Code extension | Input validation → delegate to application layer → format output. **No business logic.** | application layer only |

## Rules of Thumb

1. **Router ≠ service.** If a router does more than validate input and call
   a service function, the logic belongs in `application/`.

2. **Judgment logic lives in one place.** "What counts as a blocker?" or
   "Is this agent blocked?" should be a shared helper or core function —
   never re-derived inline in two files.

3. **Cross-domain coordination goes through services, not direct repo
   calls.** If a function touches sessions *and* gates *and* wakes, it
   should be an application-layer service, not an inline block inside a
   router or CLI command.

4. **Core stays pure.** `syncpoint-core` must never import from `server`,
   `cli`, `mcp`, or `sdk`. If you need I/O, it belongs in `server`.

5. **Don't over-abstract.** One service per bounded context is enough.
   Facades, abstract factories, and "manager of managers" patterns are
   not welcome here.

## When Adding a New Capability (P11, P12, …)

Ask:

- Is this a **protocol rule** (pure logic, no DB)?  → appropriate domain package (`syncpoint-kernel`, `syncpoint-context`, `syncpoint-governance`, `syncpoint-adapters`)
- Is this a **write use case** (create/update state)?  → `application/*-service.ts`
- Is this a **read aggregation** (query + join + format)?  → `application/*-service.ts` (read model)
- Is this a **transport concern** (HTTP shape, CLI flags, MCP tool schema)?  → `routers/` or adapter layer

If unsure, default to `application/` — it's easier to push down to core
later than to extract up from a router.

## Reality Runtime Layers

SyncPoint's memory system is a five-layer executable runtime (see `docs/reality-runtime.md`):

| Layer | Purpose | Location |
|-------|---------|----------|
| **Project Memory** | Long-term reality source code | `syncpoint-context` |
| **Projection Layer** | Reality Compiler — scopes, traces, detects conflicts | `syncpoint-context` |
| **Context Capsule** | Agent's current task reality mirror | `syncpoint-context` |
| **Protocol Gate** | Collaboration boundary (gates, transactions, claims) | `syncpoint-kernel` |
| **Constraint Runtime** | Executable enforcement — blocks on violations | `syncpoint-governance` |

**Key invariants**:

- Raw Project Memory content never reaches agent prompts — only compiled projections.
- `hard_constraint` / `protocol_rule` must enter gate/runtime, never capsule-only.
- Projection conflicts are always surfaced explicitly, never silently merged.
- Constraint evaluation is read-only; enforcement happens at entry points (`loopResume`, `orchStartAssignment`, `wakeStart`, `opCheck`).

## Filesystem as Agent Registry

SyncPoint uses the project's `.syncpoint/agents/` directory as the **agent registry**. Creating a manifest file in this directory registers the agent; deleting the file removes it. This is the primary registration mechanism.

### How it works

```text
.syncpoint/agents/
├── my-agent.yml          # YAML manifest → auto-synced into runtime
├── reviewer-alice.yml    # each file = one declared agent
└── ops-bot.json          # JSON manifests also supported
```

1. **File creation** → watcher detects new file → `syncDeclaredAgentFile()` parses and upserts into DB
2. **File modification** → watcher triggers re-sync → runtime agent updated
3. **File deletion** → watcher marks agent as "removed" → runtime agent deactivated

### Manifest schema

Each manifest file contains:

| Field | Required | Description |
|-------|----------|-------------|
| `version` | yes | Schema version (currently `1`) |
| `name` | yes | Agent display name |
| `provider` | no | AI provider (`auto_detect`, `cursor`, `claude-code`, etc.) |
| `profile` | no | Agent profile (`general`, `executor`, `reviewer`, `manager`) |
| `role` | no | Explicit role override |
| `tags` | no | String array for categorization |
| `capabilities` | no | Capability domains with optional proficiency |
| `availability` | no | Availability status |
| `autoStart` | no | Whether to auto-start on session creation |
| `notes` | no | Freeform notes |

### Application-layer functions

| Function | Location | Purpose |
|----------|----------|---------|
| `syncDeclaredAgents()` | `agent-registry-service.ts` | Full rescan of `.syncpoint/agents/` |
| `syncDeclaredAgentFile()` | `agent-registry-service.ts` | Sync a single file by path |
| `listDeclaredAgents()` | `agent-registry-service.ts` | Query declared agents with metadata |
| `initAgentManifest()` | `agent-registration/init.ts` | Create a single manifest file |
| `initProjectAgents()` | `agent-registration/init.ts` | Bootstrap example + team manifests |
| `diagnoseAgentRegistry()` | `agent-registration/diagnose.ts` | Diagnose errors and suggest fixes |
| `validateAgentDeclarations()` | `agent-registration/validate.ts` | Schema validation |
| `migrateRuntimeAgentsToDeclaredManifests()` | `agent-registration/migrate.ts` | Convert DB agents to files |

### Key invariant

**Creating a manifest file registers the agent.** There is no separate registration API. The file IS the registration. This ensures:

- Agent declarations are version-controllable (git-trackable)
- The registry state is always derivable from the filesystem
- No orphan agents exist without a corresponding file
