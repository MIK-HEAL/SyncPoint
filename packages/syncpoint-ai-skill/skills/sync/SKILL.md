---
description: "Manage SyncPoint sync gates — request synchronization, acknowledge, vote, and resolve coordination gates between agents. Use when an agent is blocked by a gate or needs to coordinate with other agents."
---

# SyncGate Lifecycle

Status flow: NEEDS_SYNC → SYNC_REQUESTED → SYNC_ACKED → READY_TO_CONTINUE

## Step 1: Check Gate Status

```bash
syncpoint sync status
syncpoint sync status --gate <gateId>
```

## Step 2: Acknowledge (Required Agents)

```bash
syncpoint sync ack --gate <gateId> --agent <agentId>
syncpoint sync ack --gate <gateId> --agent <agentId> --summary "Reviewed"
```

## Step 3: Vote

```bash
syncpoint sync vote --gate <gateId> --vote approve --agent <agentId>
syncpoint sync vote --gate <gateId> --vote reject --agent <agentId> --summary "<why>"
syncpoint sync vote --gate <gateId> --vote escalate --agent <agentId>
```

## Step 4: Resolve or Cancel

```bash
syncpoint sync resolve --gate <gateId>
syncpoint sync cancel --gate <gateId>
```

## Verification
```bash
syncpoint sync status --gate <gateId>
syncpoint status
```
