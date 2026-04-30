# Runtime Identity And MCP Agent Binding

This document explains **what SyncPoint does today** for MCP identity,
and **how to use it correctly**.

It is intentionally explicit because this is easy to misunderstand.

## One Sentence

Today, a SyncPoint MCP connection **does not automatically create or
register a new agent**.

Instead, the connection either:

1. uses a **pre-bound identity** from environment variables, or
2. falls back to **explicit `agentId` parameters** in tool calls.

## What Exists Today

SyncPoint P11 added **runtime-bound identity**.

That means an MCP connection can be fixed to one agent identity by:

- `SYNCPOINT_AGENT_ID`
- `SYNCPOINT_RUNTIME_ID`

Once bound, core MCP tools can inherit that identity automatically.

## What Does Not Exist Today

These behaviors do **not** happen automatically today:

- MCP connection does **not** auto-register a new agent
- MCP connection does **not** auto-create a runtime on connect
- MCP connection does **not** auto-pick a session role like architect/executor/reviewer
- MCP connection does **not** prove identity just because provider = `copilot`

So the current model is:

```text
connect MCP
  -> optionally bind identity by env or runtime lookup
  -> query identity with syncpoint_whoami
  -> manually place that agent into sessions / roles
```

It is **not**:

```text
connect MCP
  -> auto-register agent
  -> auto-map to one existing registered agent
  -> auto-assign role
```

## Current Resolution Priority

When an MCP tool needs agent identity, SyncPoint resolves it in this order:

1. `SYNCPOINT_AGENT_ID`
2. `SYNCPOINT_RUNTIME_ID` -> look up runtime's bound agent
3. explicit tool parameter `agentId`

If bound identity and input `agentId` conflict, the call is rejected.

## Environment Variables

| Variable | Purpose |
|---|---|
| `SYNCPOINT_AGENT_ID` | Directly bind this connection to one agent |
| `SYNCPOINT_RUNTIME_ID` | Bind through a registered runtime |
| `SYNCPOINT_PROJECT_ROOT` | Workspace root for this MCP connection |
| `SYNCPOINT_DB_DIR` | Override `.syncpoint/` database directory |

## Practical Usage Model

The recommended current workflow is:

### Option A — Direct Agent Binding

Best when you already know which editor window should act as which agent.

```text
register agent in SyncPoint
  -> copy that agent ID
  -> set SYNCPOINT_AGENT_ID in the MCP config for that editor window
  -> call syncpoint_whoami to verify
  -> use the connection as that agent
```

### Option B — Runtime Binding

Best when you want to identify a physical editor window or daemon first.

```text
register runtime
  -> bind runtime to an agent
  -> set SYNCPOINT_RUNTIME_ID in the MCP config
  -> call syncpoint_whoami to verify resolved identity
  -> use the connection as that agent
```

## Recommended Current Rule

For real multi-window use, treat:

```text
one editor window / one MCP connection / one SyncPoint agent
```

Do not share one MCP connection across multiple logical agents.

## First-Time Setup

### 1. Register agents

Use CLI or any existing admin path.

Example:

```bash
node packages/syncpoint-cli/dist/main.js agent add --name copilot-architect --provider copilot --role manager
node packages/syncpoint-cli/dist/main.js agent add --name copilot-workA --provider copilot --role backend
node packages/syncpoint-cli/dist/main.js agent add --name copilot-workB --provider copilot --role backend
```

Record the printed IDs.

### 2. Choose one of the two binding models

#### Direct binding

Put the agent ID directly in MCP config:

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<architect-agent-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

#### Runtime binding

First register runtime and bind it:

- `syncpoint_runtime_register`
- `syncpoint_runtime_bind`

Then use:

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_RUNTIME_ID": "<runtime-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

## Three-Window Example

### Architect window

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<architect-agent-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

### Worker A window

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<worker-a-agent-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

### Worker B window

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<worker-b-agent-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

This is the clearest current setup because each window has a fixed identity.

## Verify Identity

In any MCP-connected window, call:

```text
syncpoint_whoami
```

Example result:

```json
{
  "bound": true,
  "agentId": "s_abc123xyz",
  "agentName": "copilot-workA",
  "provider": "copilot",
  "role": "backend",
  "runtimeId": null,
  "source": "env-agent",
  "workspaceRoot": "D:/MyProject/YourProject"
}
```

This is the correct way to answer:

```text
Which registered agent is this MCP connection acting as?
Which platform/provider is it associated with?
Which project root is it pointed at?
```

## Runtime Tools

SyncPoint now provides runtime identity tools for manual binding and inspection:

| Tool | Purpose |
|---|---|
| `syncpoint_whoami` | Show current connection identity |
| `syncpoint_runtime_register` | Register a runtime instance |
| `syncpoint_runtime_bind` | Bind one agent to one runtime |
| `syncpoint_runtime_list` | List all runtimes |
| `syncpoint_runtime_status` | Inspect one runtime and its bound agent |

## What Changes For Tool Calls

With a bound connection:

- `syncpoint_file_claim` can omit `agentId`
- `syncpoint_loop_resume` can omit `agentId`
- `syncpoint_session_next_action` can omit `agentId`
- `syncpoint_sync_ack` can omit `agentId`

If a bound connection explicitly passes a different `agentId`, SyncPoint rejects the call.

Example error:

```text
IdentityConflictError: connection is bound to agent "copilot-workA"
but tool call requested "copilot-workB". A bound connection cannot act
as a different agent.
```

## Legacy Mode

If neither `SYNCPOINT_AGENT_ID` nor `SYNCPOINT_RUNTIME_ID` is set:

- SyncPoint does not infer identity
- tools still require explicit `agentId`
- behavior stays backward-compatible

This is useful for debugging, but it is **not** the recommended model for
real multi-agent use.

## Important Limitation

Current SyncPoint identity is **binding-based**, not **auto-discovery-based**.

That means:

- the user or operator still decides which MCP connection maps to which agent
- SyncPoint does not yet auto-discover a new connection and create a pending agent record
- SyncPoint does not yet auto-link "this Copilot window" to "that registered agent" without configuration

If you want a mental model, think:

```text
today = explicit binding
future ideal = auto-discovered connection + user confirmation
```

## Recommended Operator Checklist

Before trusting a new MCP window, verify:

1. `syncpoint_whoami` returns the expected `agentId`
2. `workspaceRoot` matches the intended project
3. the session role assignment matches that agent's purpose
4. the window is not sharing identity with another logical agent

## Related Documents

- [local-operations-guide.md](local-operations-guide.md)
- [core-synchronization.md](core-synchronization.md)
- [demo-sync-truncation.md](demo-sync-truncation.md)
