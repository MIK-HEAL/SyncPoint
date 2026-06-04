# SyncPoint FAQ

## Deployment

### Port already in use
```
Error: listen EADDRINUSE :::8765
```
**Fix:** Change the port with `SYNCPOINT_PORT=9000 syncpoint server start` or set `server.port` in `.syncpoint/config.yaml`.

### Database permission denied
```
Error: SQLITE_CANTOPEN: unable to open database file
```
**Fix:** Ensure `.syncpoint/` directory is writable. Check disk space and file permissions.

### File locks not working on Windows
**Fix:** SyncPoint uses `attrib +R` on Windows. Ensure you're running in a terminal with appropriate permissions. For WSL, use the POSIX path.

### WAL mode issues on network drives
**Fix:** Set `database.wal: false` in config or `SYNCPOINT_NO_WAL=true`. WAL mode is incompatible with some network filesystems.

## Usage

### How do I set up constraints?
Use the `syncpoint constraint` command or edit `.syncpoint/config.yaml`:
```bash
syncpoint constraint add --path "src/auth/**" --rule do_not_touch
```

### How do I resolve a conflict?
1. Run `syncpoint status` to see active conflicts
2. Decide: narrow your scope (`--scope function`), wait for the other agent, or coordinate
3. Use `syncpoint claim` with a narrower scope to avoid the conflict

### How do I back up and restore?
```bash
# Export
syncpoint export --output backup.json

# Import
syncpoint import backup.json
```

### How do I clean up old checkpoints?
```bash
# Manual GC
syncpoint snapshot-gc --keep-last-n 20 --max-age-days 7

# Or configure automatic GC in config.yaml:
# checkpoint:
#   gcKeepLast: 20
#   gcMaxAgeDays: 7
```

### How do I completely remove SyncPoint?
```bash
syncpoint uninstall
```
This restores file permissions, removes `.syncpoint/`, and optionally keeps the database.

## Performance

### Database is getting large
Run GC regularly:
```bash
syncpoint snapshot-gc --max-size-mb 100 --keep-last-n 20
syncpoint doctor  # Check database health
```

### Many SSE connections slowing things down
SSE connections are limited to 200 by default. Adjust in config:
```yaml
sse:
  maxConnections: 100
```

### Slow startup
Ensure SQLite WAL mode is enabled (default). Check that `.syncpoint/syncpoint.db` is on a local SSD, not a network drive.

## Troubleshooting

### "Agent not found" errors
Run `syncpoint agent list` to see registered agents. If your agent is missing:
```bash
syncpoint agent sync  # Sync manifests to runtime state
```

### Events not arriving after reconnect
SSE replay uses a ring buffer of the last 1000 events. If the client was disconnected for too long and missed more than 1000 events, some may be lost. Run `syncpoint status` to get current state.

### "Unknown error" — how do I debug?
1. Set `LOG_LEVEL=debug` for verbose logging
2. Run `syncpoint doctor` to check system health
3. Check the log output for stack traces
4. Report issues at https://github.com/MIK-HEAL/SyncPoint/issues
