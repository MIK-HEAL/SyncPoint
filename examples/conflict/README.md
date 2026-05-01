# File Conflict Example

Two agents claim the same file — SyncPoint blocks unsafe continuation.

## Run

```bash
syncpoint demo --stage blocked
```

Or step-by-step:

```bash
syncpoint init
syncpoint agent add --name agent-a --provider claude-code --role backend
syncpoint agent add --name agent-b --provider cursor --role backend

# Agent A claims a file
syncpoint claim src/shared-config.ts --agent <agentA> --task <taskId> --mode exclusive

# Agent B tries to claim the same file → BLOCKED
syncpoint claim src/shared-config.ts --agent <agentB> --task <taskId> --mode exclusive

# See the blocked state
syncpoint status
```

## What happens

1. Agent A claims `src/shared-config.ts` exclusively
2. Agent B tries to claim the same file
3. SyncPoint detects a **hard conflict** and creates a `SyncGate`
4. Both agents are blocked until the gate is resolved
5. `syncpoint status` shows who is blocked, why, and what to do
