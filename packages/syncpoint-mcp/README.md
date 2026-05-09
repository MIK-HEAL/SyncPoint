# syncpoint-mcp

SyncPoint MCP Server — Model Context Protocol adapter for editor AI synchronization obligations.

Exposes SyncPoint's sync state, continuation blockers, resource claims, operations, project memory, and prompt templates to any MCP-compatible editor agent (Cursor, Claude Code, VS Code, Codex, etc.) via **stdio transport**.

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

### Client Support Boundaries

MCP lets editor agents read SyncPoint state and call SyncPoint tools, but it cannot intercept native file writes before they happen.

Use `syncpoint watch <dir>` when you need fast local post-write auditing for direct edits, shell commands, generators, or git operations that bypass MCP tool calls. The watcher records file audit events and can create or update `resource_conflict` SyncGates when a claimed file is modified by the wrong agent.

For a full risk matrix, see [`../../docs/mcp-client-support.md`](../../docs/mcp-client-support.md).

### Resources (read-only, 15 total)

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
| `syncpoint://context/policy` | Supported context intents, roles, and gate policies |
| `syncpoint://context/prepare/{intent}/{role}` | Prepared context preview for a given intent and role |
| `syncpoint://session/{sessionId}` | Synchronization session detail |
| `syncpoint://review/{reviewRequestId}/packet` | Review packet with checklist, evidence, changes, gate |
| `syncpoint://active-session/{agentId}` | Active session details and next actions for an agent |
| `syncpoint://session/{sessionId}/next-action/{agentId}` | Recommended next actions for an agent in a session |

### Tools (state-mutating, 78 total)

| Group | Tools | Description |
|---|---|---|
| **Loop** (4) | `syncpoint_loop_status`, `_resume`, `_checkpoint`, `_handoff` | Agent loop lifecycle — status, resume with context policy, checkpoint, handoff |
| **Resume Context** (1) | `syncpoint_resume_context_get` | Full resume context with prompt |
| **Project Memory** (6) | `syncpoint_project_memory_search`, `_add`, `_approve`, `_export`, `_supersede`, `_version` | Search, add, approve, export, supersede, version-history |
| **Context** (2) | `syncpoint_context_prepare`, `_policy_info` | Prepare scoped context, inspect policy rules |
| **Onboarding** (2) | `syncpoint_architect_onboarding`, `syncpoint_reviewer_context` | Role-specific onboarding and review context |
| **Session** (11) | `syncpoint_session_create`, `_status`, `_assign_role`, `_plan_task`, `_accept`, `_start`, `_complete`, `_request_review`, `_start_review`, `_review_decide`, `_advance` | Full session orchestration lifecycle |
| **Review** (10) | `syncpoint_review_checklist_add`, `_checklist_update`, `_evidence_add`, `_evidence_list`, `_changes_request`, `_changes_address`, `_gate`, `_approve`, `_block`, `_packet` | Evidence-backed review workflow |
| **Playbook** (3) | `syncpoint_next_action`, `_capture_evidence`, `_active_session` | Guided next-action recommendations |
| **Wake** (8) | `syncpoint_wake_list`, `_next`, `_ack`, `_start`, `_done`, `_fail`, `_skip`, `_stats` | Sync obligation queue |
| **Resource Claim** (4) | `syncpoint_resource_claim`, `_release`, `_list`, `_conflicts` | Declare, release, list, and detect resource ownership conflicts |
| **Sync Gate** (7) | `syncpoint_sync_request`, `_ack`, `_resolve`, `_cancel`, `_status`, `_list`, `_check_agent` | Synchronization barriers |
| **Sync Transaction** (5) | `syncpoint_sync_transaction_create`, `_status`, `_approve`, `_reject`, `_resolve` | Checkpoint approval transactions |
| **Operation** (9) | `syncpoint_operation_create`, `_submit`, `_check`, `_approve`, `_reject`, `_apply`, `_cancel`, `_status`, `_list` | Tracked operations (e.g. code patches) with ownership/conflict checks |
| **Constraint** (1) | `syncpoint_constraint_check` | Read-only constraint evaluation — blockers, warnings, projection |
| **Runtime Identity** (5) | `syncpoint_whoami`, `syncpoint_runtime_register`, `_bind`, `_list`, `_status` | Connection identity and runtime management |

### Prompts (templates, 14 total)

| Prompt | Description |
|---|---|
| `syncpoint_resume` | Resume prompt with synchronization blockers and context |
| `syncpoint_checkpoint` | Guide agent to produce a structured checkpoint for sync |
| `syncpoint_handoff` | Guide agent to produce handoff context |
| `syncpoint_project_onboarding` | Onboard new agent with project memory |
| `syncpoint_memory_review` | Review all project memories for curation |
| `syncpoint_executor_resume` | Executor-specific resume with assignment and session context |
| `syncpoint_reviewer_checklist` | Reviewer checklist generation from review packet |
| `syncpoint_architect_briefing` | Architect briefing with session and project memory |
| `syncpoint_user_memory_review` | User-facing memory review for curation decisions |
| `syncpoint_architect_plan` | Architect task planning prompt |
| `syncpoint_review_task` | Reviewer context prompt |
| `syncpoint_review_with_evidence` | Full review packet prompt with evidence and gate |
| `syncpoint_session_playbook` | Role-aware session playbook with next actions |
| `syncpoint_wake_briefing` | Wake obligation briefing with context and recommendations |

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
