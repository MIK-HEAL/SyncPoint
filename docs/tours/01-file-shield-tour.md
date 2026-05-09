# 01 — File Shield Tour

## Disaster

Agent A and Agent B both want to edit `src/shared-config.ts`.

Git may merge two non-overlapping lines without complaint: one agent changes the API base URL, the other changes timeout behavior. The text merge can succeed while the product logic is now inconsistent.

SyncPoint changes the first question from "can Git merge this later?" to:

```text
Who declared ownership before continuing?
```

## What You Will See

- **Agent A** claims `file:src/shared-config.ts` exclusively.
- **Agent B** tries to claim the same file.
- SyncPoint detects a hard `ResourceClaim` overlap.
- SyncPoint creates a `SyncGate` with reason `resource_conflict`.
- `syncpoint sync status --gate` shows pending agents, liveness preview, and available actions.
- Acknowledgement alone does not release the gate. Only `READY_TO_CONTINUE` does.

This is the first "aha" moment: SyncPoint stops unsafe continuation before the second agent should save work through a SyncPoint-aware workflow.

## Prerequisites

From the SyncPoint repository root:

```powershell
pnpm install
pnpm build
```

Define a local helper for the built CLI:

```powershell
$SyncPointRepo = (Get-Location).Path
function sp { node "$SyncPointRepo/packages/syncpoint-cli/dist/main.js" @args }
```

If you installed the CLI globally, replace `sp` with `syncpoint`.

## Step 1 — Create An Isolated Tour Project

```powershell
$Project = Join-Path $env:TEMP ("syncpoint-tour-file-shield-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Project | Out-Null
Set-Location $Project
sp init .
New-Item -ItemType Directory -Force src | Out-Null
@'
export const sharedConfig = {
  apiBaseUrl: "https://api.dev.local",
  timeoutMs: 5000,
};
'@ | Set-Content -Encoding UTF8 src/shared-config.ts
```

## Step 2 — Register Two Agents

```powershell
$AgentA = (sp connect --name agent-a --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
$AgentB = (sp connect --name agent-b --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
```

## Step 3 — Create The Collaboration Scope

```powershell
$Task = (sp task create "Tour 01: protect shared config" -d "Two agents want to edit shared-config.ts" | ConvertFrom-Json).id
$Session = (sp session create --title "Tour 01 File Shield" --architect $AgentA --mode peer-contract --json | ConvertFrom-Json).session.id
sp session assign-role --session $Session --agent $AgentA --role executor --json | Out-Null
sp session assign-role --session $Session --agent $AgentB --role executor --json | Out-Null
```

## Step 4 — Agent A Claims The Shared File

```powershell
$ClaimA = sp claim src/shared-config.ts --agent agent-a --task $Task --session $Session --json | ConvertFrom-Json
$ClaimA.claim.resources
```

Expected result:

```text
type locator              metadata
---- -------              --------
file src/shared-config.ts
```

## Step 5 — Agent B Hits The Shield

```powershell
$ClaimB = sp claim src/shared-config.ts --agent agent-b --task $Task --session $Session --json | ConvertFrom-Json
$ClaimB.conflicts
$Gate = $ClaimB.gateId
```

Expected result:

```text
resourceType       : file
overlappingLocator : src/shared-config.ts
isHardConflict     : True
```

SyncPoint has created a gate:

```powershell
$Gate
```

## Step 6 — Inspect The Gate

```powershell
sp sync status --gate $Gate --agent $AgentB
```

Expected shape:

```text
SyncGate: <gateId> [SYNC_REQUESTED]
  Policy: all_required
  Required: <agent-b>, <agent-a>
  Acked: none
  Pending: <agent-b>, <agent-a>
  Blocking: yes
  Liveness: continue_blocking — Waiting: ...
  Your actions: ack, vote
  Description: Resource conflict: src/shared-config.ts
```

Also inspect whether Agent B is blocked in this session:

```powershell
sp sync status --session $Session --agent $AgentB
```

Expected result:

```text
Blocked: yes
```

## Step 7 — Prove That Ack Is Not Permission

```powershell
sp sync ack --gate $Gate --agent $AgentA --summary "Agent A sees the overlap."
sp sync ack --gate $Gate --agent $AgentB --summary "Agent B will wait before editing."
sp sync status --gate $Gate --agent $AgentB
```

Expected result:

```text
SyncGate: <gateId> [SYNC_ACKED]
Blocking: yes
Liveness: continue_blocking — All acked — awaiting explicit resolve
```

This invariant is central:

```text
SYNC_ACKED still blocks.
READY_TO_CONTINUE releases.
```

## Step 8 — Resolve The Boundary

```powershell
sp sync resolve --gate $Gate --summary "Agent A and Agent B agreed on the shared-config ownership boundary."
sp sync status --gate $Gate --agent $AgentB
```

Expected result:

```text
SyncGate: <gateId> [READY_TO_CONTINUE]
Blocking: no
Your actions: view_only
```

## What This Proves

- **ResourceClaim is pre-merge coordination**: it catches semantic overlap before Git has a chance to silently accept incompatible edits.
- **SyncGate is a hard boundary**: agents must synchronize before crossing it.
- **Acknowledgement is not resolution**: seeing the blocker and clearing the blocker are different protocol states.
- **SyncPoint is not an OS file lock**: external editors can still write files if they bypass SyncPoint. The guarantee applies to agents and tools that route start/resume/wake/apply through SyncPoint.

## Next Tour

Continue to [02 — Transaction Purity](02-transaction-purity-tour.md) to see why a checkpoint is not safe just because it exists.
