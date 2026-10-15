---
description: "Claim and release resource ownership in SyncPoint. Use when an agent needs to declare ownership of files or resources before editing, check for conflicts, or release claims after work is done."
---

# Resource Claim and Release

## Step 1: Check Current State

```bash
syncpoint status
syncpoint sync status --task <taskId>
syncpoint dev status
```

## Step 2: Claim Resources

```bash
syncpoint claim <file> --task <taskId> --agent <agentId>
syncpoint claim "<file1>,<file2>" --mode exclusive --agent <agentId> --task <taskId>
syncpoint claim <file> --mode shared --agent <agentId> --task <taskId>
```

## Step 3: Handle Conflicts

Check what's blocking:
```bash
syncpoint sync status --task <taskId> --agent <agentId>
```

Force-release a stale claim if needed:
```bash
syncpoint release --claim <claimId>
```

## Step 4: Release Resources

```bash
syncpoint release --all --task <taskId> --agent <agentId>
```
