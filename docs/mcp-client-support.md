# MCP Client Support And File-Write Boundaries

SyncPoint can expose synchronization state and tools through MCP, but MCP is not a filesystem interception layer.

## Support Matrix

| Client / Surface | Can read SyncPoint state | Can call SyncPoint tools | Can block native file writes before they happen | Recommended guard |
|---|---:|---:|---:|---|
| MCP-connected editor agent | Yes | Yes | No | Require `resume`, `claim`, `checkpoint`, and operation tools before continuing |
| SyncPoint CLI | Yes | Yes | No | Use `syncpoint watch <dir>` for fast post-write auditing |
| `syncpoint watch` | Yes | Creates/updates gates after changes | No | Detect changed claimed files, log audit events, raise `resource_conflict` gates |
| VS Code extension | Yes | Extension-dependent | Partial warning only | Use pre-save warnings plus post-save auditing |
| Controlled write API | Yes | Yes | Yes, when the write is routed through it | Use `syncpoint.write.prepare/apply/check` as the write path |
| Guarded workspace proxy | Yes | Yes | Yes, for writes inside the guarded mount | Run native tools inside the mounted SyncPoint workspace |
| Raw shell, git, external tools | No | No | No | Pair with `syncpoint watch` and review status events |

## Boundary

MCP clients can cooperate with SyncPoint by calling tools and prompts, but they cannot intercept every way a file can change on disk.

Examples that bypass MCP pre-checks:

- A shell command writes a file directly.
- A user edits and saves manually in an editor.
- Another tool rewrites files outside the MCP client.
- Git checkout, merge, reset, or generation scripts modify files.

For those cases, `syncpoint watch <dir>` is a post-write audit layer. It detects changes after the filesystem reports them, records `FILE_CHANGED`, `FILE_AUDIT_ALERT`, or `FILE_POLLUTION_DETECTED`, and can create or update a `resource_conflict` SyncGate.

The VS Code File Audit Guard follows the same boundary: `onWillSaveTextDocument`
is used for best-effort warnings, and `onDidSaveTextDocument` performs post-save
auditing. It is not a hard wait/cancel mechanism and does not block shell, git,
scripts, or external processes from writing files.

## Hard-Blocking Roadmap

MCP support fits into the system-level file lock roadmap in three stages:

| Stage | What becomes hard-blocking | What MCP alone still cannot do |
|---|---|---|
| Controlled write API | MCP, SDK, CLI, or plugin writes that call `syncpoint.write.prepare/apply/check` | Intercept a native file write that bypasses those tools |
| Editor hard-save guard | Supported editor saves routed through a SyncPoint-backed save provider | Stop shell, git, generators, or external processes |
| Guarded workspace proxy | Native writes inside a mounted SyncPoint workspace | Protect direct writes to the original backing path without OS policy |

This means MCP can participate in hard blocking when it is the write path, but
MCP is not the interception mechanism for arbitrary local filesystem writes.

## Recommended Local Setup

```bash
syncpoint claim src/auth.ts --agent agent-a --task task-a --session session-1
syncpoint watch . --agent agent-b --task task-b --session session-1
syncpoint status -w --session session-1 --events 10
```

If `agent-b` or an external process modifies `src/auth.ts`, the watcher reports pollution and SyncPoint records the audit event. The status dashboard then shows the active gate, pending agents, vote counts, deadline/liveness information, and recent event timeline.

## Operator Rule

Treat SyncPoint as authoritative for continuation decisions, not as a kernel-level filesystem lock.

```text
MCP tools can enforce cooperative protocol boundaries.
fs.watch can audit direct writes after they happen.
VS Code save hooks can warn before save and audit after save.
Pre-write blocking requires controlled write paths or editor-specific integration.
```

For the full hard-blocking roadmap, including controlled writes, editor hard-save
guarding, guarded workspace mounts, and optional OS policy adapters, see
[`system-file-lock-design.md`](system-file-lock-design.md).
