---
description: "Hand off work between AI agents in SyncPoint — checkpoint progress, transfer task ownership, resume from snapshot. Use when an agent finishes work and needs to pass context to another agent."
---

# Agent Handoff

## Step 1: Create Checkpoint

```bash
syncpoint loop checkpoint --task <taskId> --agent <sourceAgentId>
syncpoint checkpoint list --task <taskId>
```

## Step 2: Initiate Handoff

```bash
syncpoint loop handoff --task <taskId> --agent <sourceAgentId> --target <targetAgentId>
syncpoint handoff create --task <taskId> --from <sourceAgentId> --to <targetAgentId>
```

## Step 3: Accept or Reject

```bash
syncpoint handoff accept <handoffId>
syncpoint handoff reject <handoffId> --reason "Not my domain"
```

## Step 4: Resume

```bash
syncpoint loop resume --task <taskId> --agent <targetAgentId>
syncpoint loop status
```

## Verification
```bash
syncpoint loop status
syncpoint status --task <taskId>
```
