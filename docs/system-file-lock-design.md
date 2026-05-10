# System-Level File Lock Design

SyncPoint already blocks unsafe agent continuation through claims, gates,
operations, wake, and constraint runtime checks. That is a protocol lock: it
stops cooperating agents at SyncPoint entry points.

System-level file locking is a separate enforcement plane. Its job is to stop
unsafe writes before bytes reach protected project files, including writes from
editors, tools, shell commands, generators, and git operations when they run
inside a guarded workspace.

## Goal

Provide a hard file-write boundary for protected project roots:

```text
write attempt
  -> identify actor and target resources
  -> ask SyncPoint for a write permit
  -> allow, deny, or stage the write
  -> record the decision
  -> keep protocol blockers and filesystem reality consistent
```

The design is intentionally layered. It upgrades SyncPoint from protocol-level
blocking into file-write blocking in three product stages:

1. **Controlled writes**: SyncPoint owns writes routed through API, CLI, MCP,
   SDK, or plugins.
2. **Editor hard-save**: supported editor saves must obtain a SyncPoint permit
   before mutating protected files.
3. **Guarded workspace**: normal native tools write through a mounted or
   projected workspace whose file operations are permit-checked.

L0 audit remains useful for current projects. L1 gives cooperating agents real
pre-write blocking. L2 makes editor workflows permit-backed. L3 is where
SyncPoint can enforce native file writes from shell tools, formatters,
generators, and git when they operate inside the guarded workspace.

## Non-Goals

- Kernel-level enforcement in the first implementation.
- Blocking writes outside explicitly mounted or guarded project roots.
- Replacing resource claims, SyncGates, operations, or reviews.
- Making advisory MCP clients magically intercept native filesystem writes.
- Trusting prompt instructions as a security boundary.

## Enforcement Levels

| Level | Name | Blocks what | Bypasses | Ship value |
|---|---|---|---|---|
| L0 | Audit only | Nothing before write | Everything native | Current `syncpoint watch` and VS Code audit |
| L1 | Controlled write API | Writes routed through SyncPoint SDK, CLI, MCP, or plugins | Raw editor save, shell, git, tools | Strong for cooperating agents |
| L2 | Editor hard-save guard | Supported editor saves | Shell, git, external processes | Strong for human/editor workflows |
| L3 | Workspace file proxy | Writes inside a mounted or projected workspace | Direct writes to the backing store, privileged bypass | Strong local system boundary |
| L4 | OS policy driver | Native writes at kernel or minifilter layer | Admin/root override, unsupported platforms | Strongest, highest cost |

The recommended roadmap is **L1 -> L2 -> L3**: first make SyncPoint the write
path, then make supported editor saves use that path, then put ordinary native
tools inside a guarded workspace. L4 is only justified if SyncPoint must protect
arbitrary native paths without requiring a guarded workspace mount.

## Core Invariant

A protected file may be modified only when SyncPoint has issued a valid write
permit for the actor, resource, operation, and content transition.

```text
No permit, no write.
Expired permit, no write.
Permit for another actor/resource, no write.
Permit rejected by a new gate or constraint, no write.
```

The permit is separate from awareness. Acknowledging a gate is not enough:
`SYNC_ACKED` still blocks. Only `READY_TO_CONTINUE` or `CANCELLED` can release
the file-write boundary for the affected resources.

## Actors

Every guarded write must resolve an actor.

| Source | Actor resolution |
|---|---|
| SyncPoint CLI / SDK / MCP | Explicit `actorId`, `taskId`, optional `sessionId` |
| VS Code extension | Workspace config plus authenticated SyncPoint identity |
| Guarded shell | Environment token created by `syncpoint guard shell` |
| File proxy | Process token, session token, or signed local capability |
| Unknown process | `unknown` actor; deny by default in strict mode, stage/quarantine in observe mode |

Actor identity is local-first. A project can run in permissive mode for demos,
but hard blocking must fail closed when actor identity is missing.

## Write Permit Model

Add a `WritePermit` domain object in core and persist it in server state.

```ts
interface WritePermit {
  id: string;
  actorId: string;
  taskId: string;
  sessionId?: string;
  resources: ResourceRef[];
  intent: "create" | "modify" | "delete" | "rename" | "bulk";
  operationId?: string;
  baseHashes: Array<{ resource: ResourceRef; sha256?: string; exists: boolean }>;
  expiresAt: string;
  singleUse: boolean;
  status: "issued" | "consumed" | "denied" | "expired" | "revoked";
  decision: WriteDecision;
}

interface WriteDecision {
  permitted: boolean;
  reason: "owned_claim" | "shared_claim" | "approved_operation" | "admin_override" | "blocked";
  blockers: Array<{ type: string; id: string; message: string }>;
  warnings: Array<{ type: string; message: string }>;
}
```

Permit issuance must evaluate the same project reality used by continuation
checks:

- active resource claims
- active SyncGates
- pending sync transactions
- submitted/conflicting operations
- constraint runtime blockers
- current projection availability, fail-closed
- optional content hash preconditions

## Permit Rules

The permit service should be conservative:

1. The target resource must normalize to a known `ResourceRef`.
2. The actor must own a compatible active claim, or reference an approved
   operation that authorizes the write.
3. No other active exclusive claim may overlap the target.
4. No unresolved gate may block the actor or resource.
5. No hard constraint may match the target resources.
6. Delete, rename, and bulk operations require explicit intent.
7. The permit expires quickly. Default: 30 seconds for editor save, 5 minutes
   for controlled batch operations.
8. Single-use permits are consumed atomically with the write.
9. If projection or database state cannot be read, deny.

## Controlled Write API

L1 introduces an explicit write path.

```text
syncpoint.write.prepare
  input: actor, task, session, resources, intent, optional operationId, base hashes
  output: permit or denial

syncpoint.write.apply
  input: permitId, file mutations, observed base hashes
  behavior: revalidate permit, write atomically, consume permit, audit result

syncpoint.write.check
  input: actor, resources, intent
  output: dry-run decision without issuing a permit
```

Atomic apply behavior:

```text
for each mutation:
  read current hash
  compare against permit base hash when supplied
  write to temp file in same directory
  fsync temp file when supported
  rename temp file over target
  fsync parent directory when supported
consume permit
emit WRITE_APPLIED
```

Deletes and renames must be represented as mutations, not ad hoc filesystem
calls. Bulk operations should have a maximum resource count unless the caller
uses a reviewed operation.

## Editor Hard-Save Guard

L2 turns supported editor saves into permit-backed writes.

VS Code cannot reliably cancel every save path after arbitrary async work, so
the hard-save design should use a custom guarded document flow:

```text
open protected file
  -> extension detects protected workspace
  -> file is made read-only or opened through a custom file system provider
  -> edits happen in editor buffer
  -> save command calls syncpoint.write.prepare
  -> permitted save calls syncpoint.write.apply
  -> denied save keeps buffer dirty and shows blockers
```

Recommended VS Code architecture:

- Register a `syncpoint:` `FileSystemProvider` for protected workspaces.
- Expose protected files through `syncpoint:/workspace/path`.
- Keep the real workspace read-only where possible.
- Override save commands for guarded documents.
- Show blockers in Sync View and save notifications.
- Fall back to current warn/audit guard for normal `file:` documents.

This gives a true editor-level hard save for supported documents without
pretending `onWillSaveTextDocument` is a universal lock.

## Guarded Shell

L1.5 provides a practical bridge for tools that can run through a wrapper.

```bash
syncpoint guard shell --agent agent-a --task task-1 --session session-1
syncpoint guard exec --agent agent-a --task task-1 -- pnpm format
```

The wrapper sets a short-lived local capability token:

```text
SYNCPOINT_GUARD_TOKEN=<signed local token>
SYNCPOINT_GUARD_ROOT=<project root>
SYNCPOINT_GUARD_MODE=strict
```

By itself this does not intercept raw writes. It becomes useful when paired
with the workspace file proxy, because the proxy can identify the process tree
or token-bearing process as an authorized actor.

## Workspace File Proxy

L3 is the first layer that can block native writes from shell commands, git,
formatters, code generators, and editors that operate inside a guarded mount.

```text
real project root
  D:\repo

guarded mount
  D:\repo.syncpoint

process writes D:\repo.syncpoint\src\auth.ts
  -> proxy intercepts create/open/write/rename/delete
  -> proxy asks SyncPoint for permit
  -> allowed write is applied to backing store
  -> denied write returns permission error
```

Platform options:

| Platform | Preferred mechanism | Notes |
|---|---|---|
| macOS | FUSE-T or macFUSE | Good developer ergonomics, install required |
| Linux | FUSE | Mature and scriptable |
| Windows | WinFsp | Practical user-mode filesystem route |

The proxy should be user-mode first. Kernel drivers/minifilters increase
support and signing burden dramatically.

### Proxy Modes

| Mode | Behavior |
|---|---|
| `observe` | Allow writes, emit audit events, never deny |
| `stage` | Write denied changes into `.syncpoint/staged-writes/`, create blocker |
| `strict` | Deny unauthorized writes with filesystem permission errors |
| `readonly` | Deny all writes except SyncPoint internal metadata |

`stage` is useful while teams tune claims. `strict` is the hard-lock mode.

### Proxy Operations

The proxy must intercept at least:

- file create
- file truncate
- file write
- atomic replace
- delete/unlink
- rename/move
- directory create/remove when it changes protected paths
- chmod/permission changes when supported
- symlink and hardlink creation

Renames are dangerous because they affect two resources. They require permits
for both source and destination.

### Backing Store Rules

- The real project root remains the source of truth.
- The guarded mount is the only supported write path in strict mode.
- Direct writes to the backing store cannot be stopped by a user-mode proxy.
  They must be prevented operationally with permissions, editor configuration,
  or L4 OS policy.
- The proxy must ignore `.syncpoint/` internal state except for read-only status
  projection files.

## OS Policy Driver

L4 is optional and expensive. It exists for environments that require blocking
direct writes to the real project root.

Possible implementations:

- Windows minifilter driver.
- macOS Endpoint Security plus File Provider or system extension.
- Linux fanotify/eBPF/LSM-based policy daemon, depending on distribution and
  privileges.

This layer should be designed as a policy adapter over the same permit service,
not as a second rules engine.

## Server Components

Add the following application services:

| Component | Responsibility |
|---|---|
| `write-permit-service` | Issue, deny, revoke, consume, and audit permits |
| `write-policy-service` | Pure decision logic over claims, gates, operations, constraints |
| `file-mutation-service` | Atomic local writes for controlled API apply |
| `guard-session-service` | Issue local process/session tokens for guarded shells and mounts |
| `filesystem-proxy-adapter` | Talks to FUSE/WinFsp implementation |

Core should contain the pure decision types and evaluators. Server owns
persistence, local filesystem application, and event emission.

## Events

Add event types:

| Event | Meaning |
|---|---|
| `WRITE_PERMIT_REQUESTED` | Actor asked to write protected resources |
| `WRITE_PERMIT_ISSUED` | Permit created |
| `WRITE_PERMIT_DENIED` | Permit denied with blockers |
| `WRITE_PERMIT_CONSUMED` | Permit used successfully |
| `WRITE_PERMIT_REVOKED` | Permit invalidated by gate/claim/constraint changes |
| `WRITE_BLOCKED` | Proxy/editor/API blocked a write |
| `WRITE_STAGED` | Unauthorized write captured into staging |
| `WRITE_APPLIED` | Controlled write changed the backing store |

These events should appear in Sync View so a denied filesystem write becomes
part of the same blocker story as claims and gates.

## CLI Surface

```bash
syncpoint write check src/auth.ts --agent agent-a --task task-1 --intent modify
syncpoint write apply src/auth.ts --agent agent-a --task task-1 --content-file patch.out

syncpoint guard shell --agent agent-a --task task-1 --session session-1
syncpoint guard mount . .syncpoint-worktree --mode strict
syncpoint guard status
syncpoint guard unmount .syncpoint-worktree
```

The mount command should refuse to mount inside `.git`, `.syncpoint`, or any
path outside the current project root.

## MCP / SDK Surface

MCP tools:

- `syncpoint_write_check`
- `syncpoint_write_prepare`
- `syncpoint_write_apply`
- `syncpoint_guard_status`

SDK methods:

- `client.write.check(input)`
- `client.write.prepare(input)`
- `client.write.apply(input)`
- `client.guard.createSession(input)`

MCP clients still cannot intercept native writes by themselves. The new tools
only become hard blocking when the client uses them as the write path or when a
filesystem proxy/editor provider enforces them.

## Sync View

Add a `File Guard` section:

- current enforcement level: audit, controlled API, editor guard, proxy, OS
- guarded roots and mounts
- mode: observe, stage, strict, readonly
- recent denied/staged/applied writes
- active permits
- blocked resources and owning claims
- unknown actor attempts

## Failure Modes

| Failure | Required behavior |
|---|---|
| SyncPoint server unavailable | Deny in strict mode, stage in stage mode, audit in observe mode |
| Projection build fails | Deny |
| Database locked/unreadable | Deny |
| Actor unknown | Deny in strict mode |
| Permit expired | Deny and request a new permit |
| File hash changed since permit | Deny or require rebase/recheck |
| Proxy crashes | Mount becomes unavailable; never silently writes through |
| Backing store modified directly | Detect through watcher/hash reconciliation and raise blocker |

## Security Notes

This design provides local enforcement, not hostile-root security. A user with
admin privileges can bypass user-mode filesystems, change permissions, kill the
daemon, or write directly to the backing store. SyncPoint should state this
plainly:

```text
Strict guard blocks normal local tools inside the guarded workspace.
It is not a DRM system and does not defend against a privileged local operator.
```

### Enforcement Boundary Summary

| Threat | L1 (API) | L2 (Editor) | L3 (Proxy) | L4 (OS) |
|---|---|---|---|---|
| Agent using SyncPoint writes without permit | **Blocked** | **Blocked** | **Blocked** | **Blocked** |
| Agent not using SyncPoint writes via shell/tool | Not blocked | Not blocked | **Blocked** (file permissions or mount) | **Blocked** |
| Process writes directly to real project root | Not blocked | Not blocked | **Blocked** (file permissions); detected by reconciliation (mount) | **Blocked** |
| Admin/root kills daemon or changes permissions | Not blocked | Not blocked | Not blocked | Not blocked |

**L1 is a cooperation protocol, not a security boundary.** It is useful because
most AI agent frameworks can be configured to route writes through SyncPoint's
API, CLI, or MCP tools. But it cannot defend against processes that bypass the
protocol entirely.

To close the gap for non-cooperating processes:

1. Deploy L3 via `syncpoint guard session --mode strict`. This sets claimed
   files to read-only via `chmod`/file permissions. `writeApply` temporarily
   unlocks files for authorized writes and re-locks them after.
2. Enable the reconciliation watcher (`syncpoint guard reconcile`) to detect
   and raise `BACKING_STORE_BYPASS` gates when files are modified directly.
3. For stronger isolation, deploy a FUSE/WinFsp mount (future) and restrict
   backing store access.

This makes L3 file-permission guard an effective local enforcement boundary
for normal (non-admin) processes. Admin/owner processes can still override
read-only permissions, but this blocks the vast majority of unintended writes
from non-cooperating agent processes.

## Implementation Plan

### Phase 1: Permit Core

- Add core `WritePermit`, `WriteDecision`, and pure policy evaluator.
- Add server `write-permit-service`.
- Persist permits and write events.
- Add tRPC, SDK, MCP, and CLI check/prepare/apply surfaces.
- Tests: owned claim allowed, conflicting exclusive claim denied, active gate
  denied, constraint denied, projection failure denied, expired permit denied.

### Phase 2: Controlled Writes

- Implement atomic file mutation apply.
- Add hash preconditions and single-use permit consumption.
- Add operation-aware writes for `code_patch`.
- Add Sync View visibility for write permits and denied writes.
- Convert internal patch/apply flows to use `syncpoint.write.apply`.

### Phase 3: Editor Hard Guard

- Add VS Code `syncpoint:` `FileSystemProvider`.
- Route guarded save through prepare/apply.
- Keep current `file:` warning/audit path as fallback.
- Add config:
  - `syncpoint.fileGuard.mode`: `audit | editor-strict | proxy-strict`
  - `syncpoint.fileGuard.protectedRoots`
  - `syncpoint.fileGuard.unknownActorPolicy`

### Phase 4: User-Mode File Proxy

- Prototype one platform first:
  - Windows: WinFsp
  - Linux/macOS: FUSE
- Implement strict/stage/observe modes.
- Add guarded mount CLI.
- Add process/session token actor resolution.
- Add reconciliation watcher against direct backing-store writes.

### Phase 5: OS Policy Adapter

- Only if required by product goals.
- Keep policy decisions in SyncPoint server.
- Treat driver/system extension as a thin enforcement adapter.

## Acceptance Criteria

The system-level lock is complete when these are true:

1. A write by the claim owner through `syncpoint.write.apply` succeeds.
2. A write by another actor to an exclusive claimed file is denied before bytes
   change.
3. A write to a resource blocked by an unresolved SyncGate is denied even after
   all agents have acknowledged it.
4. A denied editor save leaves the user buffer intact and the backing file
   unchanged.
5. A denied proxy write returns a filesystem permission error and records
   `WRITE_BLOCKED`.
6. A staged proxy write never mutates the backing file and creates a staged
   artifact plus blocker.
7. A server/projection failure denies writes in strict mode.
8. A direct write to the backing store is detected and converted into a blocker.
9. Sync View shows the same blocker reason for API, editor, and proxy denials.

## Product Boundary

Use this wording consistently:

```text
SyncPoint has three file-protection modes:

Audit mode detects unsafe writes after they happen.
Controlled mode hard-blocks writes routed through SyncPoint.
Guarded workspace mode hard-blocks normal native writes inside a mounted
SyncPoint workspace.

Only an OS policy driver can attempt to block every native write to the original
path, and even that is subject to local administrator control.
```
