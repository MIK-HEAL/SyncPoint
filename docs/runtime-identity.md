# Runtime Identity And MCP Agent Binding

This document explains **what SyncPoint does today** for MCP identity,
and **how to use it correctly**.

It is intentionally explicit because this is easy to misunderstand.

## One Sentence

A raw SyncPoint MCP server process **does not automatically choose an agent identity**.

Use `syncpoint setup` or `syncpoint connect` to create the agent, create the
runtime, bind them, and generate the MCP config before the editor connects.

After that, the MCP connection either:

1. uses the generated **bound identity** from environment variables, or
2. falls back to explicit `agentId` parameters in legacy/manual tool calls.

## What Exists Today

SyncPoint supports **runtime-bound identity** and now has CLI commands that
prepare the binding for you.

Recommended commands:

| Command | Purpose |
|---|---|
| `syncpoint setup` | Initialize the project, create default agents, bind runtimes, and print MCP configs |
| `syncpoint connect` | Register or reconnect one agent window and print its MCP config |
| `syncpoint doctor` | Check database, agents, runtimes, bindings, and MCP server build output |

The generated MCP config fixes one editor window to one agent identity using:

- `SYNCPOINT_AGENT_ID`
- `SYNCPOINT_RUNTIME_ID`
- `SYNCPOINT_PROJECT_ROOT`

Once bound, core MCP tools can inherit that identity automatically.

## What Does Not Exist Today

These behaviors do **not** happen automatically just by launching the MCP server:

- raw MCP connection does **not** auto-register a new agent
- raw MCP connection does **not** auto-create a runtime on connect
- MCP connection does **not** auto-pick a session role like architect/executor/reviewer
- MCP connection does **not** prove identity just because provider = `copilot`

So the recommended model is:

```text
syncpoint setup/connect
  -> creates agent + runtime binding
  -> prints MCP config
  -> paste config into editor
  -> connect MCP
  -> verify identity with syncpoint_whoami
  -> place that agent into sessions / roles
```

It is **not**:

```text
start raw MCP process
  -> auto-discover this editor window
  -> auto-map it to one existing registered agent
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

The recommended current workflow is CLI-generated binding.

### Option A — Project Setup

Best when setting up multiple editor windows for one project.

```bash
syncpoint setup --agents 3 --editor cursor
```

This initializes `.syncpoint/`, creates default agents, creates and binds
runtimes, and prints one MCP config per editor window.

### Option B — Single Window Connect

Best when adding or reconnecting one editor window.

```bash
syncpoint connect --name architect --provider cursor --role manager --editor cursor
syncpoint connect --name executor-a --provider cursor --role backend --editor cursor
syncpoint connect --name reviewer --provider cursor --role reviewer --editor cursor
```

`connect` is idempotent by agent name. If the agent already exists, it reuses
that agent and generates the config again.

### Option C — Manual Direct Binding Fallback

Use this only when you need low-level control.

```text
register agent in SyncPoint
  -> copy that agent ID
  -> set SYNCPOINT_AGENT_ID in the MCP config for that editor window
  -> call syncpoint_whoami to verify
  -> use the connection as that agent
```

### Option D — Manual Runtime Binding Fallback

Use this only when you want to register the physical runtime separately.

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

### 1. Generate agent connections

```bash
syncpoint setup --agents 3 --editor cursor
```

Or generate each window separately:

```bash
syncpoint connect --name architect --provider cursor --role manager --editor cursor
syncpoint connect --name executor-a --provider cursor --role backend --editor cursor
syncpoint connect --name executor-b --provider cursor --role backend --editor cursor
```

Each command prints a ready-to-paste MCP config. The generated config includes
`SYNCPOINT_AGENT_ID`, `SYNCPOINT_RUNTIME_ID`, and `SYNCPOINT_PROJECT_ROOT`.

### 2. Paste MCP configs

Paste each generated config into the corresponding editor window's MCP settings.
Then restart or reload the MCP connection in that editor.

Cursor-style generated config:

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<agent-id>",
        "SYNCPOINT_RUNTIME_ID": "<runtime-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

VS Code-style generated config:

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<agent-id>",
        "SYNCPOINT_RUNTIME_ID": "<runtime-id>",
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

### 3. Verify health and identity

From the project root:

```bash
syncpoint doctor
```

In each MCP-connected editor window, call:

```text
syncpoint_whoami
```

## Three-Window Example

Run:

```bash
syncpoint connect --name architect --provider cursor --role manager --editor cursor
syncpoint connect --name executor-a --provider cursor --role backend --editor cursor
syncpoint connect --name executor-b --provider cursor --role backend --editor cursor
```

Then paste each printed config into one editor window:

| Window | Agent name | Agent role | Config source |
|---|---|---|---|
| Architect window | `architect` | `manager` | output from first `connect` command |
| Executor A window | `executor-a` | `backend` | output from second `connect` command |
| Executor B window | `executor-b` | `backend` | output from third `connect` command |

Each generated config should contain a different `SYNCPOINT_AGENT_ID` and
`SYNCPOINT_RUNTIME_ID`.

After the editor MCP connections restart, verify each window:

```text
syncpoint_whoami
```

The expected result is that each window reports its own agent name and runtime.

## Manual Fallback Examples

### Direct agent binding

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_AGENT_ID": "<agent-id>",
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

### Runtime binding

First register and bind runtime manually with MCP tools:

- `syncpoint_runtime_register`
- `syncpoint_runtime_bind`

Then configure the editor with the runtime ID:

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

Manual fallback is useful for debugging, but `syncpoint connect` is the safer
default because it creates the agent, creates the runtime, binds them, and prints
the correct env together.

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
  "agentName": "executor-a",
  "provider": "cursor",
  "role": "backend",
  "runtimeId": "s_runtime123",
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

SyncPoint provides runtime identity tools for manual binding and inspection:

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
IdentityConflictError: connection is bound to agent "executor-a"
but tool call requested "executor-b". A bound connection cannot act
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
- `syncpoint setup` and `syncpoint connect` prepare the binding, but the editor still needs the generated MCP config
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
