<div align="center">

# SyncPoint

**Stop agent drift before it becomes a merge conflict.**

A local coordination protocol for AI agents that share resources.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A59-orange?logo=pnpm)](https://pnpm.io/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](packages/syncpoint-mcp)

</div>

**English** · [中文](README_zh-CN.md)

---

## The Problem

AI coding agents fail not because they write bad code — but because they **continue from different realities**.

- Agent A owns `shared-config.ts`. Agent B edits it anyway. Neither knows.
- A checkpoint goes stale. Another agent resumes from it and builds on wrong assumptions.
- A handoff loses the blockers, risks, and review state the previous agent built up.
- A hard constraint says "don't touch the auth module." The agent touches it. Nothing stops it.

By the time you notice, the damage is a merge conflict — or worse, silently wrong code in production.

## What SyncPoint Does

SyncPoint checks whether an agent's continuation path is safe **before** the agent proceeds. If it isn't, SyncPoint **blocks** — not with a warning in a prompt, but with a hard protocol gate the agent cannot skip.

---

## Four Experiences

### 1. Collision Detection

Two agents claim the same file. SyncPoint creates a SyncGate — a hard stop that neither agent can ignore.

```bash
# Start the server
pnpm build && pnpm --filter syncpoint-server dev

# Terminal A — agent-a claims a file exclusively
syncpoint claim src/shared-config.ts --agent agent-a --mode exclusive

# Terminal B — agent-b tries to claim the same file
syncpoint claim src/shared-config.ts --agent agent-b --mode exclusive
# → BLOCKED. agent-b sees who holds the lock and why.

# See the full state
syncpoint status
# → Shows: agent-b is blocked because agent-a has an exclusive claim
```

The blocked agent doesn't just get an error message. SyncPoint creates a **SyncGate** — a synchronization barrier that both agents can see. The gate stays open until the conflict is explicitly resolved. Neither agent can silently proceed.

### 2. Stale Resume Detection

Agent-a checkpoints mid-task. Meanwhile, agent-b changes related dependencies. When agent-a resumes, SyncPoint detects the stale context.

```bash
# agent-a saves progress
syncpoint checkpoint --agent agent-a --summary "Auth module halfway done"

# ... time passes, other agents make changes ...

# agent-a tries to resume
syncpoint resume --agent agent-a

# SyncPoint checks:
#   - Is the checkpoint still fresh?
#   - Did other agents touch related resources?
#   - Are there new constraints or blockers?
#
# If stale → warnings and blockers are injected into the resume output.
# The agent sees: "Your assumptions may be outdated."
```

Without SyncPoint, the agent resumes from a stale snapshot and silently produces code based on assumptions that no longer hold. With SyncPoint, the staleness is caught at the resume boundary.

### 3. Structured Handoff

Agent-a finishes frontend work and hands off to agent-b for backend. SyncPoint transfers not just a text summary, but a complete structured state.

```bash
# agent-a hands off to agent-b
syncpoint loop handoff \
  --task <taskId> \
  --from agent-a \
  --to agent-b \
  --context "Login page complete. API uses JWT, token expiry 1h"

# agent-b resumes — receives:
#   ✓ Context snapshot (working resources, completed work, blockers)
#   ✓ Constraint state (active rules, do-not-touch scopes)
#   ✓ Resource ownership (what agent-a claimed, what's released)
#   ✓ Unresolved gates (any pending sync obligations)
```

A handoff is not "send a message about what I did." It is a **structured state transfer** — task context, resource ownership, active constraints, and unresolved blockers, all packaged together. The receiving agent gets a complete reality projection, not a text summary that might miss critical details.

### 4. Hard Constraints

Set a constraint that no agent may touch a protected scope. SyncPoint enforces it at the execution boundary — not in the agent's prompt.

```bash
# Add a hard constraint via project memory
syncpoint project-memory add \
  --content "Auth module under audit — do not modify" \
  --kind hard_constraint \
  --applies-to '{"files":["src/auth/**"]}' \
  --severity blocking \
  --validator-type resource_forbidden

# Any agent that tries to claim or modify files under src/auth/ gets blocked
syncpoint claim src/auth/middleware.ts --agent rogue-agent
# → BLOCKED by Constraint Evaluation

# Verify constraints
syncpoint constraint check --action resume --task <taskId> --agent <agentId>
```

The key difference: constraints live in SyncPoint's execution layer, not in the agent's prompt. An agent prompt can be ignored. A SyncPoint constraint **cannot**. This is the difference between "please don't touch this" and "you physically cannot touch this."

---

## Quick Start

```bash
# Install dependencies and build
pnpm install
pnpm build

# Initialize SyncPoint in your project
syncpoint init

# Run the demo — shows collision detection in action
syncpoint demo

# Stop at the blocked state to inspect
syncpoint demo --stage blocked
syncpoint status
```

Without global install:

```bash
node packages/syncpoint-cli/dist/main.js demo
node packages/syncpoint-cli/dist/main.js status
```

## Declaring Agents

Creating a manifest file in `.syncpoint/agents/` registers the agent automatically:

```yaml
# .syncpoint/agents/my-agent.yml
version: 1
name: my-agent
provider: auto_detect
profile: general
role: executor
```

```bash
syncpoint agent list       # See all declared agents
syncpoint agent diagnose   # Check for issues
```

## Editor Integration

SyncPoint exposes the same protocol through MCP for editor agents.

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

## How It Works

SyncPoint enforces boundaries through five protocol primitives:

| Primitive | What it does |
|---|---|
| **ResourceClaim** | Agent declares "I will touch these resources" — overlapping claims create blockers |
| **SyncGate** | A hard stop — cannot continue until the gate is resolved |
| **CheckpointReview** | A checkpoint that requires approval before another agent can resume from it |
| **Operation** | A tracked change checked for ownership, conflicts, and constraints before apply |
| **Wake** | A sync obligation — notifies an agent to review, approve, or acknowledge |

The core loop: **pause → sync → resume**.

When an agent tries to continue, SyncPoint checks:

- Do working resources overlap a protected scope? → blocked
- Is there an unresolved ownership conflict? → blocked
- Is there an open gate or pending review? → blocked
- Is the checkpoint stale? → blocked

If everything is clean, the agent continues. If not, the specific blocker is surfaced with the reason and what needs to happen to unblock.

## What SyncPoint Is Not

| It is not | Why |
|---|---|
| Agent runner | Does not call model APIs or run autonomous loops |
| Workflow builder | Does not build DAGs or visual flows |
| File lock daemon | Protocol-level enforcement, not OS-level (see [enforcement design](docs/system-file-lock-design.md)) |
| Memory product | Project memory supports synchronization, not generic recall |

**SyncPoint is the layer agents call before they continue.**

## Repository Layout

```text
packages/
├── syncpoint-kernel         # Pure types, validators, state machines, errors
├── syncpoint-context        # Memory, reality projection, context policy
├── syncpoint-governance     # Constraint evaluation, checkpoint review, wake engine
├── syncpoint-adapters       # Agent manifests, negotiation, orchestration, runtime
├── syncpoint-core           # Facade — re-exports kernel, context, governance, adapters
├── syncpoint-server         # Application services, SQLite, tRPC, SSE
├── syncpoint-cli            # Operator CLI
├── syncpoint-mcp            # MCP adapter for editor AI agents
├── syncpoint-sdk            # Typed client for integrations
├── syncpoint-plugin-generic-agent  # Generic resource plugin
└── vscode-extension         # Sync View panel
```

Dependency order: `kernel → context → governance → adapters → core → server → cli, mcp, sdk`

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript |
| Runtime | Node.js |
| Package manager | pnpm workspaces |
| Database | SQLite + Drizzle ORM |
| API | tRPC |
| Validation | Zod |
| Tests | Vitest |
| Editor integration | MCP + VS Code extension |

## Documentation

| Document | Best for |
|---|---|
| [`docs/core-synchronization.md`](docs/core-synchronization.md) | Protocol primitives and invariants |
| [`docs/reality-runtime.md`](docs/reality-runtime.md) | Layered reality architecture |
| [`docs/constraint-runtime.md`](docs/constraint-runtime.md) | Constraint evaluation rules and enforcement |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Layer boundaries and code placement |
| [`docs/beyond-code.md`](docs/beyond-code.md) | SyncPoint for non-code resources |
| [`docs/local-operations-guide.md`](docs/local-operations-guide.md) | Operating SyncPoint with CLI, MCP, server |
| [`docs/migration-guide.md`](docs/migration-guide.md) | Migrating to manifest-based agent registration |

## Examples

| Scenario | Directory | What it shows |
|---|---|---|
| File conflict | [`examples/conflict`](examples/conflict) | Two agents claim the same file — blocked |
| Stale resume | [`examples/stale-resume`](examples/stale-resume) | Resume from outdated checkpoint — warned |
| Handoff | [`examples/handoff`](examples/handoff) | Structured context transfer between agents |
| Review gate | [`examples/review-gate`](examples/review-gate) | Checkpoint requires approval — blocked |

For the interactive version, run `syncpoint demo`.

---

<div align="center">

**SyncPoint helps multiple AI agents stop, align, and continue safely.**

</div>
