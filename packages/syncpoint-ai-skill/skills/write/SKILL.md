---
description: "Safe write with permit in SyncPoint — check viability, prepare a write permit, apply mutations with audit trail. Use when an agent needs to write to files under SyncPoint coordination."
---

# Safe Write with Permit

## Step 1: Dry-Run Check

```bash
syncpoint write check <file> --task <taskId> --agent <agentId>
```

## Step 2: Prepare Permit

```bash
syncpoint write prepare <file> --task <taskId> --agent <agentId> --intent modify
```

The permit captures file hashes for later verification.

## Step 3: Apply Mutation

```bash
syncpoint write apply <file> --permit <permitId> --content "new content"
```

## Error Recovery
- **File changed since permit**: Re-prepare permit
- **Resource not claimed**: Run `syncpoint claim <file> --agent <agentId> --task <taskId>` first
- **Constraint blocked**: Check constraints with `/syncpoint-ai-skill:guard`

## Verification
```bash
syncpoint status
```
