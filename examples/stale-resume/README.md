# Stale Resume Example

An agent tries to resume from an outdated checkpoint — SyncPoint warns about stale context.

## Run

```bash
syncpoint init
syncpoint agent add --name agent-a --provider claude-code --role backend

# Create a task and boot
syncpoint task create --title "Implement auth" --desc "Auth module"
syncpoint loop boot --agent <agentA> --task <taskId>

# Checkpoint work
syncpoint checkpoint --agent <agentA> --task <taskId> --summary "Draft auth logic"

# ... time passes, another agent modifies shared state ...

# Resume — SyncPoint validates capsule freshness
syncpoint resume --agent <agentA> --task <taskId>
```

## What happens

1. Agent checkpoints its progress (creates a context capsule)
2. Between sessions, the shared state changes (other agents work, constraints update)
3. On resume, SyncPoint checks capsule validity — if stale, it warns the agent
4. If blockers exist (sync gates, constraint violations), the resume includes them in the prompt
