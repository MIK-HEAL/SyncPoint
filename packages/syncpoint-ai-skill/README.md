# SyncPoint AI Skill

Claude Code plugin skills for using the SyncPoint coordination CLI.

## Requirements

- Claude Code with plugin support
- Node.js 20 or newer
- The SyncPoint CLI installed and available as `syncpoint`

Install the CLI separately:

```bash
npm install -g syncpoint-ai
syncpoint --version
```

## Install the plugin

This package is a Claude Code plugin bundle. Install it from a checked-out
SyncPoint repository or from an extracted package directory using the Claude
Code plugin installer. If you publish it to a Claude Code marketplace, install
it with the marketplace-qualified plugin name shown by that marketplace.

The npm package name alone does not register a plugin with Claude Code.

To create and publish the npm artifact from this directory:

```bash
npm pack
npm publish --access public
```

Publishing creates a versioned snapshot. Update the package and plugin version
before each release; existing npm versions cannot be overwritten.

## Included skills

- `setup` — initialize a project and register agents
- `claim` — claim and release resources
- `sync` — inspect and resolve synchronization gates
- `agent-loop` — boot, checkpoint, resume, and hand off tasks
- `handoff` — transfer work between agents
- `review` — create and evaluate review requests
- `guard` — manage guard sessions and audits
- `write` — use permit-backed file writes

Each skill contains command examples that match the current `syncpoint` CLI.
