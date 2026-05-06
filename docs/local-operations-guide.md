# Local Operations Guide

This guide explains how to operate SyncPoint locally as a synchronization protocol layer.

Use it after reading:

- **Why**: [`../README.md`](../README.md)
- **How it works**: [`core-synchronization.md`](core-synchronization.md)
- **Runnable demo**: [`demo-sync-truncation.md`](demo-sync-truncation.md)

## Mental Model

SyncPoint is the local state and enforcement layer between editor AI agents.

```text
agent action
  -> check claims / gates / transactions / reviews / operations
  -> stop if blocked
  -> synchronize with required agents
  -> continue only after the blocker is resolved
```

The operator experience has four surfaces:

| Surface | Use it for |
|---|---|
| CLI | Create sessions, inspect blockers, resolve gates, approve transactions, manage resource claims and operations |
| MCP | Let editor agents claim resources, checkpoint, hand off, resume, review, submit operations, and wake through tools/prompts |
| Server | Share one local SyncPoint state with SDK, extension, and tRPC clients |
| VS Code Sync View | See sessions, active work, resource ownership, blockers, operations, and wake queue |

## MCP Identity And Connection Setup

Before using multiple editor agents, keep this boundary clear:

```text
starting the MCP server process does not by itself choose an agent
the operator should create and bind each agent window first
```

The recommended path is to let the CLI prepare that binding:

1. **Project setup** — `syncpoint setup`
2. **Single window setup** — `syncpoint connect`
3. **Health check** — `syncpoint doctor`

Under the hood, the generated MCP config uses:

- **Direct identity**: `SYNCPOINT_AGENT_ID`
- **Runtime identity**: `SYNCPOINT_RUNTIME_ID`
- **Project scope**: `SYNCPOINT_PROJECT_ROOT`

Legacy mode still exists: tools can accept explicit `agentId` parameters when a connection is not bound.

Recommended real-world setup:

```text
one editor window
  -> one MCP connection
  -> one bound SyncPoint agent
```

Use [`runtime-identity.md`](runtime-identity.md) for identity resolution details,
`syncpoint_whoami`, and manual fallback examples.

## Quick Start

The fastest way to get multiple agents running:

```bash
# One-command setup: init + register agents + generate MCP configs
syncpoint setup --agents 3 --editor cursor

# Or set up one agent at a time
syncpoint connect --name architect --provider cursor --role manager
syncpoint connect --name executor-a --provider cursor --role backend
syncpoint connect --name reviewer --provider cursor --role reviewer

# Verify everything is healthy
syncpoint doctor
```

Each command prints a ready-to-paste MCP config for the target editor.
Paste it, restart the MCP connection, and call `syncpoint_whoami` to verify.

The facade commands accept agent **name or ID**:

```bash
syncpoint resume --agent architect --task <taskId>
syncpoint claim src/auth.ts --agent executor-a --task <taskId>
syncpoint checkpoint --agent executor-a --task <taskId> --summary "Implemented first pass"
```

Lower-level orchestration commands may still require IDs. Use `syncpoint doctor`
or `syncpoint agent list` when you need the exact ID.

## Install And Build

From the SyncPoint repository:

```bash
pnpm install
pnpm build
pnpm typecheck
pnpm test
```

Useful package scripts:

```bash
pnpm --filter syncpoint-cli build
pnpm --filter syncpoint-server test
pnpm --filter syncpoint-mcp build
```

## Project State

Initialize SyncPoint state in the project you want agents to coordinate.
If you already ran `syncpoint setup` or `syncpoint connect`, this is already done.

```bash
syncpoint init
syncpoint status
```

SyncPoint resolves database location in this order:

| Priority | Location |
|---|---|
| 1 | `SYNCPOINT_DB_DIR` |
| 2 | nearest project-local `.syncpoint/syncpoint.db` |
| 3 | fallback `~/.syncpoint/syncpoint.db` |

For demos, prefer a dedicated project folder so the demo state does not mix with real work.

## Start The Local Server

Run from the project folder that contains `.syncpoint/`:

```bash
syncpoint server start --port 8765
```

The VS Code extension and SDK can read the same server. The extension's **Sync View** is the fastest way to understand what is blocked.

## Connect Agent Windows

Recommended path:

```bash
syncpoint setup --agents 3 --editor cursor
```

This initializes `.syncpoint/`, creates default agents, binds runtimes, and prints
one MCP config per editor window.

Add or reconnect one agent window:

```bash
syncpoint connect --name architect --provider cursor --role manager --editor cursor
syncpoint connect --name executor-a --provider cursor --role backend --editor cursor
syncpoint connect --name reviewer --provider cursor --role reviewer --editor cursor
```

Then verify:

```bash
syncpoint doctor
```

Manual fallback is still available when you need low-level control:

```bash
syncpoint agent add --name cursor-architect --provider cursor --role manager
syncpoint agent add --name cursor-executor-a --provider cursor --role backend
syncpoint agent add --name cursor-reviewer --provider cursor --role reviewer
syncpoint agent list
```

Prefer `connect`/`setup` for MCP-connected windows because they also create and
bind runtimes and generate the correct MCP environment variables.

## Create A Sync Session

For synchronization truncation demos, use `peer-contract` mode:

```bash
syncpoint session create \
  --title "Shared config sync" \
  --description "Two editor agents coordinate on one shared file" \
  --architect <architectAgentId> \
  --mode peer-contract
```

Use `syncpoint doctor` or `syncpoint agent list` to find IDs for low-level
session commands.

Assign roles:

```bash
syncpoint session assign-role --session <sessionId> --agent <agentA> --role executor
syncpoint session assign-role --session <sessionId> --agent <agentB> --role executor
```

Create tasks and assignments:

```bash
syncpoint task create --title "Agent A updates shared config" --description "Prepare base config change"
syncpoint task create --title "Agent B proposes follow-up patch" --description "Patch same config after sync"

syncpoint session plan --session <sessionId> --task <taskA> --assignee <agentA>
syncpoint session plan --session <sessionId> --task <taskB> --assignee <agentB>

syncpoint session accept --assignment <assignmentA>
syncpoint session accept --assignment <assignmentB>
```

## Resource Claims

Resource claims answer:

```text
Who owns which resources right now?
```

Editor agents usually claim resources through MCP because the claim is part of their tool-using workflow:

```text
syncpoint_resource_claim {
  "taskId": "<taskA>",
  "sessionId": "<sessionId>",
  "type": "file",
  "locators": "src/shared-config.ts",
  "mode": "exclusive"
}
```

For a bound MCP connection, `agentId` can be omitted. SyncPoint resolves it from
`SYNCPOINT_AGENT_ID` or `SYNCPOINT_RUNTIME_ID`.

The CLI facade also accepts agent names:

```bash
syncpoint claim src/shared-config.ts --agent executor-a --task <taskA> --session <sessionId>
syncpoint claim assets/hero-banner.png --type binary_asset --agent designer --task <taskA>
```

If another agent claims the same resource exclusively, SyncPoint detects a hard conflict and creates a `SyncGate` automatically.

For runnable CLI-oriented demonstrations, use:

```bash
syncpoint demo conflict --stage blocked
syncpoint demo resource
```

## Start Or Resume Work

Start an assignment only after the required claims exist:

```bash
syncpoint session start --assignment <assignmentId>
```

In `peer-contract` mode, starting work without claims is rejected. Starting work while blocked by an active gate is also rejected.

Facade commands provide continuation paths for editor agents and accept names:

```bash
syncpoint resume --task <taskId> --agent executor-a
syncpoint checkpoint --task <taskId> --agent executor-a --summary "Base config prepared"
syncpoint status --session <sessionId>
```

These commands should be treated as synchronization-aware boundaries, not just prompts.
Low-level `syncpoint loop ...` commands remain available and still expect agent IDs.

## Inspect Blockers

List gates in a session:

```bash
syncpoint sync status --session <sessionId>
```

Check whether one agent is blocked:

```bash
syncpoint sync status --session <sessionId> --agent <agentId>
```

Inspect one gate:

```bash
syncpoint sync status --gate <gateId>
```

A gate is blocking until its status is `READY_TO_CONTINUE` or `CANCELLED`.

## Resolve A SyncGate

Required agents acknowledge first:

```bash
syncpoint sync ack --gate <gateId> --agent <agentA> --summary "I saw the overlap and will stop editing."
syncpoint sync ack --gate <gateId> --agent <agentB> --summary "I will wait for ownership transfer."
```

Then an operator or responsible agent resolves:

```bash
syncpoint sync resolve \
  --gate <gateId> \
  --summary "Agent A releases ownership; Agent B owns follow-up patch."
```

Remember:

```text
SYNC_ACKED still blocks.
READY_TO_CONTINUE releases.
```

## Use Sync Transactions For Checkpoints

Create a checkpoint from an agent loop:

```bash
syncpoint loop checkpoint \
  --task <taskId> \
  --agent <agentId> \
  --summary "Base config prepared" \
  --progress "70%" \
  --next "Wait for Agent B approval" \
  --need-sync
```

Create a transaction bound to the checkpoint:

```bash
syncpoint sync tx create \
  --checkpoint <checkpointId> \
  --session <sessionId> \
  --task <taskId> \
  --agent <requestingAgentId> \
  --approvers <approverAgentId>
```

Approve and resolve:

```bash
syncpoint sync tx approve --tx <txId> --agent <approverAgentId> --summary "Checkpoint is safe to continue from."
syncpoint sync tx resolve --tx <txId> --summary "Checkpoint accepted."
```

The transaction has its own bound `SyncGate`; resolving the transaction releases that gate.

## Use Operations For Code Patches

Create the operation record:

```bash
syncpoint patch propose \
  --session <sessionId> \
  --task <taskId> \
  --agent <agentId> \
  --title "Update shared config sync mode"
```

Submit and inspect checks:

```bash
syncpoint patch submit --id <operationId>
syncpoint patch status --id <operationId>
```

Approve and mark applied:

```bash
syncpoint patch approve --id <operationId> --agent <approverAgentId> --summary "Claim checks passed."
syncpoint patch apply --id <operationId>
```

The current CLI command group is still named `patch` for compatibility, but it delegates to the generic operation lifecycle (`opCreate`, `opSubmit`, `opCheck`, `opApprove`, `opApply`). The CLI command shown above creates lifecycle state only: it does not read a patch file, infer touched resources, or apply a diff to your working tree. Ownership/conflict validators run when an operation has `targetResources`, as in application-level integrations and demos that create operations directly.

## Wake Queue

Wake requests answer:

```text
Who should act next, what sync action should they perform, and which event caused it?
```

Use MCP prompt `syncpoint_wake_briefing` for editor agents. The prompt tells the agent to acknowledge, start, execute the hinted sync action, and complete the wake request.

A wake request is not permission to run autonomously. It is a sync obligation.

## VS Code Sync View Checklist

When debugging a collaboration flow, inspect these sections:

| Section | What to look for |
|---|---|
| Sync Status | Overall blocker count |
| Sessions | Session mode and role bindings |
| Active Work | Assignment status and blocked agents |
| Resource Ownership | Active claims and hard overlaps |
| Blockers | Gates, sync transactions, reviews, handoffs, submitted/conflicting operations |
| Operations | Operation lifecycle and check results |
| Wake Queue | Queued sync obligations |

If Sync View and CLI disagree, confirm that both are using the same `.syncpoint/` database and server project root.

## MCP Setup

The easiest way is to use `syncpoint connect` which generates the config for you:

```bash
syncpoint connect --name my-agent --provider cursor --role backend --editor cursor
```

This registers the agent, binds a runtime, and prints the config to paste.
Generated configs include both `SYNCPOINT_AGENT_ID` and `SYNCPOINT_RUNTIME_ID` when a runtime is bound.

Cursor-style config shape:

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<agent-id>",
        "SYNCPOINT_RUNTIME_ID": "<runtime-id>",
        "SYNCPOINT_PROJECT_ROOT": "<YOUR_PROJECT_ROOT>"
      }
    }
  }
}
```

VS Code-style config shape:

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["<SYNCPOINT_ROOT>/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<agent-id>",
        "SYNCPOINT_RUNTIME_ID": "<runtime-id>",
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

High-value MCP tools and prompts:

| Name | Purpose |
|---|---|
| `syncpoint_resource_claim` | Declare resource ownership; may create conflict gates |
| `syncpoint_resource_release` | Release ownership after handoff or resolution |
| `syncpoint_loop_resume` | Resume with current context and blockers |
| `syncpoint_loop_checkpoint` | Prepare a structured checkpoint |
| `syncpoint_operation_create` | Create an operation such as a code patch or asset edit |
| `syncpoint_operation_submit` | Submit an operation for validation |
| `syncpoint_wake_briefing` | Explain a pending sync obligation |
| `syncpoint_session_playbook` | Show role-specific next actions |

## Troubleshooting

### The agent is unexpectedly blocked

Run:

```bash
syncpoint sync status --agent <agentId> --session <sessionId>
syncpoint patch list --session <sessionId>
```

Then inspect Sync View **Blockers**.

### The operation cannot be approved

Run:

```bash
syncpoint patch check --id <operationId>
```

Common causes:

- **Missing claim**: The operation touches resources the agent does not own.
- **Hard conflict**: Another active exclusive claim overlaps.
- **Invalid payload**: For integrations that supply payload text to validators, the operation payload may fail domain-specific checks.

### The extension shows no data

Verify:

- **Server**: `syncpoint server start --port 8765` is running.
- **Workspace**: VS Code opened the project containing `.syncpoint/`.
- **Build**: Packages were built with `pnpm build`.
- **Database**: CLI and server point to the same `SYNCPOINT_DB_DIR` or project folder.

## Operator Rule Of Thumb

Before allowing an agent to continue, answer:

1. **Claim**: Does this agent own the resources it will touch?
2. **Gate**: Is any gate still active?
3. **Transaction**: Is the latest checkpoint approved and resolved?
4. **Operation**: Has the operation passed the checks that apply to its recorded resources and metadata?
5. **Wake**: Is the next action a sync obligation, not arbitrary autonomous work?

If any answer is unclear, stop and synchronize before continuing.
