# 02 — Transaction Purity Tour

## Disaster

Agent A checkpoints a risky intermediate state. Agent B resumes from that state before anyone approves it.

Without SyncPoint, a checkpoint can become poisoned context: it looks like progress, but it has not been confirmed as a safe base for the next agent.

SyncPoint changes the question from "does a checkpoint exist?" to:

```text
Has this checkpoint been approved as a valid continuation base?
```

## What You Will See

- Agent A creates a checkpoint and marks it as needing synchronization.
- A `SyncTransaction` is created for that checkpoint.
- The transaction creates a bound `SyncGate` with reason `checkpoint_required`.
- Agent B is blocked from resuming while the transaction is waiting or rejected.
- The rejected branch is resolved as discarded, then a separate fresh transaction demonstrates the approval path.

## Prerequisites

From the SyncPoint repository root:

```powershell
pnpm install
pnpm build
$SyncPointRepo = (Get-Location).Path
function sp { node "$SyncPointRepo/packages/syncpoint-cli/dist/main.js" @args }
```

## Step 1 — Create An Isolated Tour Project

```powershell
$Project = Join-Path $env:TEMP ("syncpoint-tour-transaction-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Project | Out-Null
Set-Location $Project
sp init .
```

## Step 2 — Register Agents, Task, And Session

```powershell
$AgentA = (sp connect --name agent-a --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
$AgentB = (sp connect --name agent-b --provider cursor --role reviewer --editor cursor --json | ConvertFrom-Json).agent.id
$Task = (sp task create "Tour 02: checkpoint purity" -d "Checkpoint must be approved before another agent resumes" | ConvertFrom-Json).id
$Session = (sp session create --title "Tour 02 Transaction Purity" --architect $AgentA --mode handoff-resume --json | ConvertFrom-Json).session.id
sp session assign-role --session $Session --agent $AgentA --role executor --json | Out-Null
sp session assign-role --session $Session --agent $AgentB --role reviewer --json | Out-Null
```

## Step 3 — Agent A Creates A Checkpoint That Needs Sync

```powershell
$CheckpointResult = sp checkpoint `
  --agent agent-a `
  --task $Task `
  --summary "Risky auth/session refactor checkpoint" `
  --progress "60%" `
  --working-resources "src/auth/session.ts" `
  --next-steps "Wait for Agent B approval before anyone resumes from this state" `
  --need-sync `
  --json | ConvertFrom-Json

$Checkpoint = $CheckpointResult.checkpointId
$Checkpoint
```

At this point the checkpoint exists, but existence is not approval.

## Step 4 — Wrap The Checkpoint In A SyncTransaction

```powershell
$TxResult = sp sync tx create `
  --checkpoint $Checkpoint `
  --session $Session `
  --task $Task `
  --agent $AgentA `
  --approvers $AgentB `
  --json | ConvertFrom-Json

$Tx = $TxResult.tx.id
$Gate = $TxResult.tx.gateId
sp sync tx status --tx $Tx
```

Expected result:

```text
SyncTransaction: <txId> [WAITING_APPROVAL]
  Gate: <gateId>
  Checkpoint: <checkpointId>
  Pending: <agent-b>
  Blocking: yes
```

Inspect the bound gate:

```powershell
sp sync status --gate $Gate --agent $AgentB
```

Expected result:

```text
Policy: all_required
Blocking: yes
Your actions: ack, vote
Description: Sync transaction for checkpoint <checkpointId>
```

## Step 5 — Agent B Tries To Resume Too Early

```powershell
sp resume --agent agent-b --task $Task --session $Session
```

Expected result:

```text
Blocked (exit 4): Agent blocked by sync gate(s): <gateId>. Acknowledge before resuming.
```

This is the important contrast with Git: Git can check out the repository, but SyncPoint refuses to treat the unapproved checkpoint as a safe continuation base.

## Step 6 — Branch A: Reject And Discard The Checkpoint

```powershell
sp sync tx reject --tx $Tx --agent $AgentB --reason "Checkpoint is based on the wrong API contract."
sp sync tx status --tx $Tx
sp sync status --gate $Gate --agent $AgentB
```

Expected result:

```text
SyncTransaction: <txId> [REJECTED]
Blocking: yes
```

A rejected transaction remains blocking until a follow-up decision resolves what to do next. That is how SyncPoint prevents the rejected checkpoint from silently becoming the next agent's base reality.

Try to resume from the rejected branch:

```powershell
sp resume --agent agent-b --task $Task --session $Session
```

Expected result:

```text
Blocked (exit 4): Agent blocked by sync gate(s): <gateId>. Acknowledge before resuming.
```

Record the follow-up decision before moving on:

```powershell
sp sync tx resolve --tx $Tx --summary "Rejected checkpoint discarded; do not use it as downstream base."
sp sync tx status --tx $Tx
sp sync status --gate $Gate --agent $AgentB
```

Expected result:

```text
SyncTransaction: <txId> [RESOLVED]
Blocking: no

SyncGate: <gateId> [READY_TO_CONTINUE]
Blocking: no
```

Resolution here does not approve the rejected checkpoint. It records the decision that the poisoned checkpoint must not become downstream base reality, then releases the administrative blocker.

## Step 7 — Branch B: Approve A Fresh Transaction

Create a fresh checkpoint and transaction. This is intentionally a new branch, not an approval of the rejected checkpoint above:

```powershell
$Checkpoint2 = (sp checkpoint `
  --agent agent-a `
  --task $Task `
  --summary "Corrected checkpoint after API contract review" `
  --progress "90%" `
  --working-resources "src/auth/session.ts" `
  --next-steps "Approved handoff to Agent B" `
  --need-sync `
  --json | ConvertFrom-Json).checkpointId

$TxResult2 = sp sync tx create `
  --checkpoint $Checkpoint2 `
  --session $Session `
  --task $Task `
  --agent $AgentA `
  --approvers $AgentB `
  --json | ConvertFrom-Json

$Tx2 = $TxResult2.tx.id
$Gate2 = $TxResult2.tx.gateId
```

Approve and resolve it:

```powershell
sp sync tx approve --tx $Tx2 --agent $AgentB --summary "Checkpoint is now a safe continuation base."
sp sync tx resolve --tx $Tx2 --summary "Checkpoint accepted for downstream work."
sp sync tx status --tx $Tx2
sp sync status --gate $Gate2 --agent $AgentB
```

Expected result:

```text
SyncTransaction: <txId> [RESOLVED]
Blocking: no

SyncGate: <gateId> [READY_TO_CONTINUE]
Blocking: no
```

## What This Proves

- **A checkpoint is evidence, not permission**.
- **SyncTransaction turns checkpoint reuse into an approval flow**.
- **Rejected or waiting transactions block continuation**.
- **The bound SyncGate makes checkpoint purity visible to CLI, MCP, SDK, and Sync View**.

## Next Tour

Continue to [03 — Constraint Enforcement](03-constraint-enforcement-tour.md) to see a hard `do_not_touch` boundary block an unsafe action.
