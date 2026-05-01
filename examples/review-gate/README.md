# Review Gate Example

A checkpoint requires reviewer approval before another agent can continue.

## Run

```bash
syncpoint init
syncpoint agent add --name coder --provider claude-code --role backend
syncpoint agent add --name reviewer --provider cursor --role reviewer

# Create session
syncpoint session create --title "Auth review" --architect <coderId> --mode peer-contract

# Coder checkpoints — creates a sync transaction
syncpoint checkpoint --agent <coderId> --task <taskId> --summary "Auth complete, needs review"

# Create sync transaction requiring reviewer approval
syncpoint sync tx create --session <sessionId> --task <taskId> \
  --checkpoint <checkpointId> --agent <coderId> --approvers <reviewerId>

# Status shows the blocker
syncpoint status

# Reviewer approves
syncpoint sync tx approve --tx <txId> --agent <reviewerId>
syncpoint sync tx resolve --tx <txId> --summary "Approved"
```

## What happens

1. Coder checkpoints work and requests review via a `SyncTransaction`
2. The transaction creates a `SyncGate` — all agents are blocked
3. Reviewer approves the transaction
4. Gate resolves — agents can continue
