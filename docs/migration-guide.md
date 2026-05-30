# Agent Registration Migration Guide

This guide explains how to migrate from the imperative (database-first) agent registration model to the declarative (manifest-file) model introduced in v0.2.

## What Changed

| Before (imperative) | After (declarative) |
|---|---|
| `syncpoint agent add --name X --provider Y --role Z` | Create `.syncpoint/agents/X.yml` |
| Agent exists only in SQLite | Agent declared in file, synced to SQLite |
| No version control for agent definitions | Manifests are git-trackable |
| No auto-discovery | File watcher auto-syncs on create/modify/delete |

## Compatibility Status

### Retained APIs (still functional)

These APIs continue to work. They create runtime agent rows directly in the database without manifest files:

| API | Location | Status |
|-----|----------|--------|
| `syncpoint agent add` | CLI `agent.ts` | **Retained** — creates runtime-only agent |
| `agent.create` tRPC mutation | `agent-router.ts` | **Retained** — creates runtime-only agent |
| `repo.createAgent()` | `agent-repository.ts` | **Retained** — internal repository function |

Agents created via these APIs are **runtime-only**: they function normally in sessions, claims, and operations, but they do not have a corresponding manifest file. They will not appear in `syncpoint agent list` (the declared list) unless migrated.

### Deprecated patterns

| Pattern | Replacement |
|---------|-------------|
| Direct `createAgent()` for long-lived agents | `initAgentManifest()` → file-based registration |
| `syncpoint agent add` for project agents | `syncpoint agent init` → creates manifest file |
| Manual DB inserts for agent setup | `syncpoint init --team <template>` → materialize team |

### New APIs (manifest-first)

| API | Location | Purpose |
|-----|----------|---------|
| `syncpoint agent init` | CLI | Interactive single manifest creation |
| `syncpoint agent list` | CLI | List declared agents with metadata |
| `syncpoint agent diagnose` | CLI | Diagnose registry issues |
| `syncpoint agent validate` | CLI | Schema validation |
| `syncpoint agent sync` | CLI | Manual rescan |
| `syncpoint agent import` | CLI | Bulk import from files |
| `syncpoint agent migrate` | CLI | Convert runtime agents to manifests |
| `agentRegistry.sync` | tRPC | Full rescan |
| `agentRegistry.syncFile` | tRPC | Single-file sync |
| `agentRegistry.list` | tRPC | List declared agents |
| `agentRegistration.diagnose` | tRPC | Diagnose registry |

## Migration Steps

### Step 1: Check for runtime-only agents

```bash
# List runtime agents (DB-only, no manifest)
syncpoint agent list --runtime

# Compare with declared agents (manifest-based)
syncpoint agent list
```

If the runtime list contains agents not in the declared list, those are runtime-only agents that need migration.

### Step 2: Migrate runtime agents to manifest files

```bash
# Migrate all runtime agents
syncpoint agent migrate

# Migrate a specific agent
syncpoint agent migrate --agent <nameOrId>

# Choose output format
syncpoint agent migrate --format json
```

This creates a manifest file in `.syncpoint/agents/` for each runtime agent and syncs them into the declared registry.

### Step 3: Validate the migrated manifests

```bash
syncpoint agent validate .syncpoint/agents/
```

### Step 4: Diagnose any issues

```bash
syncpoint agent diagnose
```

This reports any parse errors, missing fields, or stale entries with fix suggestions.

### Step 5: Commit the manifest files

```bash
git add .syncpoint/agents/
git commit -m "chore: migrate agents to declarative manifests"
```

## Team Collaboration Directory Structure

### Recommended layout

```text
project/
├── .syncpoint/
│   ├── syncpoint.db          # local runtime state (gitignored)
│   └── agents/               # agent declarations (tracked in git)
│       ├── architect.yml     # team lead agent
│       ├── frontend-dev.yml  # frontend specialist
│       ├── backend-dev.yml   # backend specialist
│       └── reviewer.yml      # code review agent
├── src/
└── ...
```

### Team template bootstrapping

```bash
# Initialize with a lean pair (architect + executor)
syncpoint init --team lean-pair

# Initialize with a delivery pod (architect + 2 executors + reviewer)
syncpoint init --team delivery-pod

# List available templates
syncpoint team list-templates
```

### Best practices

1. **Track manifests in git.** Add `.syncpoint/agents/` to version control. Exclude `.syncpoint/syncpoint.db`.
2. **One agent per file.** Each manifest file declares exactly one agent.
3. **Use YAML for readability.** JSON is supported but YAML is easier to edit manually.
4. **Name files after the agent.** Use `architect.yml`, not `agent-1.yml`.
5. **Run `syncpoint agent validate` in CI.** Catch schema errors before they reach the runtime.
6. **Use `syncpoint agent diagnose` for troubleshooting.** It provides fix suggestions for common errors.
7. **Don't mix registration methods.** Once you migrate to manifests, avoid `syncpoint agent add` for new agents.

### `.gitignore` recommendations

```gitignore
# Runtime state — local only
.syncpoint/syncpoint.db

# Agent manifests — track in git
# (do NOT ignore .syncpoint/agents/)
```
