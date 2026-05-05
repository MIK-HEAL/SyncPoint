# SyncPoint CLI

Stop unsafe AI continuation before it becomes lost context, overwritten work, or a broken handoff.

## Quick Start

```bash
npm install -g @syncpoint/cli

syncpoint init
syncpoint demo
syncpoint status
```

The default demo creates an isolated workspace, shows two agents claiming the same file, blocks unsafe continuation, then resolves the sync boundary.

## Core Commands

```bash
syncpoint status
syncpoint claim src/auth/session.ts --agent <agentId> --task <taskId>  # --type file (default)
syncpoint claim assets/hero.png --agent <agentId> --task <taskId> --type binary_asset
syncpoint checkpoint --agent <agentId> --task <taskId> --summary "safe stopping point"
syncpoint resume --agent <agentId> --task <taskId>
syncpoint wake --agent <agentId>
```

SyncPoint is not an agent runner. It is the local coordination layer agents call before they continue.
