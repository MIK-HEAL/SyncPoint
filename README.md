<div align="center">

# SyncPoint

**Synchronization protocol layer for editor AI agents**

*让多个编辑器 AI 在关键同步点停下、对齐、再继续。*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-≥9-orange?logo=pnpm)](https://pnpm.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## One Sentence

SyncPoint is a collaboration protocol layer that makes multiple editor AIs stop at key synchronization points, align, and then continue.

It is built for Codex, Claude Code, Cursor, Cline, Copilot, human operators, and other agents working in the same codebase.

## What SyncPoint Is Not

SyncPoint is easy to misunderstand because it has sessions, wake requests, reviews, patches, and a VS Code view.

It is **not**:

| Not this | Why |
|---|---|
| Agent orchestration framework | SyncPoint does not run models or own autonomous loops |
| Workflow builder | No DAG designer, no generic task graph runtime |
| Multi-AI scheduler | Wake requests are sync obligations, not arbitrary job dispatch |
| Automation runner | The goal is not to make agents run faster forever |

SyncPoint is the layer agents call before they continue work.

## The Problem

Multiple AI coding agents usually fail at collaboration for a simple reason:

```text
They do not share a reliable synchronization boundary.
```

One agent may edit a file while another patches the same interface. A reviewer may approve stale context. A handoff may lose the real state. A model may keep working through a conflict because nobody forced it to stop.

The core failure is not that agents cannot do work. The core failure is that agents drift out of sync.

## The Mechanism: Synchronization Truncation

SyncPoint turns "needs coordination" into a hard protocol boundary.

```text
agent wants to continue
  -> SyncPoint checks shared local state
  -> unresolved blocker found
  -> continuation is truncated
  -> required agents acknowledge / approve / resolve
  -> only then can the right agent continue
```

The important rule:

```text
SYNC_ACKED still blocks.
Only READY_TO_CONTINUE or CANCELLED releases a SyncGate.
```

Acknowledgement proves that agents noticed the sync point. Resolution proves that the collaboration boundary is safe to cross.

## The Five Primitives

SyncPoint uses a small set of protocol primitives to force synchronization:

| Primitive | What it answers | How it prevents drift |
|---|---|---|
| **File Claim** | Who owns which files right now? | Agents declare file boundaries before work; overlaps become visible |
| **SyncGate** | When must agents stop? | Continuation is blocked until the gate is resolved |
| **Sync Transaction** | What checkpoint must be approved? | A checkpoint becomes an approval flow bound to a gate |
| **Patch Proposal** | Can this patch safely apply? | Patch checks verify format, claims, and conflicts before approval |
| **Wake with semantic intent** | Who should act next, and why? | Wake is limited to sync verbs such as claim, checkpoint, review, approve, handoff, resume |

The result is visible:

- **Who is doing what**
- **Which files are claimed**
- **Who is blocked**
- **Why they are blocked**
- **Which approval or patch action unblocks the flow**

## Minimal Flow

The smallest useful SyncPoint story is:

```text
create session
  -> two agents join in peer-contract mode
  -> Agent A claims src/shared-config.ts and starts work
  -> Agent B claims the same file
  -> SyncPoint detects a hard conflict and creates a SyncGate
  -> Agent B cannot continue through SyncPoint start / resume / wake paths
  -> Agent A checkpoints and opens a Sync Transaction
  -> required approver approves and resolves
  -> claim boundary is adjusted
  -> Agent B submits a Patch Proposal
  -> patch is checked, approved, and marked applied
  -> Sync View shows claims, blockers, patches, wakes, and recovery
```

That is the difference from normal orchestration: SyncPoint is not just telling agents what to do next. It is preventing them from crossing unsafe collaboration boundaries.

## Try The Synchronization Truncation Demo

Build the workspace:

```bash
pnpm install
pnpm build
```

Create the blocked state:

```bash
node scripts/demo-sync-flow.mjs --stage blocked
```

Start the local server from the demo project printed by the script:

```bash
syncpoint server start --port 8765
```

Open the VS Code extension **Sync View** and verify:

- **File Ownership** shows overlapping claims
- **Blockers** shows a file-conflict SyncGate and a checkpoint Sync Transaction
- **Wake Queue** shows sync obligations
- **Active Work** shows which agent is blocked

Then resolve and complete the patch-review path:

```bash
node scripts/demo-sync-flow.mjs --stage resolve --project <printed-demo-project>
```

See the full walkthrough:

| Path | Purpose |
|---|---|
| [docs/demo-sync-truncation.md](docs/demo-sync-truncation.md) | 10-15 minute demo that reproduces conflict, truncation, approval, patch, and recovery |
| [docs/local-operations-guide.md](docs/local-operations-guide.md) | Practical local operation guide for CLI, MCP, server, and Sync View |
| [docs/core-synchronization.md](docs/core-synchronization.md) | Protocol model and invariants |

## Architecture

```text
packages/
├── syncpoint-core       # protocol types, state machines, pure rules
├── syncpoint-server     # local application services, SQLite, tRPC, SSE
├── syncpoint-cli        # operator CLI for sync sessions, gates, tx, patches
├── syncpoint-mcp        # editor-agent MCP adapter
├── syncpoint-sdk        # typed client for integrations
└── vscode-extension     # Sync View: claims, blockers, patches, wake queue
```

The important boundary:

```text
syncpoint-core defines the protocol.
syncpoint-server enforces it.
CLI / MCP / SDK / VS Code call the same rules.
```

## Quick Start

### Build

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### Initialize a project

```bash
syncpoint init
syncpoint status
```

This creates local SyncPoint state under:

```text
.syncpoint/syncpoint.db
```

### Register agents

```bash
syncpoint agent add --name codex-architect --provider codex --role manager
syncpoint agent add --name claude-executor --provider claude-code --role backend
syncpoint agent add --name cursor-reviewer --provider cursor --role reviewer
```

### Create a peer-contract session

```bash
syncpoint session create \
  --title "Shared config coordination" \
  --architect <architectAgentId> \
  --mode peer-contract
```

`peer-contract` mode is the clearest way to see synchronization truncation because executors must claim files before starting work.

### Resolve a SyncGate

```bash
syncpoint sync status --session <sessionId>

syncpoint sync ack --gate <gateId> --agent <agentA>
syncpoint sync ack --gate <gateId> --agent <agentB>

syncpoint sync resolve \
  --gate <gateId> \
  --summary "Agent A releases src/shared-config.ts; Agent B owns follow-up patch."
```

Until the gate reaches `READY_TO_CONTINUE`, affected agents cannot continue through SyncPoint's application-layer start, resume, or wake paths.

## Editor Integration

SyncPoint exposes the same protocol to editor agents through MCP.

### Cursor `.cursor/mcp.json`

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
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
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

The VS Code extension provides a single **Sync View** with:

- **Sessions**
- **Active Work**
- **File Ownership**
- **Blockers**
- **Patches**
- **Wake Queue**

## Documentation Map

Use three main paths:

| Path | Question answered |
|---|---|
| [README.md](README.md) | Why SyncPoint exists and why it is not ordinary orchestration |
| [docs/core-synchronization.md](docs/core-synchronization.md) | How synchronization truncation works |
| [docs/local-operations-guide.md](docs/local-operations-guide.md) | How to operate SyncPoint locally |
| [docs/demo-sync-truncation.md](docs/demo-sync-truncation.md) | How to see the core value in 10-15 minutes |

Supporting references:

| Document | Purpose |
|---|---|
| [docs/session-playbook.md](docs/session-playbook.md) | Role-by-role sync responsibilities |
| [docs/review-workflow.md](docs/review-workflow.md) | Evidence-backed review as a gate |
| [docs/cli-agent-loop.md](docs/cli-agent-loop.md) | Start, resume, checkpoint, and handoff continuation paths |
| [docs/mvp-showcase.md](docs/mvp-showcase.md) | Short presentation script |

## Database Location

SyncPoint stores state locally:

| Priority | Path |
|---|---|
| 1 | `SYNCPOINT_DB_DIR` |
| 2 | `.syncpoint/syncpoint.db` under the project |
| 3 | `~/.syncpoint/syncpoint.db` fallback |

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| API | tRPC |
| Database | SQLite + Drizzle ORM |
| Validation | Zod |
| Events | EventEmitter + SSE |
| Tests | Vitest |
| Editor Integration | MCP + VS Code |

---

<div align="center">

**SyncPoint prevents AI agents from running apart by making them stop, confirm, and continue through explicit synchronization gates.**

</div>
