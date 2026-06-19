---
description: "Manage SyncPoint sync gates — request synchronization, acknowledge, vote, and resolve coordination gates between agents. Use when an agent is blocked by a gate or needs to coordinate with other agents."
---

# SyncGate Lifecycle

Status flow: NEEDS_SYNC → SYNC_REQUESTED → SYNC_ACKED → READY_TO_CONTINUE

## Step 1: Check Gate Status

```bash
syncpoint sync list
syncpoint sync list --active
syncpoint sync status <gateId>
```

## Step 2: Acknowledge (Required Agents)

```bash
syncpoint sync ack <gateId> --agent <agentId>
syncpoint sync ack <gateId> --agent <agentId> --summary "Reviewed"
```

## Step 3: Vote

```bash
syncpoint sync vote <gateId> --vote approve --agent <agentId>
syncpoint sync vote <gateId> --vote reject --agent <agentId> --reason "<why>"
syncpoint sync vote <gateId> --vote escalate
```

## Step 4: Resolve or Cancel

```bash
syncpoint sync resolve <gateId>
syncpoint sync cancel <gateId>
```

## Verification
```bash
syncpoint sync status <gateId>
syncpoint status
```
