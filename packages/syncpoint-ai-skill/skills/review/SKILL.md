---
description: "Review checkpoints in SyncPoint — create review requests, add checklists, submit evidence, approve or request changes. Use when reviewing another agent's work before it can proceed."
---

# Checkpoint Review

## Step 1: Create Review

```bash
syncpoint review create --checkpoint <checkpointId> --reviewer <agentId>
```

## Step 2: Add Checklist Items

```bash
syncpoint review checklist-add --review <reviewId> --item "All tests pass"
syncpoint review checklist-add --review <reviewId> --item "No security regressions"
syncpoint review checklist-list --review <reviewId>
```

## Step 3: Submit Evidence

```bash
syncpoint review evidence-add --review <reviewId> --item <checklistItemId> --content "evidence text"
syncpoint review evidence-list --review <reviewId>
```

## Step 4: Evaluate

```bash
syncpoint review checklist-pass <checklistItemId>
syncpoint review checklist-fail <checklistItemId> --reason "why"
```

## Step 5: Decision

```bash
syncpoint review approve <reviewId>
syncpoint review block <reviewId> --reason "blocking issues"
syncpoint review changes-request <reviewId> --reason "what to fix"
```

## Verification
```bash
syncpoint review gate <reviewId>
syncpoint review packet <reviewId>
```
