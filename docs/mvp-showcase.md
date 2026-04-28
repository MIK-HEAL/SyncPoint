# SyncPoint MVP Showcase

This is the shortest path to show SyncPoint as a working MVP.

## What To Show

SyncPoint is a local collaboration protocol layer for editor agents.
The MVP demonstrates:

- Project memory approved before execution context
- Architect, Executor, and Reviewer roles in one session
- Task assignment and contract approval
- Checkpoint and context capsule
- Evidence-backed review
- Approval gate
- Final session completion

## One-Command Demo

```bash
pnpm build
node packages/syncpoint-cli/dist/main.js demo mvp
```

By default, the command creates an isolated demo workspace:

```text
.syncpoint/mvp-demo-workspace/.syncpoint/syncpoint.db
.syncpoint/mvp-demo-workspace/.syncpoint/project-memory.md
.syncpoint/mvp-demo-workspace/.syncpoint/mvp-demo.md
```

Open the generated report:

```text
.syncpoint/mvp-demo-workspace/.syncpoint/mvp-demo.md
```

To write demo data into another project, pass:

```bash
node packages/syncpoint-cli/dist/main.js demo mvp --project <projectDir>
```

## Talk Track

```text
1. These are not free-running agents.
2. SyncPoint gives agents a shared collaboration protocol.
3. The Architect creates durable project memory and a session.
4. The Executor gets a scoped task and writes checkpoint/capsule context.
5. The Reviewer cannot approve without evidence.
6. The approval gate turns review from opinion into auditable state.
7. CLI and MCP use the same application layer, so editor agents can run this flow too.
```

## Useful Follow-Up Commands

The generated report includes concrete IDs. Use them with:

```bash
syncpoint session status --session <sessionId>
syncpoint review packet --review <reviewRequestId>
syncpoint review gate --review <reviewRequestId>
```

## What This MVP Is Not

```text
It is not an autonomous model scheduler.
It is not a cloud collaboration platform.
It is not a UI-first product yet.
```

The current MVP is deliberately narrower:

```text
protocol layer + local state + CLI/MCP adapter + evidence-based review
```
