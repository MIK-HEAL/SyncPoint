# Demo: Synchronization Truncation

This demo shows SyncPoint's core value in 10-15 minutes:

```text
Two editor AI agents touch the same file.
SyncPoint detects the conflict.
The blocked agent cannot continue.
A checkpoint transaction is approved.
Ownership is transferred.
A `code_patch` operation is checked, approved, and applied.
Sync View shows the whole state.
```

Use this demo when explaining why SyncPoint is not a normal orchestration tool. The point is not that agents receive tasks. The point is that SyncPoint stops unsafe continuation until the synchronization boundary is resolved.

## What You Will See

| Primitive | Demo evidence |
|---|---|
| Resource Claim | Agent A and Agent B both claim `src/shared-config.ts` as a `file` resource |
| SyncGate | A hard resource-conflict gate is created automatically |
| Sync Transaction | Agent A's checkpoint becomes an approval transaction bound to a gate |
| Operation | Agent B submits a `code_patch` operation after ownership transfer |
| Wake | Session and assignment events create visible sync obligations |
| Sync View | Claims, blockers, operations, and wake queue appear in one view |

## Prerequisites

From the SyncPoint repository:

```bash
pnpm install
pnpm build
```

The script imports built workspace packages, so run `pnpm build` before the demo.

## Flow Diagram

```text
Agent A                         SyncPoint                         Agent B
  |                                |                                |
  | claim src/shared-config.ts     |                                |
  |------------------------------->| ResourceClaim ACTIVE           |
  | start assignment               |                                |
  |------------------------------->| allowed                        |
  |                                |                                |
  |                                |<-------------------------------| claim same file
  |                                | hard conflict detected          |
  |                                | SyncGate: resource_conflict     |
  |                                |------------------------------->| start is blocked
  |                                |                                |
  | checkpoint needSync            |                                |
  |------------------------------->| SyncTransaction WAITING_APPROVAL|
  |                                | SyncGate: checkpoint_required   |
  |                                |                                |
  |                                |<-------------------------------| approve transaction
  | release claim                  |                                |
  |------------------------------->| resource gate READY_TO_CONTINUE |
  |                                | tx gate READY_TO_CONTINUE       |
  |                                |                                |
  |                                |<-------------------------------| submit code_patch operation
  | review / approve operation     | Operation APPROVED/APPLIED      |
```

## Stage 1: Create The Blocked State

Run from the SyncPoint repository root:

```bash
node scripts/demo-sync-flow.mjs --stage blocked
```

The script creates a dedicated demo project under `.tmp/` and prints the project path.

Expected output includes:

- **Project**: path to the isolated demo workspace
- **Session**: sync session ID
- **Agent A / Agent B**: the two participant IDs
- **Claim A / Claim B**: overlapping file resource claim IDs
- **Resource conflict gate**: auto-created gate from the overlap
- **Checkpoint**: Agent A checkpoint ID
- **Sync transaction**: checkpoint approval transaction ID
- **Transaction gate**: bound gate for checkpoint approval
- **Blocked start error**: proof that Agent B could not start through SyncPoint

The blocked error should look like:

```text
Agent blocked by sync gate(s): <gateId>. Acknowledge before starting work.
```

## Stage 1 Inspection

Run the printed commands from the demo project folder:

```bash
syncpoint sync status --session <sessionId>
syncpoint sync status --session <sessionId> --agent <agentBId>
syncpoint patch list --session <sessionId>
```

You should see:

| Check | Expected state |
|---|---|
| Sync gates | At least two active gates |
| Resource conflict gate | `SYNC_REQUESTED`, reason `resource_conflict` |
| Transaction gate | `SYNC_REQUESTED`, reason `checkpoint_required` |
| Agent B block check | `Blocked: yes` |
| Operations | none yet |

## Stage 1 Sync View

Start the server from the demo project folder printed by the script:

```bash
syncpoint server start --port 8765
```

Open VS Code with the SyncPoint extension and inspect **Sync View**.

Expected visual state:

| Sync View section | What to verify |
|---|---|
| Sync Status | Shows blocker count greater than zero |
| Sessions | Shows the `peer-contract` demo session |
| Active Work | Agent A in progress; Agent B accepted/blocked |
| Resource Ownership | Two active claims on `src/shared-config.ts` |
| Blockers | Resource-conflict gate and checkpoint transaction gate |
| Wake Queue | Sync obligations created from session/assignment events |
| Operations | Empty before Stage 2 |

This is the key moment of the demo: Agent B has work assigned, but SyncPoint truncates continuation because the resource boundary is unsafe.

## Stage 2: Resolve And Apply The Operation

Run from the SyncPoint repository root, using the project path printed in Stage 1:

```bash
node scripts/demo-sync-flow.mjs --stage resolve --project <printed-demo-project>
```

The script performs the resolution path:

1. Agent A acknowledges the resource conflict gate.
2. Agent B acknowledges the resource conflict gate.
3. The resource conflict gate is resolved.
4. Agent A's claim is released.
5. Agent B approves Agent A's checkpoint transaction.
6. The transaction is resolved and releases its bound gate.
7. Agent B starts work successfully.
8. Agent B submits a `code_patch` operation touching `src/shared-config.ts`.
9. Operation checks pass because Agent B now owns the file.
10. Agent A approves the operation.
11. The operation is marked applied.

## Stage 2 Inspection

Run from the demo project folder:

```bash
syncpoint sync status --session <sessionId>
syncpoint sync status --session <sessionId> --agent <agentBId>
syncpoint patch list --session <sessionId>
syncpoint patch status --id <operationId>
```

Expected state:

| Check | Expected state |
|---|---|
| Active gates | none |
| Agent B block check | `Blocked: no` |
| Resource claims | Agent A released; Agent B remains active |
| Operation | `APPLIED` |
| Operation checks | all passed |

The demo project file should now contain:

```ts
export const syncMode = "protocol-gated";
export const owner = "agent-b";
```

## One-Command Full Run

If you only want terminal output and do not need to pause at the blocked Sync View moment:

```bash
node scripts/demo-sync-flow.mjs --stage all
```

For product demos, prefer the two-stage flow because Stage 1 is where synchronization truncation is visible.

## Manual CLI Equivalents

The facade CLI can claim file resources directly with `syncpoint claim`, and MCP exposes the same flow through `syncpoint_resource_claim`. The demo script creates claims directly through the same application services used by CLI and MCP so it can set up the exact blocked state deterministically.

The manually visible CLI parts are:

```bash
syncpoint sync status --session <sessionId>
syncpoint sync ack --gate <resourceConflictGateId> --agent <agentAId>
syncpoint sync ack --gate <resourceConflictGateId> --agent <agentBId>
syncpoint sync resolve --gate <resourceConflictGateId> --summary "Ownership transferred."

syncpoint sync tx approve --tx <syncTransactionId> --agent <agentBId>
syncpoint sync tx resolve --tx <syncTransactionId> --summary "Checkpoint accepted."

syncpoint patch status --id <operationId>
syncpoint patch list --session <sessionId>
```

For editor-agent operation, use MCP:

```text
syncpoint_resource_claim {
  "agentId": "<agentId>",
  "taskId": "<taskId>",
  "sessionId": "<sessionId>",
  "type": "file",
  "locators": "src/shared-config.ts",
  "mode": "exclusive"
}
```

## Demo Script Files

The script creates:

| File | Purpose |
|---|---|
| `.tmp/syncpoint-demo-*/.syncpoint/syncpoint.db` | Isolated local SyncPoint state |
| `.tmp/syncpoint-demo-*/.syncpoint/demo-sync-flow.json` | IDs needed by Stage 2 |
| `.tmp/syncpoint-demo-*/src/shared-config.ts` | Demo file touched by both agents |
| `.tmp/syncpoint-demo-*/agent-b.patch` | Unified diff represented by the `code_patch` operation |

The `.tmp/` directory is ignored by Git.

## What To Say In A 60-Second Demo

Use this script:

```text
SyncPoint is not an agent runner. It is a synchronization protocol layer.
Here Agent B has a task, but it cannot start because it claimed the same file as Agent A.
The conflict became a SyncGate, so continuation is truncated.
Agent A then checkpoints, and that checkpoint becomes a Sync Transaction with its own gate.
Only after the conflict is acknowledged, the checkpoint is approved, and ownership is transferred can Agent B continue.
Then Agent B's operation is checked against claims before approval and application.
Sync View shows the state: claims, blockers, operation, and wake obligations.
```

## Troubleshooting

### `Cannot find package 'syncpoint-server'`

Run the script from the SyncPoint repository root after building:

```bash
pnpm build
node scripts/demo-sync-flow.mjs --stage blocked
```

### Sync View is empty

Confirm the server is started from the printed demo project folder and uses the same local `.syncpoint/` database:

```bash
syncpoint server start --port 8765
```

### Operation checks fail

The most common cause is that Agent A's claim was not released before submitting Agent B's operation. Re-run Stage 2 from the original Stage 1 project path.

### Stage 2 cannot find metadata

Use the exact project path printed by Stage 1:

```bash
node scripts/demo-sync-flow.mjs --stage resolve --project <printed-demo-project>
```
