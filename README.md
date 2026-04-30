<div align="center">

# SyncPoint

### Local synchronization protocol for editor AI agents

**Stop agent drift before it becomes a merge conflict.**  
SyncPoint gives Codex, Claude Code, Cursor, Cline, Copilot, and human operators a shared local protocol for file ownership, blockers, checkpoints, patch review, and safe continuation.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange?logo=pnpm)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](packages/syncpoint-mcp)

</div>

---

## The 60-Second Version

Multiple AI coding agents can work fast, but they usually do **not** share a reliable boundary for:

- **File ownership**: who is allowed to change which files?
- **Continuation safety**: is this agent allowed to start, resume, or wake?
- **Checkpoint approval**: has another agent accepted the state I am continuing from?
- **Patch safety**: does this diff touch files the agent actually owns?
- **Review evidence**: what proves this work is safe to approve?

SyncPoint is the local protocol layer that answers those questions before agents continue.

```text
agent wants to continue
  -> SyncPoint checks local sync state
  -> unresolved claim / gate / transaction / patch / review found
  -> continuation is blocked
  -> required agent reviews, acknowledges, approves, or resolves
  -> only then can work continue safely
```

That behavior is called **synchronization truncation**: unsafe continuation paths are cut off until the sync boundary is resolved.

## What SyncPoint Is Not

SyncPoint has sessions, wake requests, reviews, patches, a CLI, MCP tools, and a VS Code view. That can make it look like a generic orchestration system.

It is not.

| SyncPoint is not | Boundary |
|---|---|
| An agent runner | It does not call model APIs or run autonomous loops |
| A workflow builder | It does not build arbitrary DAGs or visual flows |
| A job scheduler | Wake requests are sync obligations, not background jobs |
| A file lock daemon | It only enforces paths that agents route through SyncPoint |
| A memory product | Project memory exists to support synchronization context |

**SyncPoint is the layer agents call before they continue.**

## Why It Exists

AI agents fail at collaboration less because they cannot write code, and more because they drift out of sync:

- Agent A edits a shared file while Agent B patches the same interface.
- A reviewer approves a stale checkpoint.
- A handoff loses the real working state.
- A model keeps working after a conflict because nothing forced it to stop.
- A patch is applied even though another agent owns the touched file.

SyncPoint makes those states visible and actionable.

```text
who owns what
who is blocked
why they are blocked
what must be approved
who is allowed to continue next
```

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

## How SyncPoint Works

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
  -> patch proposal checks touched files against claims
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

## Editor Agent Integration

SyncPoint exposes the same protocol through MCP, so editor agents can inspect blockers, claim files, checkpoint work, and receive sync-aware prompts.

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
| **Active Work** | Assignments and work status |
| **File Ownership** | Active file claims and hard conflicts |
| **Blockers** | Gates, transactions, reviews, and handoffs that stop continuation |
| **Patches** | Patch proposals and check results |
| **Wake Queue** | Pending sync obligations for agents |

This is the operator view for answering: **"Who is blocked, why, and what unblocks them?"**

## Repository Layout

```text
packages/
├── syncpoint-core       # protocol types, state machines, pure checks
├── syncpoint-server     # application services, SQLite, tRPC, SSE
├── syncpoint-cli        # operator CLI for sessions, gates, transactions, patches
├── syncpoint-mcp        # MCP adapter for editor AI agents
├── syncpoint-sdk        # typed client for integrations
└── vscode-extension     # Sync View for claims, blockers, patches, wakes
```

The architectural rule:

```text
syncpoint-core defines the protocol.
syncpoint-server enforces the protocol.
CLI, MCP, SDK, and VS Code call the same application rules.
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

Then continue with:

| Document | Best for |
|---|---|
| [`docs/session-playbook.md`](docs/session-playbook.md) | Role-by-role sync responsibilities |
| [`docs/review-workflow.md`](docs/review-workflow.md) | Evidence-backed review as a synchronization gate |
| [`docs/cli-agent-loop.md`](docs/cli-agent-loop.md) | Start, resume, checkpoint, and handoff paths |
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

## Good First Commands

```bash
pnpm build
node scripts/demo-sync-flow.mjs --stage blocked
node scripts/demo-sync-flow.mjs --stage all
node packages/syncpoint-cli/dist/main.js --help
node packages/syncpoint-cli/dist/main.js sync --help
node packages/syncpoint-cli/dist/main.js patch --help
```

---

<div align="center">

**SyncPoint helps multiple editor AI agents stop, align, and continue safely.**

</div>
