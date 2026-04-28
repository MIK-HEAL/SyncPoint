# SyncPoint MVP Showcase

This is the shortest path to show SyncPoint as a working synchronization protocol.

## What To Show

SyncPoint prevents multiple AI coding agents from drifting apart in the same project. The MVP demonstrates that agents **stop and synchronize** at the right moments — instead of silently diverging:

- **Sync State**: Agents register, get assigned roles, and share a single source of truth
- **Checkpoint**: Executor saves structured progress so others can see current state
- **Review Gate**: Reviewer cannot approve without evidence — this is a sync barrier
- **Phase Transitions**: Session advances only when all sync conditions are met
- **Context Capsule**: Compressed task context prevents drift on resume

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
1. The core problem: multiple AI agents editing the same codebase with no coordination.
2. SyncPoint is a synchronization protocol, not a runtime — it makes agents stop and sync.
3. Every feature answers: who is changing what, when must they sync, what to confirm, who continues.
4. The Architect decomposes tasks with clear file boundaries — preventing uncoordinated parallel edits.
5. The Executor checkpoints progress — this is a sync point, not just a save.
6. The Reviewer is a sync gate — the session cannot advance without evidence-backed approval.
7. CLI and MCP use the same protocol layer, so editor agents obey the same sync rules.
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
It is not a multi-agent runtime — it does not run models.
It is not a workflow builder — no visual DAGs or LangGraph.
It is not a memory platform — memory serves sync context.
It is not an auto-pilot — wake requests are sync notifications, not "keep working" triggers.
```

The current MVP is deliberately narrower:

```text
synchronization protocol + local state + CLI/MCP adapter + evidence-based sync gates
```
