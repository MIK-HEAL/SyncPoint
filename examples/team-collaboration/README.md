# Team Collaboration Example

This example demonstrates how to set up a multi-agent team using SyncPoint's declarative manifest system.

## Directory Structure

```text
my-project/
├── .syncpoint/
│   ├── syncpoint.db          # auto-generated (gitignored)
│   └── agents/               # agent declarations (tracked)
│       ├── architect.yml     # team lead — manages sessions, reviews
│       ├── frontend-dev.yml  # frontend specialist
│       ├── backend-dev.yml   # backend specialist
│       └── reviewer.yml      # code review gate
├── src/
└── ...
```

## Quick Setup

```bash
# 1. Initialize with a team template
syncpoint init --team delivery-pod

# 2. Or create agents one by one
syncpoint init
syncpoint agent init  # interactive — prompts for name, provider, role

# 3. Verify all agents are registered
syncpoint agent list

# 4. Diagnose any issues
syncpoint agent diagnose
```

## Example Manifests

### architect.yml

```yaml
version: 1
name: architect
provider: claude-code
profile: manager
role: manager
tags:
  - lead
  - planning
capabilities:
  - domain: architecture
    proficiency: expert
  - domain: review
    proficiency: advanced
availability: available
autoStart: true
notes: "Session architect — creates tasks, reviews operations, resolves gates"
```

### frontend-dev.yml

```yaml
version: 1
name: frontend-dev
provider: cursor
profile: executor
role: frontend
tags:
  - ui
  - react
capabilities:
  - domain: frontend
    proficiency: expert
  - domain: testing
    proficiency: intermediate
availability: available
notes: "Frontend executor — implements UI components and tests"
```

### backend-dev.yml

```yaml
version: 1
name: backend-dev
provider: codex
profile: executor
role: backend
tags:
  - api
  - database
capabilities:
  - domain: backend
    proficiency: expert
  - domain: database
    proficiency: advanced
availability: available
notes: "Backend executor — implements API endpoints and data models"
```

### reviewer.yml

```yaml
version: 1
name: reviewer
provider: cursor
profile: reviewer
role: reviewer
tags:
  - review
  - quality
capabilities:
  - domain: review
    proficiency: expert
  - domain: testing
    proficiency: advanced
availability: available
notes: "Review gate — approves operations before apply"
```

## Workflow

1. **Architect** creates a session and assigns tasks
2. **Frontend/Backend devs** claim resources and submit operations
3. **Reviewer** approves operations before they are applied
4. Any resource conflict creates a blocker visible in `syncpoint status`

## CI Integration

```yaml
# .github/workflows/validate-agents.yml
name: Validate Agent Manifests
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g syncpoint-cli
      - run: syncpoint agent validate .syncpoint/agents/
```

## Migrating from Imperative Registration

If you previously used `syncpoint agent add` to register agents:

```bash
# Convert existing runtime agents to manifest files
syncpoint agent migrate

# Validate the generated manifests
syncpoint agent validate .syncpoint/agents/

# Commit to version control
git add .syncpoint/agents/
git commit -m "migrate: convert runtime agents to declarative manifests"
```

See [Migration Guide](../../docs/migration-guide.md) for full details.
