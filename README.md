<div align="center">

# SyncPoint

**AI Agent Synchronization Protocol**

*让多个 AI 编程助手在同一个项目里停在正确的同步点，确认边界、交接上下文，再继续工作。*

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-≥20-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-≥9-orange?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

</div>

---

## The Core Idea

Multiple AI coding agents are powerful, but they do not naturally share state. Codex may edit a file while Claude plans a conflicting change; Cursor may review stale work; a handoff may lose the real context.

Most systems try to solve this by adding more automation.

SyncPoint takes the opposite path:

```text
Make agents stop at the right moments.
Make them synchronize.
Only then let the next agent continue.
```

The core innovation is **protocol-level synchronization truncation**.

It does not run models. It does not schedule infinite autonomous loops. It creates enforceable sync boundaries around AI work:

```text
work about to continue
  -> check shared sync state
  -> detect unresolved gate / conflict / handoff / review
  -> block continuation
  -> require acknowledgement or resolution
  -> allow the right agent to continue
```

## Why This Matters

AI agents drift when they lack shared constraints:

| Drift Problem | What Happens Without SyncPoint | SyncPoint Response |
|--------------|--------------------------------|-------------------|
| File collision | Two agents edit the same file or interface | FileClaim + conflict awareness |
| Context loss | A new agent resumes from stale chat history | Checkpoint + Context Capsule |
| Unclear handoff | Nobody knows who continues next | Handoff / Resume protocol |
| Premature work | An agent keeps working through unresolved conflict | SyncGate hard truncation |
| Runaway automation | Wake becomes a generic auto-runner | Wake limited to sync verbs |

SyncPoint is not trying to make agents more autonomous. It makes them **less likely to drift**.

## The Innovation: Sync Truncation

SyncPoint turns "needs sync" from a vague status into a hard protocol gate.

```text
NEEDS_SYNC
  -> SYNC_REQUESTED
  -> SYNC_ACKED
  -> READY_TO_CONTINUE
```

Important rule:

```text
SYNC_ACKED still blocks.
Only READY_TO_CONTINUE or CANCELLED releases the gate.
```

This means acknowledgement is not enough. The sync point must be resolved before affected agents can continue.

### Where The Gate Is Enforced

SyncGate is not just a record in the database. It blocks the continuation paths agents actually use:

| Entry Point | Effect |
|------------|--------|
| `loopResume()` | Prevents an agent from resuming blocked work |
| `orchStartAssignment()` | Prevents starting an assignment through session orchestration |
| `wakeNext()` | Suppresses dispatch while the agent is blocked |
| `wakeStart()` | Prevents a queued wake from running through a blocked gate |

So the mechanism is **protocol-level hard truncation**:

```text
If agents use SyncPoint's CLI / MCP / tRPC application services,
they cannot continue through an unresolved SyncGate.
```

It is not an OS-level file lock and it does not forcibly stop a model process that bypasses SyncPoint. The design goal is to make SyncPoint the shared coordination layer that editors and agents call before continuing.

## The Four Protocol Questions

Every core feature exists to answer one of four questions:

```text
1. Who is changing what?
2. When must they synchronize?
3. What must be confirmed at sync?
4. Who continues after confirmation?
```

| Primitive | Role In The Truncation Mechanism |
|-----------|----------------------------------|
| **Sync State** | Shared local source of truth: agents, tasks, sessions, roles, status |
| **FileClaim** | Declares file ownership before work begins |
| **Conflict Awareness** | Detects overlapping claims and marks sync boundaries |
| **SyncGate** | Blocks continuation until the sync point is resolved |
| **Checkpoint** | Captures progress, risks, decisions, and next steps |
| **Context Capsule** | Compresses resume context so the next agent starts with the right state |
| **Handoff / Resume** | Makes continuation explicit when work moves between agents |
| **Wake** | Notifies the right agent at sync points only |
| **Relationship Mode** | Applies different sync rules to manager/delegate, peer, and handoff flows |

## What Wake Is Not

Wake is deliberately constrained. It is not a general runner.

Wake may notify agents to do synchronization work:

```text
plan
accept
checkpoint
sync
review
handoff
resume
approve
```

Wake should not mean:

```text
keep working forever
auto-run arbitrary tasks
turn SyncPoint into a LangGraph clone
```

Every wake request must have a synchronization reason: confirm responsibility, resolve conflict, transfer context, review evidence, or approve continuation.

## Relationship Modes

Not all AI collaboration has the same synchronization rules. SyncPoint makes the relationship explicit:

| Mode | Pattern | Sync Behavior |
|------|---------|---------------|
| `manager-delegate` | Architect plans, executor works, reviewer approves | plan -> accept -> checkpoint -> review -> approve |
| `peer-contract` | Peers work in parallel with boundaries | contract -> claim files -> checkpoint sync -> merge/review |
| `handoff-resume` | One agent passes work to another | capsule -> handoff -> accept -> resume |

Relationship Mode changes playbook suggestions, wake filtering, and context policy. For example, `peer-contract` requires file claiming before start-work is suggested.

## Architecture

```text
packages/
├── syncpoint-core       # protocol types, state machines, pure rules
├── syncpoint-server     # local application services, SQLite, tRPC, SSE
├── syncpoint-cli        # human/operator command line
├── syncpoint-mcp        # editor-agent adapter through MCP
├── syncpoint-sdk        # typed client for integrations
└── vscode-extension     # editor sync status view
```

The important boundary:

```text
syncpoint-core defines the protocol.
syncpoint-server enforces it.
CLI / MCP / SDK / editor UI are entry points into the same rules.
```

## Quick Start

### 1. Build

```bash
git clone <repo-url> && cd SyncPoint
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

### 2. Initialize A Project

```bash
cd <your-project>
syncpoint init
```

This creates local SyncPoint state under `.syncpoint/`.

### 3. Register Agents

```bash
syncpoint agent add --name codex-arch --provider codex --role manager
syncpoint agent add --name claude-exec --provider claude-code --role backend
syncpoint agent add --name cursor-rev --provider cursor --role reviewer
```

### 4. Create A Session With A Relationship Mode

```bash
syncpoint session create \
  --title "Build Auth Module" \
  --architect <architectAgentId> \
  --mode peer-contract
```

Available modes:

```text
manager-delegate
peer-contract
handoff-resume
```

### 5. Create And Resolve A SyncGate

```bash
syncpoint sync request \
  --task <taskId> \
  --agent <requestingAgentId> \
  --required <agentA,agentB> \
  --reason file_conflict \
  --description "Both agents need src/auth.ts"

syncpoint sync ack --gate <gateId> --agent <agentA>
syncpoint sync ack --gate <gateId> --agent <agentB>

syncpoint sync resolve \
  --gate <gateId> \
  --summary "Agent A owns src/auth.ts; Agent B owns src/api/auth.ts"
```

Until the gate is resolved, affected agents cannot continue through SyncPoint's resume / start / wake paths.

## Connecting Editors Through MCP

SyncPoint exposes the same protocol to editor agents through Model Context Protocol.

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

## Current Status

Implemented core synchronization capabilities:

```text
Synchronization narrative
FileClaim / conflict awareness
SyncGate hard truncation
Relationship Mode convergence
Wake limited to sync verbs
CLI + MCP sync tools
Local SQLite state
SSE event stream
Editor sync status foundation
```

Next core work:

```text
FileClaim conflict -> automatic SyncGate
Wake semantic source binding
Editor Sync View refinement
SDK / CLI hardening
```

## Documentation

| Document | Purpose |
|----------|---------|
| [Core Synchronization](docs/core-synchronization.md) | Protocol design and sync primitives |
| [Local Operations Guide](docs/local-operations-guide.md) | Local multi-agent operating guide |
| [Session Playbook](docs/session-playbook.md) | End-to-end session flow |
| [Review Workflow](docs/review-workflow.md) | Evidence-backed review and approval |
| [MVP Showcase](docs/mvp-showcase.md) | Demo flow |

## Database Location

SyncPoint stores state locally:

| Priority | Path |
|----------|------|
| 1 | `SYNCPOINT_DB_DIR` |
| 2 | `.syncpoint/syncpoint.db` under the project |
| 3 | `~/.syncpoint/syncpoint.db` fallback |

## Tech Stack

| Layer | Technology |
|-------|------------|
| Language | TypeScript |
| API | tRPC |
| Database | SQLite + Drizzle ORM |
| Validation | Zod |
| Events | EventEmitter + SSE |
| Tests | Vitest |
| Editor Integration | MCP |

---

<div align="center">

**SyncPoint** keeps AI agents synchronized by making them stop, confirm, and continue through explicit protocol gates.

</div>
