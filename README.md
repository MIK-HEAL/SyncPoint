<div align="center">

# SyncPoint

**Stop agent drift before it becomes a merge conflict.**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange?logo=pnpm)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](packages/syncpoint-mcp)

</div>

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

By the time you notice, the damage is a merge conflict — or worse, silently wrong code in production.

## What SyncPoint Does

SyncPoint is a **local coordination protocol** for editor AI agents.

Before an agent starts, resumes, wakes, checkpoints, or applies a patch, SyncPoint checks whether the continuation path is safe. If it isn't, **it blocks**.

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
- Reviewers need to **approve AI-generated patches** before they're applied
- Long tasks **resume from stale context** and nobody validates the checkpoint
- You need to see **who is blocked, why, and what unblocks them**

## How It Works

SyncPoint enforces boundaries through five protocol primitives:

| Primitive | What it does |
|---|---|
| **FileClaim** | Agent declares "I will touch these files" — overlapping claims create blockers automatically |
| **SyncGate** | A hard stop — the agent cannot continue until the gate is resolved, not just acknowledged |
| **SyncTransaction** | A checkpoint that requires approval before another agent can resume from it |
| **PatchProposal** | A diff that is checked for ownership, format, and constraint violations before apply |
| **Wake** | A sync obligation — "this agent needs to review / approve / acknowledge before continuing" |

These are enforced at every execution boundary. An agent cannot silently skip a gate or ignore a file conflict.

### What happens under the hood

Each agent carries a **context capsule** — a scoped snapshot of its current task, working files, active constraints, and blockers. The capsule is what the agent sees. But what the agent sees is not what decides whether it can continue.

SyncPoint maintains **project memory** — typed, versioned, deduplicated knowledge entries (facts, conventions, risks, hard constraints, do-not-touch rules). These are compiled and scoped per task, so each agent gets only the constraints relevant to its work. Hard constraints and protocol rules are enforced at every execution boundary — they cannot be ignored even if the agent's prompt doesn't mention them.

When an agent tries to continue, SyncPoint checks:

- Does the agent's working files overlap a protected scope? → **blocked**
- Is there an unresolved file ownership conflict? → **blocked**
- Is there an open gate or pending transaction? → **blocked**
- Does a patch touch files outside the agent's claim? → **blocked**
- Is the agent's checkpoint stale or invalid? → **blocked**

If everything is clean, the agent continues. If not, the specific blocker is surfaced with the reason, the source, and what needs to happen to unblock.

Architecture details: [`docs/reality-runtime.md`](docs/reality-runtime.md) · [`docs/constraint-runtime.md`](docs/constraint-runtime.md) · [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## What SyncPoint Is Not

| SyncPoint is not | Why |
|---|---|
| Agent runner | It does not call model APIs or run autonomous loops |
| Workflow builder | It does not build arbitrary DAGs or visual flows |
| Job scheduler | Wake requests are sync obligations, not background jobs |
| File lock daemon | It enforces paths only when agents route through SyncPoint |
| Memory product | Memory supports synchronization, not generic recall |

**SyncPoint is the layer agents call before they continue.**

## See It In 10 Minutes

The fastest way to understand SyncPoint is to run the synchronization truncation demo.

### 1. Build the workspace

```bash
pnpm install
pnpm build
```

### 2. Create a blocked multi-agent state

```bash
node scripts/demo-sync-flow.mjs --stage blocked
```

The script creates an isolated demo project under `.tmp/` and prints IDs for:

- **Agent A** and **Agent B**
- overlapping file claims on `src/shared-config.ts`
- an automatically created file-conflict `SyncGate`
- a checkpoint-backed `SyncTransaction`
- wake requests and blocker state

You should see a blocked continuation message similar to:

```text
Agent blocked by sync gate(s): <gateId>. Acknowledge before starting work.
```

### 3. Inspect the state

From the demo project printed by the script, start the local server:

```bash
syncpoint server start --port 8765
```

If `syncpoint` is not on your PATH yet, use the built CLI directly:

```bash
node <SYNCPOINT_REPO>/packages/syncpoint-cli/dist/main.js server start --port 8765
```

Open the VS Code extension **Sync View** and verify:

| Sync View section | What you should see |
|---|---|
| **Sessions** | A `peer-contract` demo session |
| **Active Work** | Agent A active; Agent B blocked |
| **File Ownership** | Two active claims on `src/shared-config.ts` |
| **Blockers** | A file-conflict gate and a checkpoint gate |
| **Wake Queue** | Sync obligations created by session events |
| **Patches** | Empty before resolution |

### 4. Resolve the sync boundary

Back in the SyncPoint repository:

```bash
node scripts/demo-sync-flow.mjs --stage resolve --project <printed-demo-project>
```

The script resolves the gates, transfers ownership, submits a patch proposal, runs patch checks, approves it, and marks it applied.

Expected result:

```text
Patch checks: ALL PASSED
Active gates after resolve: none
```

Full walkthrough: [`docs/demo-sync-truncation.md`](docs/demo-sync-truncation.md)

## Protocol Primitives

SyncPoint is built around five protocol primitives.

| Primitive | Plain-English meaning | Why it matters |
|---|---|---|
| **FileClaim** | "I intend to touch these files." | Makes ownership explicit before work starts |
| **SyncGate** | "Stop here until this is resolved." | Blocks unsafe start, resume, and wake paths |
| **SyncTransaction** | "This checkpoint needs approval." | Turns progress into an approved continuation point |
| **PatchProposal** | "Check this diff before treating it as safe." | Validates patch format, ownership, and conflicts |
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
  -> agents claim files before changing them
  -> overlapping claims create blockers
  -> checkpoint creates a sync transaction when approval is needed
  -> patch proposal checks touched files against claims and constraints
  -> constraint runtime blocks if do_not_touch or hard_constraint is violated
  -> review records evidence and approval state
  -> wake queue tells the next agent what sync action is required
  -> Sync View shows the whole map
```

For the clearest first experience, use `peer-contract` mode because file boundaries and conflicts are easy to see.

## Quick Start For Local Development

### Install and build

```bash
pnpm install
pnpm build
pnpm typecheck
```

### Use the CLI

If the package is linked or installed, use:

```bash
syncpoint --help
```

For local repository development, use:

```bash
node packages/syncpoint-cli/dist/main.js --help
```

### Initialize SyncPoint state in a project

```bash
syncpoint init
syncpoint status
```

This creates local state under:

```text
.syncpoint/syncpoint.db
```

### Register agents

```bash
syncpoint agent add --name codex-architect --provider codex --role manager
syncpoint agent add --name claude-executor --provider claude-code --role backend
syncpoint agent add --name cursor-reviewer --provider cursor --role reviewer
```

### Create a synchronization session

```bash
syncpoint session create \
  --title "Shared config coordination" \
  --architect <architectAgentId> \
  --mode peer-contract
```

### Inspect and resolve blockers

```bash
syncpoint sync status --session <sessionId>

syncpoint sync ack --gate <gateId> --agent <agentA>
syncpoint sync ack --gate <gateId> --agent <agentB>

syncpoint sync resolve \
  --gate <gateId> \
  --summary "Ownership boundary agreed; safe to continue."
```

### Work with patch proposals

```bash
syncpoint patch list --session <sessionId>
syncpoint patch status --patch <patchId>
syncpoint patch approve --patch <patchId> --agent <reviewerAgentId>
syncpoint patch apply --patch <patchId>
```

### Query constraint decisions

```bash
syncpoint constraint check \
  --action resume \
  --task <taskId> \
  --agent <agentId> \
  --session <sessionId>
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
| **File Ownership** | Active file claims and hard conflicts |
| **Blockers** | Gates, transactions, reviews, and handoffs that stop continuation |
| **Patches** | Patch proposals and check results |
| **Wake Queue** | Pending sync obligations for agents |

This is the operator view for answering: **"Who is blocked, why, and what unblocks them?"**

## Repository Layout

```text
packages/
├── syncpoint-core       # protocol types, state machines, projection compiler, constraint evaluator
├── syncpoint-server     # application services, SQLite, tRPC, SSE
├── syncpoint-cli        # operator CLI for sessions, gates, transactions, patches, constraints
├── syncpoint-mcp        # MCP adapter for editor AI agents
├── syncpoint-sdk        # typed client for integrations
└── vscode-extension     # Sync View for claims, blockers, patches, wakes
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
| [`docs/demo-sync-truncation.md`](docs/demo-sync-truncation.md) | Running the 10-15 minute synchronization truncation demo |
| [`docs/core-synchronization.md`](docs/core-synchronization.md) | Understanding protocol primitives and invariants |
| [`docs/local-operations-guide.md`](docs/local-operations-guide.md) | Operating SyncPoint locally with CLI, MCP, server, and Sync View |

Architecture and runtime:

| Document | Best for |
|---|---|
| [`docs/reality-runtime.md`](docs/reality-runtime.md) | Layered reality architecture — Project Memory, Projection, Capsule, Constraint Runtime |
| [`docs/constraint-runtime.md`](docs/constraint-runtime.md) | Constraint evaluation rules, enforcement entry points, visibility layer |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layer boundary principles and code placement guide |

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
| Tests | Vitest (866 tests) |
| Editor integration | MCP + VS Code extension |

## Good First Commands

```bash
pnpm build
node scripts/demo-sync-flow.mjs --stage blocked
node scripts/demo-sync-flow.mjs --stage all
node packages/syncpoint-cli/dist/main.js --help
node packages/syncpoint-cli/dist/main.js sync --help
node packages/syncpoint-cli/dist/main.js patch --help
node packages/syncpoint-cli/dist/main.js constraint --help
```

---

<div align="center">

**SyncPoint helps multiple editor AI agents stop, align, and continue safely.**

</div>
