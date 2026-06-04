# syncpoint-server

SyncPoint local server — tRPC + SQLite (better-sqlite3) + SSE event streaming.

Provides the application layer: use cases, repositories, event bus, and transport adapters.

## Usage

```typescript
import { startServer, closeDb } from "syncpoint-server";

// Start the SyncPoint server
const { port, host } = startServer({ port: 8765 });
console.log(`SyncPoint running on http://${host}:${port}`);

// Access application services
import { rcClaim, rcDetectConflicts } from "syncpoint-server/application";
import { listAgents, createTask } from "syncpoint-server/repositories";
```

## Architecture

- `application/` — use cases, state transitions, event emission
- `repositories/` — SQLite data access via Drizzle and better-sqlite3
- `routers/` — tRPC routers for HTTP-based access
- `event-bus.ts` — internal event bus with SSE fan-out

📖 See [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for layer boundaries and design principles.
