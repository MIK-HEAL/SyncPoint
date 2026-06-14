# syncpoint-loop-runner

Autonomous orchestrator for SyncPoint — runs Claude Code agents in parallel.

## What It Does

`syncpoint-loop-runner` is the missing piece that makes SyncPoint truly autonomous. It:

1. **Discovers work** — queries SyncPoint for open tasks and wake requests
2. **Boots agents** — uses SyncPoint's `loop.boot` / `loop.resume` to prepare context
3. **Executes tasks** — spawns Claude Code CLI subprocesses to do the actual work
4. **Checkpoints progress** — saves results back via `loop.checkpoint`
5. **Handles conflicts** — respects SyncGate blocks and escalation
6. **Loops** — repeats until all work is done or safety limits are reached

## Quick Start

```bash
# 1. Start SyncPoint server
syncpoint serve

# 2. Create some tasks
syncpoint task create --title "Fix authentication bug"
syncpoint task create --title "Add dark mode support"

# 3. Run the autonomous loop (single agent)
pnpm --filter syncpoint-loop-runner dev run

# 4. Or with options
pnpm --filter syncpoint-loop-runner dev run \
  --concurrency 3 \
  --max-iterations 50 \
  --dry-run
```

## CLI Commands

### `run` — Start the autonomous loop

```bash
syncpoint-loop-runner run [options]

Options:
  --url <url>           SyncPoint server URL (default: http://127.0.0.1:8765)
  --concurrency <n>     Number of parallel workers, 1-16 (default: 1)
  --max-iterations <n>  Maximum total iterations (default: 100)
  --max-failures <n>    Max failures per task before giving up (default: 3)
  --poll-interval <ms>  Poll interval in ms (default: 2000)
  --timeout <ms>        Claude execution timeout in ms (default: 600000)
  --claude-binary <path> Path to claude CLI (default: claude)
  --dry-run             Plan work but don't execute
  --log-level <level>   debug|info|warn|error (default: info)
  --log-file <path>     Optional log file
```

### `status` — Check current state

```bash
syncpoint-loop-runner status [--url <url>]
```

## Architecture

```
┌──────────────────────────────────────────────┐
│        AutonomousLoopRunner (runner.ts)       │
│                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Worker-0 │  │ Worker-1 │  │ Worker-N │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       └──────────────┼──────────────┘        │
│                      │                       │
│  ┌───────────────────▼──────────────────┐    │
│  │     TaskSource (shared queue)        │    │
│  └───────────────────┬──────────────────┘    │
│                      │                       │
│  ┌───────────────────▼──────────────────┐    │
│  │  SSE Event Stream (reactive wake)    │    │
│  └──────────────────────────────────────┘    │
└──────────────────────┬───────────────────────┘
                       │ tRPC HTTP
                       ▼
┌──────────────────────────────────────────────┐
│          SyncPoint Server (existing)          │
│  task · agent · loop · wake · syncGate       │
└──────────────────────────────────────────────┘
```

## Library Usage

```ts
import { AutonomousLoopRunner, RunnerConfigSchema } from "syncpoint-loop-runner";

const runner = new AutonomousLoopRunner(
  RunnerConfigSchema.parse({ concurrency: 3, dryRun: true })
);

await runner.start();
```

## Environment Variables

| Variable | Config Key | Default |
|----------|-----------|---------|
| `SYNCPOINT_URL` | `serverUrl` | `http://127.0.0.1:8765` |
| `SYNCPOINT_CONCURRENCY` | `concurrency` | `1` |
| `SYNCPOINT_MAX_ITERATIONS` | `maxIterations` | `100` |
| `SYNCPOINT_AGENT_PREFIX` | `agentPrefix` | `runner` |
| `SYNCPOINT_CLAUDE_BINARY` | `claudeBinary` | `claude` |
| `SYNCPOINT_LOG_LEVEL` | `logLevel` | `info` |

## Safety

- **Global iteration limit** — stops after N total work cycles
- **Per-task failure limit** — gives up on a task after N consecutive failures
- **Graceful shutdown** — SIGINT/SIGTERM propagates to all workers
- **SyncGate respect** — never ignores SyncPoint's conflict barriers
- **Dry-run mode** — plan and log without executing
