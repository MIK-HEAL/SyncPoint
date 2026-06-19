<div align="center">

# SyncPoint

**Stop agent drift before it becomes a merge conflict.**

A local-first coordination protocol for AI agents that share resources.

[![npm](https://img.shields.io/npm/v/syncpoint-ai?color=blue)](https://www.npmjs.com/package/syncpoint-ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-green?logo=node.js&logoColor=white)](https://nodejs.org/)
[![SQLite](https://img.shields.io/badge/SQLite-local--first-003B57?logo=sqlite&logoColor=white)](https://sqlite.org/)
[![MCP](https://img.shields.io/badge/MCP-editor--agent%20ready-purple)](https://modelcontextprotocol.io)

</div>

---

## The Problem

AI coding agents fail because they **continue from different realities**.

- Agent A owns `shared-config.ts`. Agent B edits it anyway. Neither knows.
- A checkpoint goes stale. Another agent resumes from it and builds on wrong assumptions.
- A constraint says "don't touch the auth module." The agent touches it. Nothing stops it.

SyncPoint checks whether an agent's continuation path is safe **before** the agent proceeds. If it isn't, SyncPoint **blocks** — not with a warning in a prompt, but with a hard protocol gate the agent cannot skip.

---

## Quick Start

```bash
# Install globally
npm install -g syncpoint-ai

# One-command setup: init + register agents + generate editor configs
syncpoint setup --agents 2

# Start the server
syncpoint server start

# Run the collision detection demo
syncpoint demo
```

That's it. Two simulated agents claim the same file, one gets blocked, and SyncPoint shows why.

---

## Declare Agents as Files

Agents are declared by dropping a manifest file in `.syncpoint/agents/`. No CLI flags, no copy-paste IDs.

```yaml
# .syncpoint/agents/architect.yml
version: 1
name: architect
provider: claude-code
role: manager
```

```yaml
# .syncpoint/agents/worker.yml
version: 1
name: worker
provider: cursor
role: backend
```

```bash
syncpoint agent list       # See all declared agents
syncpoint agent diagnose   # Check for issues
```

SyncPoint auto-discovers agents on startup. Creating a file is all it takes.

---

## Core Workflows

### Collision Detection

When two agents claim the same resource, SyncPoint blocks one of them — with full context.

```bash
# Agent A claims a file exclusively
syncpoint claim src/config.ts --agent architect --mode exclusive

# Agent B tries the same file
syncpoint claim src/config.ts --agent worker --mode exclusive
# → BLOCKED. Output shows who holds the lock and why.

# See the full picture
syncpoint status
# → Lists all claims, gates, blockers, and blocked agents
```

### Stale Resume Detection

```bash
# Save mid-task progress
syncpoint checkpoint --agent architect --task <taskId> \
  --summary "Auth module halfway done"

# Later, other agents change things. Architect resumes:
syncpoint resume --agent architect --task <taskId>
# → WARNING: "Your assumptions may be outdated."
# → Lists changed resources and active blockers
```

### Hard Constraints

Block access to protected resources — enforced at the protocol level, not in a prompt.

```bash
syncpoint knowledge add \
  --content "Auth module under audit — do not modify" \
  --kind hard_constraint \
  --applies-to '{"files":["src/auth/**"]}' \
  --severity blocking

syncpoint claim src/auth/middleware.ts --agent rogue
# → BLOCKED by constraint: resource_forbidden
```

### Structured Handoff

```bash
syncpoint handoff create \
  --from architect --to worker --task <taskId> \
  --summary "Login page done. JWT auth, token expiry 1h."

# Worker resumes — receives full structured state:
#   ✓ Resource ownership map
#   ✓ Active constraints
#   ✓ Unresolved gates and blockers
#   ✓ Checkpoint context
```

### Editor Agent Setup

```bash
# Cursor
syncpoint setup --editor cursor --agents 2

# VS Code / Cline
syncpoint setup --editor vscode --agents 2

# GitHub Copilot
syncpoint setup --editor copilot --agents 2
```

This initializes `.syncpoint/`, creates agent manifests, and prints ready-to-paste MCP config blocks.

Alternatively, register a single agent and get its MCP config:

```bash
syncpoint connect --name architect --provider claude-code --role manager --editor cursor
```

---

## Programmatic Usage

### SDK (tRPC client)

```ts
import { createSyncPointClient } from "syncpoint-ai/sdk";

const sp = createSyncPointClient("http://127.0.0.1:8765");

const task = await sp.task.create.mutate({
  title: "Implement login",
  description: "OAuth 2.0 with PKCE",
});

await sp.agent.claim.mutate({
  agentId: "architect",
  taskId: task.id,
  resources: [{ type: "file", locator: "src/auth/**", scope: "file" }],
  mode: "exclusive",
});

const status = await sp.syncStatus.status.query();
// → { agents: [...], claims: [...], gates: [...], blockers: [...] }
```

### Write-level guard

```ts
import { createSyncPointWriteClient } from "syncpoint-ai/sdk";
const write = createSyncPointWriteClient();

const check = await write.check({ actorId: "architect", resources: [...] });
if (!check.permitted) {
  console.log("Blocked:", check.blockers);
}
```

### Start server programmatically

```ts
import { startServer, defaultContext } from "syncpoint-ai/server";

const server = startServer(8765);
// SyncPoint running on http://127.0.0.1:8765
```

### Kernel types (zero-dependency primitives)

```ts
import { SyncGateStatus, evaluateGateLiveness, isGateBlocking } from "syncpoint-ai/kernel";
```

---

## MCP Configuration (Manual)

If you prefer to set up MCP manually:

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "syncpoint": {
      "command": "npx",
      "args": ["syncpoint-mcp"],
      "env": { "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

```json
// .vscode/mcp.json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "npx",
      "args": ["syncpoint-mcp"],
      "env": { "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}" }
    }
  }
}
```

Available MCP tools: `syncpoint_sync_request`, `syncpoint_sync_ack`, `syncpoint_sync_status`, `syncpoint_sync_resolve`, `syncpoint_claim_resource`, `syncpoint_checkpoint`, `syncpoint_resume`, `syncpoint_handoff`, `syncpoint_write_check`, `syncpoint_write_apply`, and more.

---

## Claude Code Skill

The `syncpoint-ai-skill` package gives Claude Code direct knowledge of SyncPoint workflows. Install once, then Claude handles coordination automatically.

```bash
# Install the skill plugin
claude plugins install syncpoint-ai-skill
```

Or add to `.claude/plugins/plugin.json`:

```json
{
  "plugins": ["syncpoint-ai-skill"]
}
```

**What the skill teaches Claude to do:**

| Skill | What it guides Claude to do |
|---|---|
| **setup** | Initialize SyncPoint, register agents, start the server, generate MCP configs |
| **claim** | Claim resource ownership before editing, check for conflicts, release when done |
| **sync** | Manage sync gates — request ack, acknowledge, vote, resolve coordination barriers |
| **handoff** | Checkpoint progress, transfer task ownership, resume from snapshot with full context |
| **review** | Create review requests, add checklists, submit evidence, approve or request changes |
| **guard** | Create guard sessions, validate tokens, audit for unauthorized file writes |
| **agent-loop** | Boot tasks, claim resources, work, checkpoint, handoff — the full orchestration cycle |
| **write** | Check viability, prepare permits, apply mutations with audit trail |

Once installed, tell Claude "set up SyncPoint for this project" or "claim the auth module" — the skill gives it step-by-step instructions backed by the protocol.

---

## How It Works

Five protocol primitives enforce the "pause → sync → resume" loop:

| Primitive | Purpose |
|---|---|
| **ResourceClaim** | Agent declares "I'm working on these resources" |
| **SyncGate** | Hard barrier — agent cannot proceed until gate is resolved |
| **Operation** | Tracked change, validated for ownership + constraints |
| **Checkpoint** | Save task state; detect staleness on resume |
| **Wake** | Active notification — "you have a pending sync obligation" |

At each resume boundary, SyncPoint checks ownership, constraints, gates, and staleness. Clean path → continue. Dirty path → blocked with explanation.

---

## Enforcement Levels

SyncPoint supports progressive enforcement — from audit-only to OS-level:

| Level | Mode | What's blocked |
|---|---|---|
| L0 | `L0_audit` | Nothing — audit log only |
| L1 | `L1_controlled` | Direct writes through SyncPoint API |
| L2 | `L2_editor_guard` | Editor saves (VS Code extension) |
| L3 | `L3_proxy` | Workspace file proxy |
| L4 | Planned | OS kernel/minifilter |

Configure in `.syncpoint/config.yml`:
```yaml
guard:
  mode: L1_controlled
```

See [`docs/system-file-lock-design.md`](docs/system-file-lock-design.md) for details.

---

## Package Structure

```
syncpoint-ai                    # One package, everything included
├── . (main)                    # All kernel, context, governance, adapters types
├── /server                     # startServer, DatabaseContext, tRPC router
├── /application                # Service layer (sync gates, claims, operations…)
├── /repositories               # Data access layer
├── /sdk                        # Typed tRPC client + write/guard clients
├── /kernel                     # Zero-dep types, validators, state machines
├── /plugins/code               # File resource plugin
├── /plugins/generic-agent      # Generic resource plugin
│
├── CLI:    syncpoint <command>
├── MCP:    syncpoint-mcp
└── Runner: syncpoint-loop-runner
```

---

## What SyncPoint Is Not

| Not a | Why |
|---|---|
| Agent runner | Doesn't call model APIs |
| Workflow builder | Doesn't build DAGs or visual flows |
| File lock daemon | Protocol-level enforcement, not OS-level |
| Memory product | Project memory serves synchronization, not general recall |

**SyncPoint is the layer agents call before they continue.**

---

<div align="center">

**Stop drift. Start SyncPoint.**

</div>
