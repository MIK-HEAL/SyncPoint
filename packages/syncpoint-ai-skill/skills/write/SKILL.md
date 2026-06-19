---
description: "Safe write with permit in SyncPoint — check viability, prepare a write permit, apply mutations with audit trail. Use when an agent needs to write to files under SyncPoint coordination."
---

# Safe Write with Permit

## Step 1: Dry-Run Check

```bash
syncpoint write check --task <taskId> --agent <agentId> --resources <file>
```

## Step 2: Prepare Permit

```bash
syncpoint write prepare --task <taskId> --agent <agentId> --resources <file> --intent modify
```

The permit captures file hashes for later verification.

## Step 3: Apply Mutation

```bash
syncpoint write apply --permit <permitId> --resource <file> --content "new content"
```

## Error Recovery
- **File changed since permit**: Re-prepare permit
- **Resource not claimed**: Run `syncpoint claim <file>` first
- **Constraint blocked**: Check constraints with `/syncpoint-ai-skill:guard`

## Verification
```bash
syncpoint status
```
