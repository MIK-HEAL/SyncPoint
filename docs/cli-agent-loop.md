# SyncPoint CLI Agent Loop

The `syncpoint loop` commands provide a **composite CLI interface** for AI editors and agents. Each command orchestrates multiple SyncPoint primitives into a single step, enforcing the collaboration protocol.

## Quick Start

```bash
# 1. Initialize project
syncpoint init

# 2. Register agent + create task
syncpoint agent add --name cursor --provider cursor --role frontend
syncpoint task create "Build dashboard" -d "Full-stack dashboard"

# 3. Boot the agent loop (assigns task, generates rules files)
syncpoint loop boot --agent <agentId> --task <taskId> --provider cursor

# 4. Work... then checkpoint
syncpoint loop checkpoint --agent <agentId> --task <taskId> \
  --summary "Header component done" \
  --next-steps "Add navigation" \
  --working-files "src/Dashboard.tsx"

# 5. Resume after context switch
syncpoint loop resume --agent <agentId> --task <taskId> --provider cursor

# 6. Handoff to another agent
syncpoint loop handoff --task <taskId> \
  --from <frontendAgentId> --to <backendAgentId> \
  --context "Need API endpoints" --auto-accept

# 7. Check status anytime
syncpoint loop status --agent <agentId>
```

## Commands

### `syncpoint loop boot`

**Purpose**: Start working on a task. Assigns the task, advances it to IN_PROGRESS, enforces context policy, and generates editor rules files.

```bash
syncpoint loop boot \
  --agent <agentId> \
  --task <taskId> \
  [--provider cursor|codex|claude-code|cline] \
  [--json]
```

**What it does**:
1. Ensures task is assigned to the agent
2. Advances task status to `IN_PROGRESS`
3. Runs context policy enforcement
4. Generates adapter files (`.cursorrules`, `AGENTS.md`, etc.)

**Exit codes**: `0` success, `4` task assigned to different agent

### `syncpoint loop resume`

**Purpose**: Resume work after a pause or context switch. Enforces context policy, regenerates rules files, and outputs the resume prompt.

```bash
syncpoint loop resume \
  --agent <agentId> \
  --task <taskId> \
  [--provider cursor|codex|claude-code|cline] \
  [--format system-prompt|cursorrules|agents-md|clipboard] \
  [--json]
```

**What it does**:
1. Enforces context policy (**fails with exit 2 if not ready**)
2. Advances task to `IN_PROGRESS` if in `READY_TO_WORK` or `NEEDS_SYNC`
3. Generates adapter files
4. Outputs formatted resume prompt

**Exit codes**: `0` success, `2` context policy not met

### `syncpoint loop checkpoint`

**Purpose**: Save progress. Creates a checkpoint + context capsule atomically, then refreshes editor rules files.

```bash
syncpoint loop checkpoint \
  --agent <agentId> \
  --task <taskId> \
  --summary "What was done" \
  [--progress "60%"] \
  [--next-steps "What to do next"] \
  [--goal "Capsule goal"] \
  [--phase "implementation"] \
  [--completed "Done work"] \
  [--remaining "Left to do"] \
  [--working-files "src/foo.ts, src/bar.ts"] \
  [--resume-prompt "Custom resume text"] \
  [--risks "Any risks"] \
  [--blockers "Any blockers"] \
  [--need-sync] \
  [--provider cursor] \
  [--json]
```

**What it does**:
1. Creates checkpoint with summary
2. Creates context capsule (inherits `goal`/`phase` from latest if not specified)
3. Sets resume prompt (defaults to `--summary`)
4. If `--need-sync`, flags task as `NEEDS_SYNC`
5. Refreshes editor rules files

### `syncpoint loop handoff`

**Purpose**: Hand off a task to another agent. Saves the sender's final capsule, creates the handoff record, and generates rules files for the receiver.

```bash
syncpoint loop handoff \
  --task <taskId> \
  --from <fromAgentId> \
  --to <toAgentId> \
  --context "What the receiver needs to know" \
  [--auto-accept] \
  [--provider codex] \
  [--json]
```

**What it does**:
1. Creates sender's final checkpoint + capsule with `phase: handoff`
2. Creates handoff record
3. Optionally auto-accepts the handoff
4. Generates adapter files for the **receiver** agent

### `syncpoint loop status`

**Purpose**: Show the agent's current working state at a glance.

```bash
syncpoint loop status \
  --agent <agentId> \
  [--task <taskId>] \
  [--json]
```

**Output fields** (JSON):
- `agentId`, `agentName`, `agentStatus`
- `taskId`, `taskTitle`, `taskStatus`
- `contractStatus`
- `checkpointCount`, `hasCapsule`
- `contextReady`, `warnings`

## Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | Success |
| `1`  | General error |
| `2`  | Context policy not met (capsule missing, stale, etc.) |
| `3`  | Contract not approved |
| `4`  | Task/handoff state invalid |

AI editors can use exit codes to decide:
- `0` → continue working
- `2` → run `loop checkpoint` first, then retry
- `3` → draft/approve a contract first
- `4` → check task assignment or handoff state

## JSON Output

All loop commands support `--json` for machine-readable output:

```bash
syncpoint loop boot --agent a1 --task t1 --json
```

```json
{
  "ok": true,
  "taskId": "t1",
  "agentId": "a1",
  "provider": "cursor",
  "taskStatus": "IN_PROGRESS",
  "contextReady": true,
  "filesWritten": [".cursorrules"],
  "warnings": []
}
```

Error output:

```json
{
  "ok": false,
  "error": "Context not ready: No context capsule found",
  "exitCode": 2
}
```

## Lifecycle Flows

### Single Agent

```
loop boot
  → work → loop checkpoint → work → loop checkpoint → ...
  → loop resume (after context switch)
  → loop status (anytime)
```

### Two-Agent Handoff

```
Agent A: loop boot → work → loop checkpoint → loop handoff --to B
Agent B: loop boot → work → loop checkpoint → ...
```

### Contract-Gated Task

```
agent add → task create → task assign
→ contract draft → contract review → contract approve
→ loop boot (task advances to IN_PROGRESS)
→ loop checkpoint → loop resume → ...
```

### Memory Switch Flow

```
memory set --key code-style --content "Use TypeScript strict mode"
→ loop boot (generates .cursorrules with pinned memory)
→ loop resume (re-generates with latest context)
```

## Provider-Specific Rules Files

| Provider | Primary File | Extra Files |
|----------|-------------|-------------|
| `cursor` | `.cursorrules` | — |
| `claude-code` | `AGENTS.md` | `.syncpoint/resume-prompt.md` |
| `codex` | `AGENTS.md` | `.syncpoint/resume-prompt.md` |
| `cline` | `.syncpoint/resume-prompt.md` | `.cursorrules` |
| `copilot` | `AGENTS.md` | — |

Use `syncpoint adapter info` to list all providers and their file mappings.
