---
description: "Review checkpoints in SyncPoint — create review requests, add checklists, submit evidence, approve or request changes. Use when reviewing another agent's work before it can proceed."
---

# Checkpoint Review

## Step 1: Create Review

Create a review request from a session:

```bash
syncpoint session review --session <sessionId> --task <taskId> --reviewer <agentId>
```

## Step 2: Add Checklist Items

```bash
syncpoint review checklist-add --review <reviewId> --title "All tests pass"
syncpoint review checklist-add --review <reviewId> --title "No security regressions"
syncpoint review checklist-list --review <reviewId>
```

## Step 3: Submit Evidence

```bash
syncpoint review evidence-add --review <reviewId> --kind note --title "Evidence" --content "evidence text"
syncpoint review evidence-list --review <reviewId>
```

## Step 4: Evaluate

```bash
syncpoint review checklist-pass --item <checklistItemId> --notes "why"
syncpoint review checklist-fail --item <checklistItemId> --notes "why"
```

## Step 5: Decision

```bash
syncpoint review approve --review <reviewId> --summary "Approved"
syncpoint review block --review <reviewId> --summary "Blocking issues"
syncpoint review changes-request --review <reviewId> --summary "What to fix"
```

## Verification
```bash
syncpoint review gate <reviewId>
syncpoint review packet <reviewId>
```
