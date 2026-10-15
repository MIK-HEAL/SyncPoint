---
description: "Manage file guards in SyncPoint — create guard sessions, validate tokens, audit for unauthorized writes. Use when setting up filesystem-level protection for agent file access."
---

# File Guard

## Step 1: Check Guard Status

```bash
syncpoint guard status
```

## Step 2: Create Guard Session

```bash
syncpoint guard session --agent <agentId> --task <taskId>
```

Save the returned token — it is required for file operations.

## Step 3: Validate Token

```bash
syncpoint guard validate-token <token>
```

## Step 4: Revoke Session

```bash
syncpoint guard revoke <sessionId>
```

## Step 5: Audit for Unauthorized Writes

```bash
syncpoint guard reconcile --task <taskId>
```

## Emergency Access
```bash
syncpoint guard unlock --all
```

## Verification
```bash
syncpoint guard status
syncpoint guard validate-token <token>
```
