/**
 * E2E: SSE event stream delivers real-time events.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "./e2e-helper.ts";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("SSE flow", () => {
  it("receives events via SSE stream", async () => {
    const events: any[] = [];
    const controller = new AbortController();

    // Start listening
    const streamPromise = fetch(`${ctx.baseUrl}/events`, { signal: controller.signal })
      .then(async (res) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Parse SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop()!; // keep incomplete line
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                events.push(JSON.parse(line.slice(6)));
              } catch { /* ignore parse errors */ }
            }
          }
          // Stop after we get a few events
          if (events.length >= 3) break;
        }
      })
      .catch(() => { /* abort expected */ });

    // Wait for connection
    await new Promise((r) => setTimeout(r, 100));

    // Trigger events
    await ctx.rpc("agent.create", { name: "sse-test", provider: "codex", role: "backend" });
    const t = (await ctx.rpc("task.create", { title: "SSE task" })) as any;

    // Wait a bit for events to arrive
    await new Promise((r) => setTimeout(r, 200));
    controller.abort();
    await streamPromise;

    // Should have received the "connected" event plus at least one real event
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0].type).toBe("connected");
  });
});
