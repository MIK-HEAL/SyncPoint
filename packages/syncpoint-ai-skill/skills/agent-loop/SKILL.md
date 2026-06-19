---
description: "Run the SyncPoint orchestration loop — boot a task, create checkpoints, hand off work between agents. Use when coordinating multiple AI agents on the same task, or when resuming from a previous checkpoint."
---

# Agent Orchestration Loop

The core SyncPoint cycle: boot → claim resources → work → checkpoint → handoff or resume.

## Step 1: Boot the Loop

```bash
syncpoint loop boot --task <taskId> --agent <agentId>
syncpoint loop status
```

## Step 2: Claim Resources

Declare what files/resources you will touch before editing:

```bash
syncpoint claim <file> --agent <agentId> --task <taskId>
syncpoint status
```

If a SyncGate is created due to conflict, use `/syncpoint-ai-skill:sync` to resolve it.

## Step 3: Work and Checkpoint

Do your work, then save progress:

```bash
syncpoint loop checkpoint --task <taskId> --agent <agentId>
syncpoint checkpoint list --task <taskId>
```

## Step 4: Handoff or Resume

Transfer to another agent:
```bash
syncpoint loop handoff --task <taskId> --agent <agentId> --target <otherAgentId>
```

Or resume from latest checkpoint:
```bash
syncpoint loop resume --task <taskId> --agent <agentId>
```

## Step 5: Release Resources

```bash
syncpoint release <file> --agent <agentId>
syncpoint release --task <taskId> --agent <agentId>
```

## Verification
```bash
syncpoint loop status
syncpoint status
```
