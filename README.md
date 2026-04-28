# SyncPoint

> AI Coordination Layer — consistency, checkpointing, handoff, and state machines for local multi-agent collaboration.

## Architecture

```
syncpoint-core     Protocol types, state machines, Zod schemas
syncpoint-server   tRPC + Drizzle ORM + SQLite + SSE + EventEmitter
syncpoint-cli      Commander CLI
syncpoint-sdk      Typed tRPC client + SSE listener
syncpoint-mcp      MCP stdio adapter for editor agents
vscode-extension   TreeView panel + commands (with vscode mock for testing)
```

## Quick Start (5 minutes)

```bash
# 1. Install
pnpm install

# 2. Build
pnpm build

# 3. Verify
pnpm typecheck
pnpm test

# 4. Initialize project-local database
syncpoint init

# 5. Register agents
syncpoint agent add --name codex --provider codex --role backend
syncpoint agent add --name claude --provider claude-code --role frontend

# 6. Create and assign a task
syncpoint task create "Build auth module"
syncpoint task assign <taskId> --agent <agentId>

# 7. Draft, review, approve a peer contract
syncpoint contract draft --task <taskId> --title "Auth contract"
syncpoint contract review <contractId>
syncpoint contract approve <contractId>

# 8. Create a checkpoint
syncpoint checkpoint create --task <taskId> --agent <agentId> --summary "Implemented login"

# 9. Create a context capsule
syncpoint capsule create --task <taskId> --agent <agentId> --checkpoint <cpId> --goal "Build auth"

# 10. Pin a project rule and build resume context
syncpoint memory set --key code-style --content "Use TypeScript strict mode"
syncpoint resume-context --task <taskId> --agent <agentId>
syncpoint resume-prompt --task <taskId> --agent <agentId>

# 11. Hand off to another agent
syncpoint handoff create --task <taskId> --from <agentId1> --to <agentId2> --context "Auth ready"
syncpoint handoff accept <handoffId>

# 12. Review with evidence
syncpoint session review --session <sessionId> --task <taskId> --reviewer <agentId>
syncpoint review checklist-add --review <reviewId> --title "Tests pass"
syncpoint review evidence-add --review <reviewId> --kind test --title "pnpm test" --content "All tests passed"
syncpoint review gate --review <reviewId>
syncpoint review approve --review <reviewId> --summary "Approved with evidence"

# 13. Playbook — next actions and evidence capture
syncpoint playbook next-action --session <sessionId> --agent <agentId>
syncpoint playbook active-session --agent <agentId>
syncpoint playbook capture-evidence --review <reviewId> --command "pnpm test" --output "..."

# 14. One-command MVP showcase
syncpoint demo mvp
```

## Database Location

SyncPoint resolves the database path in this order:

1. **`SYNCPOINT_DB_DIR`** env var (explicit override)
2. **Project-local** `.syncpoint/syncpoint.db` (walks up from cwd)
3. **Fallback** `~/.syncpoint/syncpoint.db`

Use `syncpoint init` to create `.syncpoint/` in the current directory.

## Server

```bash
# Start via CLI
syncpoint server start --port 8765

# Or directly
node packages/syncpoint-server/dist/main.js
```

- **tRPC API**: `http://127.0.0.1:8765/trpc/...`
- **SSE events**: `http://127.0.0.1:8765/events`
- **Status**: `http://127.0.0.1:8765/status`

## Key Concepts

- **Peer Work Contract**: Structured collaboration agreement between peer AI agents (DRAFT → REVIEWING → APPROVED/REJECTED). Drives task status automatically.
- **Context Capsule**: Compressed, structured task context at checkpoints to reduce drift and token load.
- **Checkpoint**: Task progress snapshot with summary, risks, blockers, and sync flag.
- **Handoff**: Structured task transfer between agents with context summary. Transfers ownership.
- **Pinned Memory**: High-priority rules scoped globally, per project, or per task.
- **Memory Switch Engine**: Builds a focused resume context from approved contract, latest capsule, latest checkpoint, and pinned memory.
- **Role Orchestration**: Sessions bind agents to architect, executor, reviewer, or owner roles.
- **Review Workflow**: Checklist, evidence, change requests, and approval gates for reviewer decisions.
- **Orchestration Playbook**: Next-action guidance, evidence capture helpers, and role-specific playbooks.
- **MVP Demo**: One-command local showcase that generates a completed session and `.syncpoint/mvp-demo.md`.

## API Routes (tRPC)

| Router | Procedures |
|--------|-----------|
| `agent` | `create`, `list`, `get`, `updateStatus` |
| `task` | `create`, `list`, `get`, `assign`, `updateStatus` |
| `checkpoint` | `create`, `list` |
| `diary` | `create`, `list` |
| `handoff` | `create`, `accept`, `reject` |
| `contract` | `create`, `get`, `getForTask`, `updateStatus` |
| `capsule` | `create`, `list`, `getLatest` |
| `event` | `list` |
| `pinnedMemory` | `create`, `get`, `list`, `update`, `delete` |
| `resumeContext` | `get`, `enforce` |

## Memory Switch Engine

The resume context is intentionally narrow. It is assembled from:

- Approved Peer Work Contract
- Latest Context Capsule for the current task and agent
- Latest Checkpoint for the current task and agent
- Relevant pinned memories

Quality checks include:

- Completeness
- Freshness
- Approval
- Conflict
- Scope
- NeedSync

CLI:

```bash
syncpoint memory set --key code-style --content "Use TypeScript strict mode" --scope project
syncpoint memory list
syncpoint resume-context --task <taskId> --agent <agentId>
syncpoint resume-prompt --task <taskId> --agent <agentId>
```

## State Machines

**AgentStatus**: `IDLE` → `RUNNING` → `CHECKPOINT` → `RUNNING` | `DONE`

**TaskStatus**:
```
OPEN → ASSIGNED → NEEDS_CONTRACT → CONTRACT_REVIEW → READY_TO_WORK → IN_PROGRESS
                                  ↘ NEEDS_CONTRACT (rejected)
IN_PROGRESS → NEEDS_SYNC | BLOCKED | REVIEWING → DONE
Any → CANCELLED
```

**ContractStatus**: `DRAFT` → `REVIEWING` → `APPROVED` | `REJECTED` → `DRAFT` (re-draft)

Contract status changes automatically drive task status:
- Contract created → task `NEEDS_CONTRACT`
- Contract reviewing → task `CONTRACT_REVIEW`
- Contract approved → task `READY_TO_WORK`
- Contract rejected → task `NEEDS_CONTRACT`

**Review Workflow**:
```
ChecklistItem: OPEN → PASSED | FAILED | WAIVED
ChangeRequest: OPEN → ADDRESSED | REJECTED | CANCELLED
ApprovalGate:  PASSED only when required checklist is done, evidence exists, and no changes are open
```

See [docs/review-workflow.md](docs/review-workflow.md) for the full CLI and MCP flow.

See [docs/session-playbook.md](docs/session-playbook.md) for the end-to-end session playbook.

See [docs/mvp-showcase.md](docs/mvp-showcase.md) for the one-command MVP demo.

See [docs/local-operations-guide.md](docs/local-operations-guide.md) for the local multi-model operation guide.

## Testing

```bash
# All tests
pnpm test

# Individual packages
pnpm --filter syncpoint-core test      # 28 state machine tests
pnpm --filter syncpoint-server test    # 51 unit + e2e tests
pnpm --filter syncpoint-vscode test    # 4 extension integration tests
```

## Tech Stack

TypeScript, tRPC, Drizzle ORM, better-sqlite3, Node EventEmitter, SSE, Zod, Vitest, pnpm workspace
