# Session Playbook — Sync Responsibilities By Role

This document describes how each role participates in a SyncPoint synchronization session using CLI and MCP interfaces.

## Overview

A SyncPoint session moves through phases:

```
PLANNING → EXECUTING → REVIEWING → COMPLETED
```

Each phase has specific synchronization responsibilities for each role. The playbook engine recommends the next sync action, but wake requests are obligations to inspect and clear blockers, not permission to run autonomously.

## Quick Start

Before creating sessions, prepare agent windows:

```bash
syncpoint setup --agents 3 --editor cursor
# or:
syncpoint connect --name architect --provider cursor --role manager --editor cursor
syncpoint connect --name executor-a --provider cursor --role backend --editor cursor
syncpoint connect --name reviewer --provider cursor --role reviewer --editor cursor
syncpoint doctor
```

Low-level session/playbook commands still use agent IDs. Use `syncpoint doctor`
or `syncpoint agent list` to find IDs after setup.

### CLI

```bash
# Get next action for an agent in a session
syncpoint playbook next-action --session <id> --agent <id>

# Find active session for an agent
syncpoint playbook active-session --agent <id>

# Capture command output as review evidence
syncpoint playbook capture-evidence --review <id> --command "pnpm test" --output "..." --exit-code 0
```

### MCP

```
Tool: syncpoint_next_action        — get next action for agent in session
Tool: syncpoint_capture_evidence   — record command output as evidence
Tool: syncpoint_active_session     — find active session for agent
Resource: syncpoint://active-session/{agentId}
Resource: syncpoint://session/{sessionId}/next-action/{agentId}
Prompt: syncpoint_session_playbook — role-specific playbook with next actions
```

---

## Architect Playbook

### PLANNING Phase

1. **Create session**
   ```bash
   syncpoint session create --title "Feature X" --architect <agentId>
   ```

2. **Assign roles** to executor and reviewer agents
   ```bash
   syncpoint session assign-role --session <id> --agent <execId> --role executor
   syncpoint session assign-role --session <id> --agent <revId> --role reviewer
   ```

3. **Plan tasks** — decompose work, assign executors, and define resource/review boundaries
   ```bash
   syncpoint session plan --session <id> --task <taskId> --assignee <execId>
   ```

4. **Advance session** to EXECUTING
   ```bash
   syncpoint session advance --session <id>
   ```

### EXECUTING Phase

5. **Monitor blockers** — check next actions, session status, resource claims, and gates
   ```bash
   syncpoint playbook next-action --session <id> --agent <archId>
   syncpoint session status --session <id>
   ```

6. **Request reviews** when all tasks are completed
   ```bash
   syncpoint session review --session <id> --task <taskId> --reviewer <revId>
   ```

7. **Advance session** to REVIEWING
   ```bash
   syncpoint session advance --session <id>
   ```

### REVIEWING Phase

8. **Monitor reviews** and advance when all decided
   ```bash
   syncpoint session advance --session <id>
   ```

---

## Executor Playbook

### EXECUTING Phase

1. **Accept assignment**
   ```bash
   syncpoint session accept --assignment <id>
   ```

2. **Start work**
   ```bash
   syncpoint session start --assignment <id>
   ```

3. **Regular checkpoints** during work, especially before another agent continues
   ```bash
   syncpoint loop checkpoint --agent <id> --task <taskId> --summary "..."
   ```

4. **Address change requests** if reviewer blocks
   ```bash
   syncpoint review changes-address --change <changeId>
   ```

5. **Complete assignment** when done
   ```bash
   syncpoint session complete --assignment <id>
   ```

---

## Reviewer Playbook

### REVIEWING Phase

1. **Start review**
   ```bash
   syncpoint session start-review --review <id>
   ```

2. **Add checklist items**
   ```bash
   syncpoint review checklist-add --review <id> --title "Build passes"
   syncpoint review checklist-add --review <id> --title "Tests pass"
   syncpoint review checklist-add --review <id> --title "Types check"
   ```

3. **Capture evidence** from commands
   ```bash
   syncpoint playbook capture-evidence --review <id> --command "pnpm build" --output "..." --exit-code 0
   syncpoint playbook capture-evidence --review <id> --command "pnpm test" --output "..." --exit-code 0
   syncpoint playbook capture-evidence --review <id> --command "pnpm typecheck" --output "..." --exit-code 0
   ```

4. **Pass/fail checklist items**
   ```bash
   syncpoint review checklist-pass --item <itemId>
   syncpoint review checklist-fail --item <itemId>
   ```

5. **Evaluate gate**
   ```bash
   syncpoint review gate --review <id>
   ```

6. **Approve** (gate must be PASSED) or **block** with change requests
   ```bash
   syncpoint review approve --review <id> --summary "All checks passed"
   # or
   syncpoint review block --review <id> --summary "Issues found" --changes "Fix failing tests"
   ```

---

## Evidence Capture Helper

The `capture-evidence` command auto-detects evidence kind from the command name:

| Command pattern | Detected kind |
|---|---|
| `test`, `vitest`, `jest` | `test` |
| `build`, `tsc`, `esbuild` | `build` |
| `typecheck`, `tsc --noEmit` | `typecheck` |
| `lint`, `eslint`, `biome` | `lint` |
| `diff`, `git diff` | `diff` |
| anything else | `manual` |

You can override with `--kind <kind>`.

---

## MCP Agent Integration

Editor agents can read the active session state and next actions via MCP resources:

### Read active session

```
Resource: syncpoint://active-session/{agentId}
```

Returns session status, roles, assignment/review counts, and recommended next actions.

### Read next actions for a specific session

```
Resource: syncpoint://session/{sessionId}/next-action/{agentId}
```

Returns prioritized list of actions with CLI hints and MCP tool names.

### Generate role-specific playbook prompt

```
Prompt: syncpoint_session_playbook
Args: { sessionId, agentId }
```

Returns a full playbook prompt with role guidance, current state, blockers, and recommended sync actions.

---

## Action Priority

Actions are prioritized:

- **P1 — Immediate**: Action is blocking progress (accept assignment, start review, approve)
- **P2 — Soon**: Action is recommended but not blocking (checkpoint, complete)
- **P3 — Optional**: Informational or waiting (wait, session-completed)
