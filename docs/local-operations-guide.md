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
  -> check claims / gates / transactions / reviews / patches
  -> stop if blocked
  -> synchronize with required agents
  -> continue only after the blocker is resolved
```

The operator experience has four surfaces:

| Surface | Use it for |
|---|---|
| CLI | Create sessions, inspect blockers, resolve gates, approve transactions, manage patches |
| MCP | Let editor agents claim files, checkpoint, hand off, resume, review, and wake through tools/prompts |
| Server | Share one local SyncPoint state with SDK, extension, and tRPC clients |
| VS Code Sync View | See sessions, active work, file ownership, blockers, patches, and wake queue |

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

Initialize SyncPoint state in the project you want agents to coordinate:

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

## Register Agents

Register the agents that will participate in sync sessions:

```bash
syncpoint agent add --name codex-architect --provider codex --role manager
syncpoint agent add --name claude-executor-a --provider claude-code --role executor
syncpoint agent add --name cursor-executor-b --provider cursor --role executor
syncpoint agent list
```

Use the printed IDs in later commands.

## Create A Sync Session

For synchronization truncation demos, use `peer-contract` mode:

```bash
syncpoint session create \
  --title "Shared config sync" \
  --description "Two editor agents coordinate on one shared file" \
  --architect <architectAgentId> \
  --mode peer-contract
```

Assign roles:

```bash
syncpoint session assign-role --session <sessionId> --agent <agentA> --role executor
syncpoint session assign-role --session <sessionId> --agent <agentB> --role executor
```

Create tasks and assignments:

```bash
syncpoint task create --title "Agent A updates shared config" --description "Prepare base config change"
syncpoint task create --title "Agent B proposes follow-up patch" --description "Patch same config after sync"

syncpoint session plan --session <sessionId> --task <taskA> --agent <agentA>
syncpoint session plan --session <sessionId> --task <taskB> --agent <agentB>

syncpoint session accept --assignment <assignmentA>
syncpoint session accept --assignment <assignmentB>
```

## File Claims

File claims answer:

```text
Who owns which files right now?
```

Editor agents usually claim files through MCP because the claim is part of their tool-using workflow:

```text
syncpoint_file_claim {
  "agentId": "<agentA>",
  "taskId": "<taskA>",
  "sessionId": "<sessionId>",
  "paths": "src/shared-config.ts",
  "mode": "exclusive"
}
```

If another agent claims the same file exclusively, SyncPoint detects a hard conflict and creates a `SyncGate` automatically.

For a runnable CLI-oriented demonstration of file claims, use the script in [`demo-sync-truncation.md`](demo-sync-truncation.md):

```bash
node scripts/demo-sync-flow.mjs --stage blocked
```

## Start Or Resume Work

Start an assignment only after the required claims exist:

```bash
syncpoint session start --assignment <assignmentId>
```

In `peer-contract` mode, starting work without claims is rejected. Starting work while blocked by an active gate is also rejected.

Agent-loop commands provide continuation paths for editor agents:

```bash
syncpoint loop boot --task <taskId> --agent <agentId>
syncpoint loop resume --task <taskId> --agent <agentId>
syncpoint loop status --task <taskId> --agent <agentId>
```

These commands should be treated as synchronization-aware boundaries, not just prompts.

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

## Use Patch Proposals

Create a unified diff file, for example `proposal.patch`:

```diff
diff --git a/src/shared-config.ts b/src/shared-config.ts
--- a/src/shared-config.ts
+++ b/src/shared-config.ts
@@
-export const syncMode = "manual";
+export const syncMode = "protocol-gated";
```

Create the proposal:

```bash
syncpoint patch propose \
  --session <sessionId> \
  --task <taskId> \
  --agent <agentId> \
  --title "Update shared config sync mode" \
  --summary "Small follow-up patch after claim handoff" \
  --file proposal.patch
```

Submit and inspect checks:

```bash
syncpoint patch submit --patch <patchId>
syncpoint patch status --patch <patchId>
```

Approve and mark applied:

```bash
syncpoint patch approve --patch <patchId> --agent <approverAgentId> --summary "Claim checks passed."
syncpoint patch apply --patch <patchId>
```

`patch apply` marks the approved proposal as applied in SyncPoint state. It does not replace your normal code review or Git workflow.

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
| File Ownership | Active claims and hard overlaps |
| Blockers | Gates, sync transactions, reviews, handoffs, submitted/conflicting patches |
| Patches | Patch lifecycle and check results |
| Wake Queue | Queued sync obligations |

If Sync View and CLI disagree, confirm that both are using the same `.syncpoint/` database and server project root.

## MCP Setup

Cursor example:

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

VS Code example:

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

High-value MCP tools and prompts:

| Name | Purpose |
|---|---|
| `syncpoint_file_claim` | Declare file ownership; may create conflict gates |
| `syncpoint_file_release` | Release ownership after handoff or resolution |
| `syncpoint_resume` | Resume with current context and blockers |
| `syncpoint_checkpoint` | Prepare a structured checkpoint |
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

### The patch cannot be approved

Run:

```bash
syncpoint patch check --patch <patchId>
```

Common causes:

- **Missing claim**: The patch touches files the agent does not own.
- **Hard conflict**: Another active exclusive claim overlaps.
- **Invalid diff**: The patch text is not a recognizable unified diff.

### The extension shows no data

Verify:

- **Server**: `syncpoint server start --port 8765` is running.
- **Workspace**: VS Code opened the project containing `.syncpoint/`.
- **Build**: Packages were built with `pnpm build`.
- **Database**: CLI and server point to the same `SYNCPOINT_DB_DIR` or project folder.

## Operator Rule Of Thumb

Before allowing an agent to continue, answer:

1. **Claim**: Does this agent own the files it will touch?
2. **Gate**: Is any gate still active?
3. **Transaction**: Is the latest checkpoint approved and resolved?
4. **Patch**: Has the patch passed ownership/conflict checks?
5. **Wake**: Is the next action a sync obligation, not arbitrary autonomous work?

If any answer is unclear, stop and synchronize before continuing.
