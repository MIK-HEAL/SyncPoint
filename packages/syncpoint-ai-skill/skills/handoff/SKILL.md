---
description: "Hand off work between AI agents in SyncPoint — checkpoint progress, transfer task ownership, resume from snapshot. Use when an agent finishes work and needs to pass context to another agent."
---

# Agent Handoff

## Step 1: Create Checkpoint

```bash
syncpoint loop checkpoint --task <taskId> --agent <sourceAgentId> --summary "Progress summary"
syncpoint loop status --agent <sourceAgentId> --task <taskId>
```

## Step 2: Initiate Handoff

```bash
syncpoint loop handoff --task <taskId> --from <sourceAgentId> --to <targetAgentId> --context "Handoff summary"
syncpoint handoff create --task <taskId> --from <sourceAgentId> --to <targetAgentId> --context "Handoff summary"
```

## Step 3: Accept or Reject

```bash
syncpoint handoff accept <handoffId>
syncpoint handoff reject <handoffId>
```

## Step 4: Resume

```bash
syncpoint loop resume --task <taskId> --agent <targetAgentId>
syncpoint loop status --agent <targetAgentId> --task <taskId>
```

## Verification
```bash
syncpoint loop status --agent <targetAgentId> --task <taskId>
syncpoint sync status --task <taskId>
```
