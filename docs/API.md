# SyncPoint API Reference

## Overview

SyncPoint exposes functionality through three interfaces:

1. **MCP (Model Context Protocol)** — IDE/agent integration via JSON-RPC tools and prompts
2. **CLI** — Command-line interface for direct user interaction
3. **tRPC** — HTTP-based RPC for programmatic access and the web dashboard

---

## 1. MCP Tools

All tools are prefixed with `syncpoint_`. Connection identity is resolved automatically when the transport binds the agent.

### 1.1 Resource & Conflict Management

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_resource_claim` | Declare resource ownership before editing | `taskId`, `locators`, `scope` (file/function/line_range), `mode` (exclusive/shared), `functionName`, `lineStart`/`lineEnd` |
| `syncpoint_resource_release` | Release a resource claim | `claimId` |
| `syncpoint_resource_list` | List active resource claims | `sessionId`, `status`, `actorId`, `taskId` |
| `syncpoint_resource_conflicts` | Detect conflicts for planned claims | `taskId`, `agentId`, `locators` |
| `syncpoint_conflict_list` | List all active conflicts | `sessionId`, `resourceType` |
| `syncpoint_conflict_resolve` | Resolve a conflict | `claimAId`, `claimBId`, `resolution` (release_claim_a / release_claim_b / convert_to_shared) |
| `syncpoint_conflict_suggest` | Generate resolution suggestions | `locator`, `sessionId` |

### 1.2 Constraint Enforcement

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_constraint_list` | List active constraint rules | `sessionId` |
| `syncpoint_constraint_check` | Check a file against constraints | `locator`, `sessionId` |
| `syncpoint_preflight` | Full pre-modification safety check | `locators` (comma-separated), `agentId`, `taskId` |

### 1.3 Sync Gates

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_sync_request` | Request synchronization | `agentIds` (comma-separated), `reason`, `sessionId` |
| `syncpoint_sync_ack` | Acknowledge a sync gate | `gateId` |
| `syncpoint_sync_resolve` | Resolve and close a gate | `gateId` |
| `syncpoint_sync_cancel` | Cancel a gate | `gateId` |
| `syncpoint_sync_status` | Get gate status | `gateId` |
| `syncpoint_sync_vote` | Vote on a gate resolution | `gateId`, `vote` (approve/reject) |
| `syncpoint_sync_list` | List sync gates | `sessionId`, `status` |
| `syncpoint_sync_check_agent` | Check agent gate obligations | `sessionId`, `agentId` |

### 1.4 Checkpoint & Review

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_checkpoint_review_create` | Create review for a checkpoint | `taskId`, `agentId`, `summary`, `progress`, `nextSteps`, `risks` |
| `syncpoint_checkpoint_review_status` | Get review status | `reviewRequestId` |
| `syncpoint_checkpoint_review_approve` | Approve a checkpoint review | `reviewRequestId`, `comment` |
| `syncpoint_checkpoint_review_reject` | Reject a checkpoint review | `reviewRequestId`, `reason` |
| `syncpoint_checkpoint_review_resolve` | Resolve review (approve+resolve) | `reviewRequestId` |

### 1.5 Session Management

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_session_create` | Create a new sync session | `title`, `description`, `agentIds` |
| `syncpoint_session_status` | Get session status | `sessionId` |
| `syncpoint_session_assign_role` | Assign an agent role | `sessionId`, `agentId`, `role` |
| `syncpoint_session_plan_task` | Plan a task in session | `sessionId`, `taskId`, `agentId` |
| `syncpoint_session_accept` | Accept a task assignment | `sessionId`, `taskId`, `agentId` |
| `syncpoint_session_start` | Start the session | `sessionId` |
| `syncpoint_session_complete` | Complete the session | `sessionId` |
| `syncpoint_session_request_review` | Request a review | `sessionId`, `taskId`, `reviewerAgentId` |
| `syncpoint_session_start_review` | Start reviewing | `sessionId`, `reviewRequestId` |
| `syncpoint_session_review_decide` | Approve or block | `sessionId`, `reviewRequestId`, `decision` (approve/block), `comment` |
| `syncpoint_session_advance` | Advance session state | `sessionId` |

### 1.6 Review Workflow

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_review_checklist_add` | Add a checklist item | `reviewRequestId`, `title`, `required` |
| `syncpoint_review_checklist_update` | Update checklist status | `reviewRequestId`, `itemId`, `status` |
| `syncpoint_review_evidence_add` | Add evidence | `reviewRequestId`, `kind`, `title`, `content` |
| `syncpoint_review_evidence_list` | List evidence | `reviewRequestId` |
| `syncpoint_review_changes_request` | Request changes | `reviewRequestId`, `summary`, `detail` |
| `syncpoint_review_changes_address` | Address change requests | `reviewRequestId`, `action` |
| `syncpoint_review_gate` | Check review gate status | `reviewRequestId` |
| `syncpoint_review_approve` | Approve review | `reviewRequestId`, `comment` |
| `syncpoint_review_block` | Block review | `reviewRequestId`, `reason` |
| `syncpoint_review_packet` | Get full review packet | `reviewRequestId` |

### 1.7 Write Guard

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_write_check` | Check write permission | `locator`, `agentId`, `content` |
| `syncpoint_write_prepare` | Prepare a write (lock) | `locator`, `agentId` |
| `syncpoint_write_apply` | Apply a prepared write | `locator`, `agentId` |
| `syncpoint_guard_status` | Get guard status | `agentId` |
| `syncpoint_guard_session_create` | Create guard session | `agents` (comma-separated) |
| `syncpoint_guard_reconcile` | Reconcile guard state | `sessionId` |

### 1.8 Loop & Context

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_loop_status` | Get loop status | `taskId`, `agentId` |
| `syncpoint_loop_resume` | Resume a task loop | `taskId`, `agentId` |
| `syncpoint_loop_checkpoint` | Save checkpoint in loop | `taskId`, `agentId`, `summary`, `progress`, `nextSteps`, `needSync` |
| `syncpoint_loop_handoff` | Handoff task to another agent | `taskId`, `fromAgentId`, `toAgentId`, `context` |
| `syncpoint_resume_context_get` | Get resume context | `taskId`, `agentId` |

### 1.9 Project Memory

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_project_memory_search` | Search project memories | `query`, `status` |
| `syncpoint_project_memory_add` | Add a project memory | `title`, `content`, `type`, `tags` |
| `syncpoint_project_memory_approve` | Approve a draft memory | `id` |
| `syncpoint_project_memory_export` | Export memories to file | — |
| `syncpoint_project_memory_supersede` | Supersede an old memory | `id`, `newContent` |
| `syncpoint_project_memory_version` | Get memory version history | `id` |

### 1.10 Context & Onboarding

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_context_prepare` | Prepare context for agent | `intent`, `role`, `taskId`, `agentId` |
| `syncpoint_context_policy_info` | Get context policy info | `taskId` |
| `syncpoint_architect_onboarding` | Onboard architect agent | `sessionId` |
| `syncpoint_reviewer_context` | Get reviewer context | `taskId`, `agentId` |

### 1.11 Agent Messaging

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_message_send` | Send a message to an agent | `toAgentId`, `subject`, `body`, `taskId` |
| `syncpoint_message_list` | List messages | `agentId`, `status` (unread/all) |
| `syncpoint_message_read` | Mark message as read | `messageId` |
| `syncpoint_message_reply` | Reply to a message | `messageId`, `body` |
| `syncpoint_message_thread` | Get message thread | `threadRootId` |

### 1.12 Operations (Transaction Management)

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_operation_create` | Create an operation | `type`, `locator`, `content` |
| `syncpoint_operation_submit` | Submit for approval | `operationId` |
| `syncpoint_operation_check` | Check operation constraints | `operationId` |
| `syncpoint_operation_approve` | Approve operation | `operationId` |
| `syncpoint_operation_reject` | Reject operation | `operationId`, `reason` |
| `syncpoint_operation_apply` | Apply approved operation | `operationId` |
| `syncpoint_operation_cancel` | Cancel operation | `operationId` |
| `syncpoint_operation_status` | Get operation status | `operationId` |
| `syncpoint_operation_list` | List operations | `sessionId`, `status` |

### 1.13 Wake System

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_wake_list` | List pending wakes | `sessionId`, `status` |
| `syncpoint_wake_next` | Get next wake request | `agentId` |
| `syncpoint_wake_ack` | Acknowledge wake | `wakeId` |
| `syncpoint_wake_start` | Start executing wake | `wakeId` |
| `syncpoint_wake_done` | Complete wake | `wakeId`, `resultSummary` |
| `syncpoint_wake_fail` | Report wake failure | `wakeId`, `reason` |
| `syncpoint_wake_skip` | Skip wake | `wakeId`, `reason` |
| `syncpoint_wake_stats` | Get wake statistics | `agentId` |

### 1.14 Playbook & Next Actions

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_next_action` | Get recommended next action | `sessionId`, `agentId` |
| `syncpoint_capture_evidence` | Capture evidence | `source`, `content` |
| `syncpoint_active_session` | Get active session info | `sessionId` |

### 1.15 Runtime & Identity

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_whoami` | Confirm agent identity | — |
| `syncpoint_runtime_register` | Register an agent runtime | `name`, `provider`, `profile` |
| `syncpoint_runtime_bind` | Bind to an agent identity | `agentId` |
| `syncpoint_runtime_list` | List runtime agents | — |
| `syncpoint_runtime_status` | Get runtime status | — |

### 1.16 History

| Tool | Description | Key Parameters |
|------|-------------|---------------|
| `syncpoint_history` | Query operation history | `agentId`, `taskId`, `eventType`, `limit` |

---

## 2. MCP Prompts

| Prompt | Description | Key Args |
|--------|-------------|----------|
| `syncpoint_resume` | Generate task resume prompt | `taskId`, `agentId` |
| `syncpoint_checkpoint` | Guide agent to produce a checkpoint | `taskId`, `agentId` |
| `syncpoint_handoff` | Guide agent handoff | `taskId`, `fromAgentId`, `toAgentId` |
| `syncpoint_project_onboarding` | Onboard new agent with project knowledge | `taskId`, `agentId` |
| `syncpoint_memory_review` | Review all project memories | — |
| `syncpoint_executor_resume` | Executor resume prompt | `taskId`, `agentId` |
| `syncpoint_reviewer_checklist` | Reviewer checklist prompt | `taskId`, `agentId` |
| `syncpoint_architect_briefing` | Architect briefing | — |
| `syncpoint_user_memory_review` | Memory review by status | — |
| `syncpoint_architect_plan` | Architect planning with session data | `sessionId` |
| `syncpoint_review_task` | Task review prompt | `taskId`, `agentId` |
| `syncpoint_review_with_evidence` | Review with full evidence packet | `reviewRequestId` |
| `syncpoint_session_playbook` | Role-specific sync playbook | `sessionId`, `agentId` |
| `syncpoint_wake_briefing` | Wake briefing for sync obligations | `agentId` |
| `syncpoint_conflict_resolution` | Smart conflict resolution suggestions | `taskId`, `agentId`, `locator` |
| `syncpoint_context_aware_check` | Task-aware pre-edit safety check | `taskId`, `agentId`, `plannedFiles` |

---

## 3. CLI Commands

### Root Commands

| Command | Description |
|---------|-------------|
| `syncpoint init [dir]` | Initialize SyncPoint in a directory with team templates |
| `syncpoint server start` | Start the SyncPoint server |
| `syncpoint status` | Show synchronization state (who is blocked, why, action) |
| `syncpoint claim <locators>` | Declare resource ownership |
| `syncpoint release` | Release resource claims (by ID or --all --agent) |
| `syncpoint resume` | Resume work from latest checkpoint |
| `syncpoint checkpoint` | Save progress as a checkpoint |
| `syncpoint wake` | Check or acknowledge pending wake requests |
| `syncpoint snapshot-gc` | Garbage-collect old context snapshots |

### Admin Commands

| Command | Description |
|---------|-------------|
| `syncpoint uninstall` | Clean up `.syncpoint/` and restore file permissions |
| `syncpoint export` | Export sync state as JSON/YAML |
| `syncpoint import <file>` | Import sync state from export |
| `syncpoint history` | View operation history with filters |
| `syncpoint doctor` | Diagnose database integrity, disk usage, connection |

### Session Commands

| Command | Description |
|---------|-------------|
| `syncpoint session create` | Create a sync session |
| `syncpoint session status` | Get session status |
| `syncpoint session assign-role` | Assign agent role |
| `syncpoint session plan` | Plan a task |
| `syncpoint session accept` | Accept a task |
| `syncpoint session start` | Start session |
| `syncpoint session complete` | Complete session |
| `syncpoint session review` | Request review |
| `syncpoint session start-review` | Start reviewing |
| `syncpoint session decide` | Approve or block |
| `syncpoint session advance` | Advance session |

### Review Commands

| Command | Description |
|---------|-------------|
| `syncpoint review checklist-add` | Add checklist item |
| `syncpoint review checklist-list` | List checklist items |
| `syncpoint review checklist-pass` | Pass a checklist item |
| `syncpoint review checklist-fail` | Fail a checklist item |
| `syncpoint review evidence-add` | Add evidence |
| `syncpoint review evidence-list` | List evidence |
| `syncpoint review changes-request` | Request changes |
| `syncpoint review changes-address` | Address change requests |
| `syncpoint review gate` | Check gate status |
| `syncpoint review approve` | Approve review |
| `syncpoint review block` | Block review |
| `syncpoint review packet` | Get review packet |

### Sync Gate Commands

| Command | Description |
|---------|-------------|
| `syncpoint sync request` | Request sync gate |
| `syncpoint sync ack` | Acknowledge gate |
| `syncpoint sync resolve` | Resolve gate |
| `syncpoint sync cancel` | Cancel gate |
| `syncpoint sync status` | Gate status |
| `syncpoint sync vote` | Vote on resolution |
| `syncpoint tx create` | Create transaction |
| `syncpoint tx status` | Transaction status |
| `syncpoint tx approve` | Approve transaction |
| `syncpoint tx reject` | Reject transaction |
| `syncpoint tx resolve` | Resolve transaction |
| `syncpoint tx list` | List transactions |

### Other Commands

| Command | Description |
|---------|-------------|
| `syncpoint agent` | Agent management |
| `syncpoint team` | Team template management |
| `syncpoint task` | Task management (create, list, status) |
| `syncpoint context` | Context snapshot management |
| `syncpoint snapshot` | Snapshot list/export |
| `syncpoint resume-context` | Get resume context |
| `syncpoint resume-prompt` | Generate resume prompt |
| `syncpoint prompt-file` | Generate snapshot file |
| `syncpoint memory` | Project memory management |
| `syncpoint knowledge` | Project knowledge management |
| `syncpoint constraint` | Constraint management (check, add, list) |
| `syncpoint write check` | Check write permission |
| `syncpoint write prepare` | Prepare file write |
| `syncpoint write apply` | Apply prepared write |
| `syncpoint guard status` | Guard status |
| `syncpoint guard session` | Guard session management |
| `syncpoint guard mount` | Mount guard |
| `syncpoint guard reconcile` | Reconcile guard state |
| `syncpoint guard unlock` | Unlock all guards |
| `syncpoint loop` | Loop management |
| `syncpoint adapter` | Adapter management |
| `syncpoint playbook` | Playbook management |
| `syncpoint connect` | Connection management |
| `syncpoint watch` | File watcher management |
| `syncpoint demo` | Demo scenarios (MVP, conflict, resource) |
| `syncpoint dev` | Dev tools (status, tail, reset, integrity, recover) |
| `syncpoint send` | Send agent message |
| `syncpoint list` | List agent messages |
| `syncpoint read <id>` | Read agent message |
| `syncpoint reply <id>` | Reply to agent message |
| `syncpoint thread <id>` | View message thread |
| `syncpoint propose` | Propose an operation |
| `syncpoint submit` | Submit an operation |
| `syncpoint op-check` | Check operation |
| `syncpoint op-approve` | Approve operation |
| `syncpoint op-reject` | Reject operation |
| `syncpoint op-apply` | Apply operation |
| `syncpoint op-cancel` | Cancel operation |
| `syncpoint op-status` | Operation status |
| `syncpoint op-list` | List operations |
| `syncpoint contract` | Contract management |
| `syncpoint handoff` | Task handoff |
| `syncpoint report` | Generate reports |

### Common Flags

All commands support `--json` for machine-readable output.

---

## 4. tRPC Routers

### Router List

| Router | File | Purpose |
|--------|------|---------|
| Agent Router | `agent-router.ts` | Agent CRUD and query |
| Agent Registry | `agent-registry-router.ts` | Runtime agent registry |
| Agent Manifest | `agent-manifest-router.ts` | Agent manifest management |
| Agent Registration | `agent-registration-router.ts` | Agent file-based registration |
| Agent Message | `agent-message-router.ts` | Inter-agent messaging |
| Checkpoint | `checkpoint-router.ts` | Checkpoint CRUD |
| Checkpoint Review | `checkpoint-review-router.ts` | Review workflow |
| Constraint | `constraint-router.ts` | Constraint CRUD and evaluation |
| Context | `context-router.ts` | Context preparation and policy |
| Context Snapshot | `context-snapshot-router.ts` | Snapshot CRUD |
| Contract | `contract-router.ts` | Agent contract management |
| File Audit | `file-audit-router.ts` | File change auditing |
| Guard | `guard-router.ts` | Write guard management |
| Handoff | `handoff-router.ts` | Task handoff management |
| Loop | `loop-router.ts` | Loop/checkpoint/resume |
| Memory | `memory-router.ts` | Project memory queries |
| Negotiation | `negotiation-router.ts` | Conflict negotiation |
| Project Memory | `project-memory-router.ts` | Memory CRUD |
| Sync Gate | `sync-gate-router.ts` | Gate lifecycle |
| Sync Status | `sync-status-router.ts` | Aggregated status |
| Task | `task-router.ts` | Task management |
| Wake | `wake-router.ts` | Wake request management |
| Write | `write-router.ts` | Write operation management |

Each tRPC router exposes procedures for its domain. Access is via HTTP on the server port (default: 8765) at the `/trpc/{router}.{procedure}` endpoint.

---

## 5. Error Handling

### Error Codes

| Code | Meaning |
|------|---------|
| `RESOURCE_CONFLICT` | Another agent holds an incompatible claim |
| `CONSTRAINT_VIOLATION` | Action violates a do_not_touch or similar constraint |
| `UNAUTHORIZED` | Missing or invalid agent token |
| `FORBIDDEN` | Agent lacks permission for this action |
| `INVALID_STATE_TRANSITION` | Action not allowed from current state |
| `VALIDATION_ERROR` | Invalid input parameters |
| `OPERATION_TIMEOUT` | Operation exceeded time limit |
| `DATABASE_ERROR` | Database integrity or access failure |
| `NOT_FOUND` | Referenced entity does not exist |
| `INTERNAL_ERROR` | Unexpected internal failure |

All errors return a structured response:

```json
{
  "error": {
    "code": "RESOURCE_CONFLICT",
    "message": "src/auth.ts is exclusively claimed by agent-2 (task: auth-refactor)",
    "suggestion": "Try narrowing your claim scope to function-level or wait for release.",
    "details": {}
  }
}
```

---

## 6. Events (SSE)

The server emits Server-Sent Events at `GET /sse?sessionId=<id>`. Each event has:

| Field | Description |
|-------|-------------|
| `type` | Event type (e.g., `RESOURCE_CLAIMED`, `SYNC_GATE_CREATED`, `CHECKPOINT_SAVED`) |
| `entityType` | Affected entity type |
| `entityId` | Affected entity ID |
| `timestamp` | ISO 8601 timestamp |
| `detail` | Human-readable description |
| `sequence` | Monotonic sequence number for replay |

### Event Types

| Type | Trigger |
|------|---------|
| `RESOURCE_CLAIMED` | Agent claims a resource |
| `RESOURCE_RELEASED` | Agent releases a resource |
| `CONFLICT_DETECTED` | Two claims overlap |
| `CONFLICT_RESOLVED` | Conflict is resolved |
| `SYNC_GATE_CREATED` | New sync gate opened |
| `SYNC_GATE_ACKNOWLEDGED` | Agent acknowledges gate |
| `SYNC_GATE_RESOLVED` | Gate is resolved |
| `CHECKPOINT_CREATED` | Agent saves a checkpoint |
| `CHECKPOINT_REVIEW_REQUESTED` | Review requested |
| `CHECKPOINT_REVIEW_APPROVED` | Review approved |
| `CHECKPOINT_REVIEW_REJECTED` | Review rejected |
| `AGENT_CONNECTED` | Agent connects |
| `AGENT_DISCONNECTED` | Agent disconnects |
| `WAKE_REQUESTED` | Wake request queued |
| `WAKE_ACKNOWLEDGED` | Wake acknowledged |
