---
description: "Install and configure SyncPoint — set up a multi-agent coordination project from scratch. Use when the user asks to set up SyncPoint, initialize agent coordination, or create a multi-agent project."
---

# SyncPoint Setup

You are helping a user set up SyncPoint for AI agent coordination. Follow these steps.

## Prerequisites
- Node.js >= 20
- Git repository initialized

## Step 1: Install SyncPoint

Install the core package globally:

```bash
npm install -g syncpoint-ai
```

## Step 2: Initialize the Project

```bash
cd <project-directory>
syncpoint init
```

This creates a `.syncpoint/` directory with a SQLite database. To generate a team from a template:

```bash
syncpoint init --team pair
syncpoint init --team squad
```

Available team templates: `pair`, `trio`, `squad`, `review-team`.

## Step 3: Create Agent Manifests

Every AI agent needs a manifest file declaring its identity, provider, role, and capabilities.

Interactive creation:
```bash
syncpoint agent init
```

Or import from existing manifests:
```bash
syncpoint agent import ./manifests/
```

View all declared agents:
```bash
syncpoint agent list
```

## Step 4: Start the Server

```bash
syncpoint server start
syncpoint server start --port 9876
```

Sync declared agents into runtime:
```bash
syncpoint agent sync
```

## Step 5: Verify Everything Works

```bash
syncpoint status
syncpoint agent list --runtime
syncpoint dev status
```

## Next Steps
- Create a task: `syncpoint task create "My Task"`
- Boot the agent loop: see `/syncpoint-ai-skill:agent-loop`
- Claim resources: see `/syncpoint-ai-skill:claim`

## Troubleshooting
| Problem | Solution |
|---------|----------|
| Port 8765 in use | `syncpoint server start --port 9876` |
| Agents not in runtime | `syncpoint agent sync` |
| Database locked | Wait 5s; if persistent, restart the server |
| Migration errors | v0.2 is a breaking reset — delete `.syncpoint/syncpoint.db` and re-run `syncpoint init` |
