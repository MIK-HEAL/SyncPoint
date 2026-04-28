# syncpoint-mcp

SyncPoint MCP Server — Model Context Protocol adapter for multi-agent collaboration.

Exposes SyncPoint's collaboration state, loop operations, project memory, and prompt templates to any MCP-compatible editor agent (Cursor, Claude Code, VS Code, Codex, etc.) via **stdio transport**.

## Quick Start

```bash
# Build
pnpm -r build

# Run directly
node packages/syncpoint-mcp/dist/main.js
```

## Editor Configuration

### Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

### Claude Code

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "syncpoint": {
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "D:/MyProject/YourProject"
      }
    }
  }
}
```

### VS Code (Copilot MCP)

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "syncpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/MyProject/SyncPoint/packages/syncpoint-mcp/dist/main.js"],
      "env": {
        "SYNCPOINT_PROJECT_ROOT": "${workspaceFolder}"
      }
    }
  }
}
```

## Environment Variables

| Variable | Description |
|---|---|
| `SYNCPOINT_PROJECT_ROOT` | Set working directory for the MCP server |
| `SYNCPOINT_DB_DIR` | Override `.syncpoint/` database directory |
| `SYNCPOINT_MEMORY_PATH` | Override project-memory.md export path |

## Capabilities

### Resources (read-only, 13 total)

| URI | Description |
|---|---|
| `syncpoint://status` | Overview of agents and tasks |
| `syncpoint://agents` | All registered agents |
| `syncpoint://tasks` | All tasks |
| `syncpoint://task/{taskId}` | Task detail with checkpoints |
| `syncpoint://task/{taskId}/checkpoints` | Checkpoints for a task |
| `syncpoint://task/{taskId}/capsules` | Context capsules for a task |
| `syncpoint://task/{taskId}/resume-context/{agentId}` | Full resume context |
| `syncpoint://project-memory` | All approved project memories |
| `syncpoint://project-memory/{category}` | Memories by category |
| `syncpoint://session/{sessionId}` | Orchestration session detail |
| `syncpoint://review/{reviewRequestId}/packet` | Review packet with checklist, evidence, changes, gate |

### Tools (state-mutating, 30 total)

| Tool | Description |
|---|---|
| `syncpoint_loop_status` | Get agent/task status |
| `syncpoint_loop_resume` | Resume a task with context policy enforcement |
| `syncpoint_loop_checkpoint` | Save checkpoint + capsule |
| `syncpoint_loop_handoff` | Hand off task between agents |
| `syncpoint_resume_context_get` | Get full resume context with prompt |
| `syncpoint_project_memory_search` | Search project memories |
| `syncpoint_project_memory_add` | Add new project memory (draft) |
| `syncpoint_project_memory_approve` | Approve a draft memory |
| `syncpoint_project_memory_export` | Export to .syncpoint/project-memory.md |
| `syncpoint_session_*` | Create sessions, assign roles, plan tasks, request reviews, decide, advance |
| `syncpoint_review_*` | Checklist, evidence, change requests, approval gate, approve/block, review packet |

### Prompts (templates, 12 total)

| Prompt | Description |
|---|---|
| `syncpoint_resume` | Resume prompt for continuing a task |
| `syncpoint_checkpoint` | Guide agent to produce structured checkpoint |
| `syncpoint_handoff` | Guide agent to produce handoff context |
| `syncpoint_project_onboarding` | Onboard new agent with project memory |
| `syncpoint_memory_review` | Review all project memories for curation |
| `syncpoint_architect_plan` | Architect task planning prompt |
| `syncpoint_review_task` | Reviewer context prompt |
| `syncpoint_review_with_evidence` | Full review packet prompt with evidence and gate |

## Architecture

```
Editor Agent (Cursor/Claude/VS Code)
        │
        ▼
syncpoint-mcp (stdio)
        │
        ▼
syncpoint-server/application  ← shared use cases
        │
        ▼
syncpoint-server/repositories ← DB access
```

MCP tools delegate to the same application layer used by CLI and tRPC — no logic duplication.

## Tests

```bash
pnpm --filter syncpoint-mcp test
# resources, tools, prompts
```
