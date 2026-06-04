# SyncPoint Configuration Reference

## Configuration Priority

Configuration is loaded with the following priority (highest first):

1. **CLI arguments** — e.g., `syncpoint server start --port 9000`
2. **Environment variables** — prefixed with `SYNCPOINT_`
3. **Config file** — `.syncpoint/config.yaml` (or `config.json`)
4. **Defaults** — built-in sensible defaults

## Config File

Create `.syncpoint/config.yaml` in your project root:

```yaml
# Server
server:
  port: 8765
  host: 127.0.0.1
  corsOrigins: ["http://localhost:*"]

# Database
database:
  path: .syncpoint/syncpoint.db
  wal: true
  busyTimeout: 5000

# File Guard
guard:
  mode: L2_warn          # off | L1_audit | L2_warn | L3_block
  fileWatcher: native     # native | @parcel/watcher
  debounceMs: 300
  maxWatchers: 5000

# SSE (Server-Sent Events)
sse:
  heartbeatIntervalMs: 30000
  maxConnections: 200
  eventRetentionHours: 24

# Constraints
constraints:
  defaultPolicy: allow_all  # allow_all | deny_all

# Checkpoints
checkpoint:
  snapshotMode: incremental  # full | incremental
  gcStrategy: keep_last_n    # keep_last_n | max_age_days | max_size_mb
  gcKeepLast: 50
  gcMaxAgeDays: 30
  gcMaxSizeMb: 500

# Authentication
auth:
  sharedSecret: ""         # Set for multi-machine setups
  requireToken: false
  tokenHeader: x-agent-token

# Logging
log:
  level: info              # debug | info | warn | error | fatal
  format: json             # json | pretty
```

## Environment Variables

| Variable | Effect |
|----------|--------|
| `SYNCPOINT_PORT` | Server port |
| `SYNCPOINT_HOST` | Server bind address |
| `SYNCPOINT_CORS_ORIGINS` | Comma-separated CORS origins |
| `SYNCPOINT_DB_DIR` | Database directory path |
| `SYNCPOINT_NO_WAL` | Set to `true` to disable WAL mode |
| `SYNCPOINT_SHARED_SECRET` | Auth shared secret |
| `SYNCPOINT_GUARD_MODE` | Guard mode (off/L1_audit/L2_warn/L3_block) |
| `SYNCPOINT_DEFAULT_POLICY` | Default constraint policy |
| `SYNCPOINT_HTTPS` | Set to `true` for HTTPS mode |
| `SYNCPOINT_MAX_BODY_SIZE` | Max request body size in bytes (default 5MB) |
| `LOG_LEVEL` | Log level |

## Validation

Invalid configuration values are caught at startup with clear error messages and fix suggestions. Example:

```
❌ server.port: expected number, got string
   💡 Set server.port to a valid number value (1024-65535).
```

Run `syncpoint doctor` to check your current configuration health.
