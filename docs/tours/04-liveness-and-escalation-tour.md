# 04 — Liveness And Escalation Tour

## Disaster

Agent A owns an urgent hotfix boundary. Agent B is blocked. Agent A goes offline.

Without liveness, the gate becomes a zombie lock: everybody is blocked, but nobody can tell whether they should wait, vote, escalate, or ask a human to decide.

SyncPoint changes the question from "is the gate still open?" to:

```text
Is this gate still live, and what action is now allowed?
```

## What You Will See

- `syncpoint sync status --gate` performs lazy liveness reconciliation.
- An expired gate becomes `TIMED_OUT` and requires human action.
- A `majority_veto` policy escalates when a strict majority rejects continued waiting.
- Gate status exposes pending agents, votes, vote counts, eligible voters, liveness preview, and available actions.

## Prerequisites

From the SyncPoint repository root:

```powershell
pnpm install
pnpm build
$SyncPointRepo = (Get-Location).Path
function sp { node "$SyncPointRepo/packages/syncpoint-cli/dist/main.js" @args }
```

This tour uses a tiny Node seeding step because the current CLI can inspect, vote, acknowledge, resolve, and cancel gates, but does not yet expose every `GatePolicy` field on `sync request`.

## Step 1 — Create An Isolated Tour Project

```powershell
$Project = Join-Path $env:TEMP ("syncpoint-tour-liveness-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Project | Out-Null
Set-Location $Project
sp init .
```

## Step 2 — Register Agents And Task

```powershell
$Owner = (sp connect --name owner-agent --provider cursor --role manager --editor cursor --json | ConvertFrom-Json).agent.id
$WorkerA = (sp connect --name worker-a --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
$WorkerB = (sp connect --name worker-b --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
$Human = (sp connect --name human-lead --provider human --role reviewer --editor cursor --json | ConvertFrom-Json).agent.id
$Task = (sp task create "Tour 04: zombie gate" -d "Show timeout, escalation, voting, and human decision" | ConvertFrom-Json).id
```

## Part A — Timeout Becomes A Human Decision

### Step A1 — Seed An Already-Expired Gate

```powershell
$env:SYNCPOINT_DB_DIR = Join-Path $Project ".syncpoint"
$env:TOUR_TASK = $Task
$env:TOUR_OWNER = $Owner
$env:TOUR_WORKER = $WorkerA
$env:TOUR_HUMAN = $Human
Set-Location $SyncPointRepo
$TimedOutGate = (@'
import { sgRequest } from "syncpoint-server/application";

const deadline = new Date(Date.now() - 60_000).toISOString();
const result = sgRequest({
  taskId: process.env.TOUR_TASK,
  requestedByAgentId: process.env.TOUR_OWNER,
  requiredAgentIds: [process.env.TOUR_WORKER],
  reason: "manual_request",
  description: "Worker is blocked, but the owner went offline before deciding.",
  policy: {
    kind: "all_required",
    deadlineAt: deadline,
    timeoutAction: "await_decision",
    escalationAgentIds: [process.env.TOUR_HUMAN],
  },
});

console.log(JSON.stringify({ gateId: result.gate.id, deadlineAt: deadline }, null, 2));
'@ | node --input-type=module | ConvertFrom-Json).gateId
Set-Location $Project
$TimedOutGate
```

### Step A2 — Status Lazily Reconciles Liveness

```powershell
sp sync status --gate $TimedOutGate --agent $Human
```

Expected result:

```text
SyncGate: <gateId> [TIMED_OUT]
  Policy: all_required
  Blocking: yes
  Deadline: <past ISO timestamp>
  Requires Human: yes
  Escalation: <human-lead>
  Liveness: require_human_override — Deadline passed — awaiting decision
  Your actions: resolve, cancel, request_more_info
```

No background daemon was required for this proof. The status call reconciled before returning, so users do not see stale gate state.

### Step A3 — Human Resolves The Gate

```powershell
sp sync resolve --gate $TimedOutGate --summary "Human lead chose the safe continuation path after timeout."
sp sync status --gate $TimedOutGate --agent $Human
```

Expected result:

```text
SyncGate: <gateId> [READY_TO_CONTINUE]
Blocking: no
```

## Part B — Majority Vote Escalates A Stuck Gate

### Step B1 — Seed A `majority_veto` Gate

```powershell
$env:TOUR_WORKER_A = $WorkerA
$env:TOUR_WORKER_B = $WorkerB
Set-Location $SyncPointRepo
$VoteGate = (@'
import { sgRequest } from "syncpoint-server/application";

const result = sgRequest({
  taskId: process.env.TOUR_TASK,
  requestedByAgentId: process.env.TOUR_OWNER,
  requiredAgentIds: [process.env.TOUR_WORKER_A, process.env.TOUR_WORKER_B, process.env.TOUR_HUMAN],
  reason: "manual_request",
  description: "Workers disagree with continued waiting on a stalled owner decision.",
  policy: {
    kind: "majority_veto",
    escalationAgentIds: [process.env.TOUR_HUMAN],
  },
});

console.log(JSON.stringify({ gateId: result.gate.id }, null, 2));
'@ | node --input-type=module | ConvertFrom-Json).gateId
Set-Location $Project
$VoteGate
```

### Step B2 — Cast Votes

```powershell
sp sync vote --gate $VoteGate --agent $WorkerA --vote reject --summary "The owner is stale; do not keep waiting."
sp sync vote --gate $VoteGate --agent $WorkerB --vote reject --summary "Escalate to human lead."
sp sync status --gate $VoteGate --agent $Human
```

Expected result:

```text
SyncGate: <gateId> [ESCALATED]
  Policy: majority_veto
  Required: <worker-a>, <worker-b>, <human-lead>
  Votes: approve=0 reject=2 abstain=0 escalate=0
  Liveness: escalate — Majority rejected continued waiting (2/2)
  Requires Human: yes
  Your actions: ack, vote, resolve, cancel, request_more_info
```

The majority threshold is strict: for 3 required agents, 2 votes are enough; for 2 required agents, 2 are required.

### Step B3 — Human Records The Decision

```powershell
sp sync resolve --gate $VoteGate --summary "Escalated decision accepted: stop waiting and continue with the safer plan."
sp sync status --gate $VoteGate --agent $Human
```

Expected result:

```text
SyncGate: <gateId> [READY_TO_CONTINUE]
Blocking: no
Decision: Escalated decision accepted: stop waiting and continue with the safer plan.
```

## What This Proves

- **Zombie gates become visible**: status includes deadlines, liveness preview, and required action.
- **No stale status is returned**: `sgStatusDetailed` reconciles before printing.
- **Votes are governed**: only required, owner, or escalation agents can vote; vote kinds are lowercase enum values.
- **Last vote wins**: duplicate votes update one row per `(gate, agent)`.
- **Human resolution is explicit**: escalation still ends in a recorded `READY_TO_CONTINUE` or `CANCELLED` decision.

## Where This Should Influence UI Later

Any future TUI or GUI must make this tour faster, not hide the protocol.

The minimum visible decision payload is:

```text
gate id
status
policy
required / acked / pending
votes and vote counts
deadline
liveness preview
eligible voters
available actions for the current actor
decision summary
```

If a UI cannot show those fields clearly, it is decoration rather than synchronization design.
