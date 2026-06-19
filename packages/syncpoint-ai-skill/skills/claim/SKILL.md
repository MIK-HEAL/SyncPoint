---
description: "Claim and release resource ownership in SyncPoint. Use when an agent needs to declare ownership of files or resources before editing, check for conflicts, or release claims after work is done."
---

# Resource Claim and Release

## Step 1: Check Current State

```bash
syncpoint status
syncpoint status --task <taskId>
syncpoint dev status
```

## Step 2: Claim Resources

```bash
syncpoint claim <file> --task <taskId> --agent <agentId>
syncpoint claim <file1> <file2> --mode exclusive
syncpoint claim <file> --mode shared
```

## Step 3: Handle Conflicts

Check what's blocking:
```bash
syncpoint status --blockers
```

Force-release a stale claim if needed:
```bash
syncpoint release <file> --force
```

## Step 4: Release Resources

```bash
syncpoint release <file> --agent <agentId>
syncpoint release --task <taskId>
```
