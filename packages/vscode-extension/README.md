# SyncPoint VS Code Extension

Sync View for editor AI synchronization — sessions, claims, blockers, patches, and wake obligations visible inside VS Code.

## Features

- **Sync View panel**: Sessions, claims, sync gates, and blockers at a glance
- **Status bar indicator**: 🟢 no conflicts / 🟡 constraints / 🔴 conflicts
- **File decoration**: 🔒 icon on locked/claimed files
- **File Audit Guard**: Pre-save warnings and post-save auditing
- **Write Permits**: Guarded documents that save through syncpoint write permits

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `syncpoint.serverUrl` | `http://localhost:8765` | SyncPoint server URL |
| `syncpoint.agentId` | — | Agent ID for this editor |
| `syncpoint.taskId` | — | Task ID for this editor |
| `syncpoint.enableFileGuard` | `false` | Enable pre-save audit warnings |
| `syncpoint.guardMode` | — | Guard mode (`editor-strict` for guarded docs) |

📖 See [docs/mcp-client-support.md](../docs/mcp-client-support.md) for editor integration details.
