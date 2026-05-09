# 03 — Constraint Enforcement Tour

## Disaster

A capsule says:

```text
Do not touch the authentication module.
```

An agent still tries to modify `src/auth/session.ts`. If that instruction only lives in a prompt, the agent can miss it. SyncPoint treats selected project knowledge as executable constraint state, not just prose.

## What You Will See

- A scoped Project Memory entry marks `src/auth` as `do_not_touch`.
- Constraint Runtime projects that memory into `constraintRules`.
- A resume/check action touching `src/auth/session.ts` returns `BLOCKED`.
- `loopResume` also blocks; this is not merely a warning in the generated prompt.

## Prerequisites

From the SyncPoint repository root:

```powershell
pnpm install
pnpm build
$SyncPointRepo = (Get-Location).Path
function sp { node "$SyncPointRepo/packages/syncpoint-cli/dist/main.js" @args }
```

This tour uses a tiny Node seeding step because current short CLI commands can add basic project knowledge, but do not yet expose every Project Memory V2 field such as `kind` and `appliesTo`.

## Step 1 — Create An Isolated Tour Project

```powershell
$Project = Join-Path $env:TEMP ("syncpoint-tour-constraint-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force $Project | Out-Null
Set-Location $Project
sp init .
New-Item -ItemType Directory -Force src/auth | Out-Null
"export const sessionVersion = 1;" | Set-Content -Encoding UTF8 src/auth/session.ts
```

## Step 2 — Register Agent And Task

```powershell
$Agent = (sp connect --name auth-agent --provider cursor --role backend --editor cursor --json | ConvertFrom-Json).agent.id
$Task = (sp task create "Tour 03: auth freeze violation" -d "Try to touch src/auth while it is frozen" | ConvertFrom-Json).id
```

## Step 3 — Seed A Scoped `do_not_touch` Rule

Run this from the same PowerShell session:

```powershell
$env:SYNCPOINT_DB_DIR = Join-Path $Project ".syncpoint"
Set-Location $SyncPointRepo
@'
import { pmAdd, pmApprove } from "syncpoint-server/application";

const memory = pmAdd({
  scope: "project",
  category: "gotcha",
  title: "Authentication module is frozen",
  content: "Do not touch src/auth until the incident review closes.",
  tags: "auth,freeze,tour",
  sourceType: "human",
  confidence: "high",
  taskId: null,
  createdBy: "tour-architect",
  kind: "do_not_touch",
  appliesTo: { files: ["src/auth"] },
  global: true,
});

pmApprove(memory.id, "tour-architect");
console.log(JSON.stringify({ memoryId: memory.id, title: memory.title, appliesTo: memory.appliesTo }, null, 2));
'@ | node --input-type=module
Set-Location $Project
```

Expected output includes a `memoryId` and `appliesTo` scope for `src/auth`.

## Step 4 — Ask The Runtime Directly

```powershell
sp constraint check --action resume --task $Task --agent $Agent --files src/auth/session.ts
```

Expected result:

```text
Constraint Runtime: BLOCKED
Action: resume

Blockers:
- do_not_touch_scope_overlap
  Message: Resource(s) touch protected scope "Authentication module is frozen": src/auth/session.ts
  Evidence: src/auth/session.ts
```

Now compare a safe resource:

```powershell
sp constraint check --action resume --task $Task --agent $Agent --files src/profile/view.ts
```

Expected result:

```text
Constraint Runtime: PERMITTED
No blockers or warnings.
```

## Step 5 — Prove Resume Is Also Blocked

Create a capsule/checkpoint whose working resources touch the protected scope:

```powershell
sp checkpoint `
  --agent auth-agent `
  --task $Task `
  --summary "Attempting auth module edit" `
  --working-resources "src/auth/session.ts" `
  --json | Out-Null
```

Try to resume:

```powershell
sp resume --agent auth-agent --task $Task
```

Expected result:

```text
Blocked (exit 2): Constraint violation: Resource(s) touch protected scope "Authentication module is frozen": src/auth/session.ts
```

This is the wall: the constraint does not only appear in a prompt; it participates in the execution permission decision.

## Step 6 — Inspect The Machine-Readable Manifest

```powershell
sp constraint check --action resume --task $Task --agent $Agent --files src/auth/session.ts --json | ConvertFrom-Json | Select-Object permitted, blockers, manifest
```

Expected fields:

```text
permitted : False
blockers  : ... do_not_touch_scope_overlap ...
manifest  : projectionId, memoryVersion, action, touchedResources, hash, evaluatedAt
```

The manifest is the audit record: which projection was used, which rules fired, which resources were checked, and the decision hash.

## What This Proves

- **A hard boundary must be executable**: a rule in a prompt is not enough.
- **`do_not_touch` is scoped**: only resources overlapping `appliesTo.files` trigger this rule.
- **Constraint Runtime is separate from capsule visibility**: the agent may see projected reality, but permission is decided by runtime evaluation.
- **Failing constraints block continuation**: `loopResume` stops before handing the agent a normal resume prompt.

## Next Tour

Continue to [04 — Liveness And Escalation](04-liveness-and-escalation-tour.md) to see how a blocker avoids becoming an invisible zombie lock.
