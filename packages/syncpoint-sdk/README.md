# syncpoint-sdk

SyncPoint SDK — typed client library for AI tools and extensions.

Provides a clean TypeScript client for interacting with a SyncPoint server via tRPC or REST.

## Installation

```bash
pnpm add syncpoint-sdk
```

## Usage

```typescript
import { SyncPointClient } from "syncpoint-sdk";

const client = new SyncPointClient({
  baseUrl: "http://localhost:8765",
  agentId: "my-agent",
});

// Claim a resource
const result = await client.claimResource({
  taskId: "task-1",
  locators: "src/auth.ts",
  scope: "function",
  functionName: "login",
});

// Check status
const status = await client.getStatus();
```

📖 See [docs/API.md](../docs/API.md) for the full API reference.
