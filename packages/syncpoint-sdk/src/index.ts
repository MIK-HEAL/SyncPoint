/**
 * SyncPoint SDK — typed tRPC client for AI tools and extensions.
 *
 * Usage:
 *   import { createSyncPointClient } from "syncpoint-sdk";
 *   const sp = createSyncPointClient("http://127.0.0.1:8765");
 *   const agent = await sp.agent.create.mutate({ name: "codex", provider: "codex", role: "backend" });
 *   const tasks = await sp.task.list.query();
 */

import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "syncpoint-server";
import type {
  WriteApplyInput,
  WriteApplyResult,
  WriteCheckInput,
  WriteCheckResult,
  WritePrepareInput,
  WritePrepareResult,
  GuardCreateSessionInput,
  GuardSession,
  GuardStatusResult,
  GuardValidateTokenResult,
} from "syncpoint-server/application";

export type SyncPointClient = ReturnType<typeof createTRPCProxyClient<AppRouter>>;

const DEFAULT_URL = "http://127.0.0.1:8765";

export function createSyncPointClient(url = DEFAULT_URL): SyncPointClient {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({ url: `${url}/trpc` }),
    ],
  });
}

export interface SyncPointWriteClient {
  check(input: WriteCheckInput): Promise<WriteCheckResult>;
  prepare(input: WritePrepareInput): Promise<WritePrepareResult>;
  apply(input: WriteApplyInput): Promise<WriteApplyResult>;
}

export function createSyncPointWriteClient(url = DEFAULT_URL): SyncPointWriteClient {
  const client = createSyncPointClient(url);
  return {
    check: (input) => client.write.check.query(input),
    prepare: (input) => client.write.prepare.mutate(input),
    apply: (input) => client.write.applyWrite.mutate(input),
  };
}

export interface SyncPointGuardClient {
  status(): Promise<GuardStatusResult>;
  createSession(input: GuardCreateSessionInput): Promise<GuardSession>;
  validateToken(token: string): Promise<GuardValidateTokenResult>;
}

export function createSyncPointGuardClient(url = DEFAULT_URL): SyncPointGuardClient {
  const client = createSyncPointClient(url);
  return {
    status: () => client.guard.status.query(),
    createSession: (input) => client.guard.createSession.mutate(input),
    validateToken: (token) => client.guard.validateToken.query({ token }),
  };
}

export interface EventStreamHandle {
  close(): void;
}

/**
 * SSE event listener for real-time updates.
 */
export function createEventStream(
  url = DEFAULT_URL,
  onEvent: (data: unknown) => void,
): EventStreamHandle {
  const EventSourceCtor = (globalThis as { EventSource?: typeof EventSource }).EventSource;

  if (typeof EventSourceCtor === "function") {
    const es = new EventSourceCtor(`${url}/events`);
    es.onmessage = (event: MessageEvent<string>) => {
      emitEvent(event.data, onEvent);
    };
    return {
      close: () => es.close(),
    };
  }

  const controller = new AbortController();

  void readSseWithFetch(`${url}/events`, controller, onEvent);

  return {
    close: () => controller.abort(),
  };
}

async function readSseWithFetch(
  eventsUrl: string,
  controller: AbortController,
  onEvent: (data: unknown) => void,
): Promise<void> {
  try {
    const response = await fetch(eventsUrl, { signal: controller.signal });
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (!controller.signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";

      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) emitEvent(data, onEvent);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      onEvent({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function emitEvent(data: string, onEvent: (data: unknown) => void): void {
  try {
    onEvent(JSON.parse(data));
  } catch {
    onEvent(data);
  }
}
