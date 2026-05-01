# Handoff Example

One agent hands off a task to another with full context transfer.

## Run

```bash
syncpoint init
syncpoint agent add --name agent-a --provider claude-code --role backend
syncpoint agent add --name agent-b --provider cursor --role backend

# Agent A works on task
syncpoint task create --title "Build API" --desc "REST API implementation"
syncpoint loop boot --agent <agentA> --task <taskId>

# Agent A checkpoints and hands off
syncpoint loop handoff --task <taskId> --from <agentA> --to <agentB> \
  --context "API routes done, need error handling" --auto-accept

# Agent B resumes with full context
syncpoint resume --agent <agentB> --task <taskId>
```

## What happens

1. Agent A works on a task and creates a context capsule
2. Agent A initiates a handoff to Agent B with a context summary
3. Agent B receives the capsule, projected reality, and constraint state
4. On resume, Agent B gets a prompt that includes everything needed to continue safely
