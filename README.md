<div align="center">

# SyncPoint

**Stop agent drift before it becomes a merge conflict.**

Coordinate coding agents, design agents, data agents — any AI that shares resources.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange?logo=pnpm)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](packages/syncpoint-mcp)

</div>

---

> **⚠️ Breaking Schema Reset (v0.2)**
>
> This version introduces a breaking database reset. The local `.syncpoint/` database is **not compatible** with previous versions. To upgrade:
> 1. Delete `.syncpoint/` (or the directory pointed to by `SYNCPOINT_DB_DIR`)
> 2. Re-run `syncpoint init`
>
> There is no automatic migration from the old schema. This is intentional — the schema has been normalized and simplified.
>
> Key terminology changes:
> - ~~Projection Compiler~~ → **Reality Projection** (task-scoped memory view builder)
> - ~~Constraint Runtime~~ → **Constraint Evaluation** (pure constraint checker)
> - ~~Context Capsule~~ → **Context Snapshot** (typed resume payload)
> - ~~SyncTransaction~~ → **Checkpoint Review** (approval join table)

---

## The Problem

AI coding agents don't fail only because they write bad code.  
They fail because they **continue from different realities**.

- Agent A owns `shared-config.ts`. Agent B edits it anyway. Neither knows.
- A checkpoint goes stale. Another agent resumes from it and builds on wrong assumptions.
- A patch touches files outside the agent's claim. Nobody checks before apply.
- A handoff loses the blockers, risks, and review state the previous agent built up.
- A hard constraint says "do not touch the auth module." The agent touches it. Nothing stops it.
- Two agents race on the same interface. The slower one overwrites the faster one's work.
- A design agent updates a frozen brand logo. No constraint enforces the freeze.

By the time you notice, the damage is a merge conflict — or worse, silently wrong code in production.

## What SyncPoint Does

SyncPoint is a **local coordination protocol** for AI agents that share resources.

Before an agent starts, resumes, wakes, checkpoints, or applies a change, SyncPoint checks whether the continuation path is safe. If it isn't, **it blocks**.

> **Not just code.** SyncPoint coordinates any addressable resource — source files, binary assets, design artifacts, documents, datasets. The same claim/gate/constraint loop works for `src/auth.ts` and `assets/hero-banner.png`. See [Beyond Code](docs/beyond-code.md).

```text
Agent wants to continue
  → SyncPoint checks ownership, gates, reviews, constraints
  → conflict found: two agents claim the same file
  → continuation blocked
  → agent must acknowledge and resolve the boundary
  → only then can work continue
```

This is called **synchronization truncation**: unsafe continuation is cut off before the damage happens, not cleaned up after.

## When You Need SyncPoint

You probably need SyncPoint if:

- You run **more than one AI coding agent** on the same codebase
- Agents **hand off work** across sessions or to other agents
- Agents **edit overlapping files** without knowing about each other
- Reviewers need to **approve AI-generated operations** before they're applied
- Long tasks **resume from stale context** and nobody validates the checkpoint
- You need to see **who is blocked, why, and what unblocks them**

## How It Works

SyncPoint enforces boundaries through five protocol primitives:

| Primitive | What it does |
|---|---|
| **ResourceClaim** | Agent declares "I will touch these resources" — overlapping claims create blockers automatically |
| **SyncGate** | A hard stop — the agent cannot continue until the gate is resolved, not just acknowledged |
| **CheckpointReview** | A checkpoint that requires approval before another agent can resume from it |
| **Operation** | A tracked unit of change checked for ownership, conflicts, and constraints before apply |
| **Wake** | A sync obligation — "this agent needs to review / approve / acknowledge before continuing" |

These are enforced at every execution boundary. An agent cannot silently skip a gate or ignore a file conflict.

### What happens under the hood

Each agent carries a **context snapshot** — a typed payload of its current task, working resources, active constraints, and blockers. The snapshot is what the agent sees. But what the agent sees is not what decides whether it can continue.

SyncPoint maintains **project memory** — typed, versioned, deduplicated knowledge entries (facts, conventions, risks, hard constraints, do-not-touch rules). These are projected and scoped per task via **Reality Projection**, so each agent gets only the constraints relevant to its work. Hard constraints and protocol rules are enforced at every execution boundary via **Constraint Evaluation** — they cannot be ignored even if the agent's prompt doesn't mention them.

When an agent tries to continue, SyncPoint checks:

- Do the agent's working resources overlap a protected scope? → **blocked**
- Is there an unresolved resource ownership conflict? → **blocked**
- Is there an open gate or pending transaction? → **blocked**
- Does an operation touch resources outside the agent's claim? → **blocked**
- Is the agent's checkpoint stale or invalid? → **blocked**

If everything is clean, the agent continues. If not, the specific blocker is surfaced with the reason, the source, and what needs to happen to unblock.

Architecture details: [`docs/reality-runtime.md`](docs/reality-runtime.md) · [`docs/constraint-evaluation.md`](docs/constraint-evaluation.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## What SyncPoint Is Not

| SyncPoint is not | Why |
|---|---|
| Agent runner | It does not call model APIs or run autonomous loops |
| Workflow builder | It does not build arbitrary DAGs or visual flows |
| Job scheduler | Wake requests are sync obligations, not background jobs |
| File lock daemon | See enforcement levels below |
| Memory product | Memory supports synchronization, not generic recall |

**SyncPoint is the layer agents call before they continue.**

### Enforcement Levels

SyncPoint's write protection is **layered**, not all-or-nothing:

| Level | What it blocks | What can bypass it |
|---|---|---|
| L0 — Audit | Nothing (detects after the fact) | Everything |
| L1 — Controlled write API | Writes routed through SyncPoint | Any process that doesn't use SyncPoint |
| L2 — Editor hard-save | Supported editor saves | Shell, git, external tools |
| L3 — Guarded workspace | All writes inside the project root (file permissions) or mounted workspace (FUSE/WinFsp) | Admin/owner override of permissions; direct writes to the backing store if using mount |
| L4 — OS policy driver | Native writes at kernel/minifilter level | Admin/root override |

**L1 is a cooperation protocol, not a security boundary.** If Agent B does not route writes through SyncPoint, L1 cannot stop it. This is by design — SyncPoint starts useful without requiring kernel drivers or filesystem mounts.

To actually prevent non-cooperating processes from writing protected files, deploy **L3** via `syncpoint guard session --mode strict`. In strict mode, SyncPoint sets claimed files to read-only and only unlocks them transiently during authorized `writeApply` calls. A reconciliation watcher (`syncpoint guard reconcile`) detects any bypass. See [`docs/system-file-lock-design.md`](docs/system-file-lock-design.md) for the full enforcement architecture.

## Quick Start

### Install

```bash
npm install -g syncpoint-cli
```

Or for local development:

```bash
pnpm install
pnpm build
```

### Run the demo

```bash
syncpoint demo
```

If not globally installed:

```bash
node packages/syncpoint-cli/dist/main.js demo
```

This creates a temporary workspace and shows:

1. **Agent A** claims `src/shared-config.ts`
2. **Agent B** tries to claim the same file — **BLOCKED**
3. A checkpoint requires approval — **BLOCKED**
4. Blockers are resolved — both agents can continue

You'll see output like:

```text
SyncPoint blocked unsafe continuation.

Blocked agent:
  agent-b-cursor (cursor)

Why:
  - src/shared-config.ts is already claimed by agent-a-claude
  - checkpoint requires approval before another agent continues
```

### See the full state

```bash
syncpoint status
```

Shows sessions, agents, resource claims, conflicts, blockers, and suggested actions.

### Stop at the blocked state

```bash
syncpoint demo --stage blocked
```

Then inspect with `syncpoint status` before continuing.

Full walkthrough: [`docs/demo-sync-truncation.md`](docs/demo-sync-truncation.md)

### Take the tours

The fastest way to understand SyncPoint is to run the protocol tours:

```text
docs/tours/01-file-shield-tour.md
docs/tours/02-transaction-purity-tour.md
docs/tours/03-constraint-enforcement-tour.md
docs/tours/04-liveness-and-escalation-tour.md
```

Start with [`docs/tours/README.md`](docs/tours/README.md). The tours are the project’s quick-start guide and living protocol specification.

## Protocol Primitives

SyncPoint is built around five protocol primitives.

| Primitive | Plain-English meaning | Why it matters |
|---|---|---|
| **ResourceClaim** | "I intend to touch these resources." | Makes ownership explicit before work starts |
| **SyncGate** | "Stop here until this is resolved." | Blocks unsafe start, resume, and wake paths |
| **CheckpointReview** | "This checkpoint needs approval." | Turns progress into an approved continuation point |
| **Operation** | "Check this unit of change before treating it as safe." | Validates target resources, ownership, conflicts, and constraints |
| **Wake** | "This agent has a sync obligation." | Notifies the right agent to review, approve, handoff, or resume |

The most important invariant:

```text
SYNC_ACKED still blocks.
Only READY_TO_CONTINUE or CANCELLED releases a SyncGate.
```

Acknowledgement means "I saw the sync point."  
Resolution means "the boundary is now safe to cross."

## Minimal Real-World Flow

```text
create sync session
  -> choose relationship mode: manager-delegate, peer-contract, or handoff-resume
  -> agents accept scoped work
  -> agents claim resources before changing them
  -> overlapping claims create blockers
  -> checkpoint creates a sync transaction when approval is needed
  -> operation checks touched resources against claims and constraints
  -> constraint evaluation blocks if do_not_touch or hard_constraint is violated
  -> review records evidence and approval state
  -> wake queue tells the next agent what sync action is required
  -> Sync View shows the whole map
```

For the clearest first experience, use `peer-contract` mode because resource boundaries and conflicts are easy to see.

## CLI Commands

v0.1 top-level commands:

| Command | What it does |
|---|---|
| `syncpoint init` | Initialize `.syncpoint/` state |
| `syncpoint demo` | Run the disaster blocking demo |
| `syncpoint status` | Show who is blocked, why, and what to do |
| `syncpoint claim <locators>` | Declare resource ownership (`--type file` default) |
| `syncpoint checkpoint` | Save progress + context capsule |
| `syncpoint resume` | Resume from latest capsule/checkpoint |
| `syncpoint wake` | Check or acknowledge pending sync obligations |

Power-user commands (subgroups):

```bash
syncpoint session create --title "..." --architect <id> --mode peer-contract
syncpoint sync ack --gate <gateId> --agent <agentId>
syncpoint sync resolve --gate <gateId> --summary "Resolved"
syncpoint sync tx approve --tx <txId> --agent <agentId>
syncpoint patch approve --id <operationId> --agent <agentId>
syncpoint review approve --review <id> --summary "Approved" --by <agentId>
syncpoint constraint check --action resume --task <taskId> --agent <agentId>
```

## Editor Agent Integration

SyncPoint exposes the same protocol through MCP, so editor agents can inspect blockers, claim files, checkpoint work, query constraints, and receive sync-aware prompts.

### Cursor `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["<SYNCPOINT_REPO>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "<YOUR_PROJECT_ROOT>"
      }
    }
  }
}
```

### VS Code `.vscode/mcp.json`

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["<SYNCPOINT_REPO>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

MCP details: [`packages/syncpoint-mcp/README.md`](packages/syncpoint-mcp/README.md)

## Sync View

The VS Code extension provides a single visual map of the synchronization state:

| Section | Purpose |
|---|---|
| **Sessions** | Current sync sessions and relationship modes |
| **Active Work** | Assignments, work status, and constraint blocks |
| **Resource Ownership** | Active resource claims and hard conflicts |
| **Blockers** | Gates, transactions, reviews, and handoffs that stop continuation |
| **Operations** | Operation lifecycle and check results |
| **Wake Queue** | Pending sync obligations for agents |

This is the operator view for answering: **"Who is blocked, why, and what unblocks them?"**

## Repository Layout

```text
packages/
├── syncpoint-core         # protocol types, state machines, reality projection, constraint evaluation
├── syncpoint-server       # application services, SQLite, tRPC, SSE
├── syncpoint-cli          # operator CLI for sessions, gates, transactions, operations, constraints
├── syncpoint-mcp          # MCP adapter for editor AI agents
├── syncpoint-plugin-code  # code-domain plugin — file resources, code operation validators, compat adapters
├── syncpoint-plugin-generic-agent  # generic resource plugin — artifact/binary/document claims, validators, constraint evaluators
├── syncpoint-sdk          # typed client for integrations
└── vscode-extension       # Sync View for claims, blockers, operations, wakes
```

The architectural rule:

```text
syncpoint-core defines the protocol and pure evaluation logic.
syncpoint-server enforces the protocol and manages state.
CLI, MCP, SDK, and VS Code are transport adapters — no business logic.
```

## Local State

SyncPoint is local-first. Database location priority:

| Priority | Location |
|---|---|
| 1 | `SYNCPOINT_DB_DIR` |
| 2 | project-local `.syncpoint/syncpoint.db` |
| 3 | fallback `~/.syncpoint/syncpoint.db` |

The demo script uses an isolated `.tmp/syncpoint-demo-*` project so it does not pollute your repository state.

## Documentation Map

Start here:

| Document | Best for |
|---|---|
| [`docs/tours/README.md`](docs/tours/README.md) | Running the four disaster tours that explain the protocol in practice |
| [`docs/demo-sync-truncation.md`](docs/demo-sync-truncation.md) | Running the 10-15 minute synchronization truncation demo |
| [`docs/core-synchronization.md`](docs/core-synchronization.md) | Understanding protocol primitives and invariants |
| [`docs/local-operations-guide.md`](docs/local-operations-guide.md) | Operating SyncPoint locally with CLI, MCP, server, and Sync View |

Architecture and runtime:

| Document | Best for |
|---|---|
| [`docs/reality-runtime.md`](docs/reality-runtime.md) | Layered reality architecture — Project Memory, Reality Projection, Context Snapshot, Constraint Evaluation |
| [`docs/constraint-evaluation.md`](docs/constraint-evaluation.md) | Constraint evaluation rules, enforcement entry points, visibility layer |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layer boundary principles and code placement guide |
| [`docs/plugin-api.md`](docs/plugin-api.md) | Plugin extension points — ResourceMatcher, OperationValidator, writing new plugins |
| [`docs/beyond-code.md`](docs/beyond-code.md) | SyncPoint as a resource-first protocol — beyond code files |
| [`docs/resource-conventions.md`](docs/resource-conventions.md) | Resource locator/metadata conventions, appliesTo scoping, type standards |

Operational guides:

| Document | Best for |
|---|---|
| [`docs/session-playbook.md`](docs/session-playbook.md) | Role-by-role sync responsibilities |
| [`docs/review-workflow.md`](docs/review-workflow.md) | Evidence-backed review as a synchronization gate |
| [`docs/cli-agent-loop.md`](docs/cli-agent-loop.md) | Start, resume, checkpoint, and handoff paths |
| [`docs/runtime-identity.md`](docs/runtime-identity.md) | MCP runtime identity binding |
| [`docs/mvp-showcase.md`](docs/mvp-showcase.md) | Short presentation script |

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Package manager | pnpm workspaces |
| Database | SQLite + Drizzle ORM |
| API | tRPC |
| Validation | Zod |
| Events | EventEmitter + SSE |
| Tests | Vitest |
| Editor integration | MCP + VS Code extension |

## Examples

| Scenario | Directory | What it shows |
|---|---|---|
| File conflict | [`examples/conflict`](examples/conflict) | Two agents claim the same file — blocked |
| Stale resume | [`examples/stale-resume`](examples/stale-resume) | Resume from outdated capsule — warned |
| Review gate | [`examples/review-gate`](examples/review-gate) | Checkpoint requires approval — blocked |
| Handoff | [`examples/handoff`](examples/handoff) | Context transfer between agents |
| Generic agent collaboration | [`examples/generic-agent-collaboration`](examples/generic-agent-collaboration) | Non-code resources + Constraint Runtime |

For the interactive version, run `syncpoint demo`.

## Good First Commands

```bash
pnpm install && pnpm build
syncpoint demo
syncpoint demo --stage blocked
syncpoint demo resource          # non-code binary_asset demo
syncpoint status
syncpoint --help
```

For local dev without global install:

```bash
node packages/syncpoint-cli/dist/main.js demo
node packages/syncpoint-cli/dist/main.js status
node packages/syncpoint-cli/dist/main.js --help
```

## Beyond Code

SyncPoint is a **resource-first synchronization protocol**, not a multimodal semantic engine. The same `ResourceClaim → Operation → Constraint Evaluation` loop that protects source files also protects binary assets, design artifacts, documents, and any other addressable resource.

What SyncPoint does not do: parse images, analyze video, run embeddings, or invoke model-specific reasoning. Those are the domain of specialized tools. SyncPoint ensures their outputs go through a coordinated, constraint-checked protocol.

See [`docs/beyond-code.md`](docs/beyond-code.md) for details.

---

<div align="center">

**SyncPoint helps multiple editor AI agents stop, align, and continue safely.**

</div>
