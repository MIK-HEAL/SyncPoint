import { EventEmitter } from "node:events";
import type { RunnerConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { TaskSource, type SyncPointClient } from "./task-source.js";
import { ClaudeCodeRunner } from "./agent-runner.js";
import { SafetyGuard } from "./safety.js";
import { AgentWorker, type WorkerState, type WorkerSyncPointClient } from "./worker.js";

// ---------------------------------------------------------------------------
// Runner status (public)
// ---------------------------------------------------------------------------

export interface RunnerStatus {
  running: boolean;
  uptime: number;
  workers: Array<{ id: number; agentId: string; state: WorkerState }>;
  totalIterations: number;
}

// ---------------------------------------------------------------------------
// Minimal tRPC client shape for agent creation and SSE
// ---------------------------------------------------------------------------

interface AgentRecord {
  id: string;
  name: string;
  provider: string;
}

interface AgentClient {
  list: { query: () => Promise<AgentRecord[]> };
  create: { mutate: (input: { name: string; provider: string; role: string }) => Promise<{ id: string }> };
}

interface EventClient {
  list: { query: (input: { limit: number }) => Promise<Array<{ eventType: string; entityId?: string }>> };
}

interface MinimalSyncPointClient extends WorkerSyncPointClient {
  agent: AgentClient;
  event: EventClient;
}

// ---------------------------------------------------------------------------
// AutonomousLoopRunner — the main orchestrator
// ---------------------------------------------------------------------------

export class AutonomousLoopRunner {
  private running = false;
  private startedAt = 0;
  private workers: Array<{ id: number; agentId: string; worker: AgentWorker; promise: Promise<void> }> = [];
  private abortController!: AbortController;
  private workEmitter = new EventEmitter();
  private logger: Logger;
  private client!: MinimalSyncPointClient;
  private safety!: SafetyGuard;
  private eventSource: { close(): void } | null = null;

  constructor(private config: RunnerConfig) {
    this.logger = createLogger(config.logLevel, config.logFile);
  }

  /**
   * Start the runner. Creates agents, spawns workers, connects SSE.
   */
  async start(): Promise<void> {
    if (this.running) throw new Error("Runner is already running");

    this.running = true;
    this.startedAt = Date.now();
    this.abortController = new AbortController();
    this.safety = new SafetyGuard(this.config.maxIterations, this.config.maxFailuresPerTask);

    // Create tRPC client
    this.client = createMinimalClient(this.config.serverUrl) as MinimalSyncPointClient;

    this.logger.info("loop runner starting", {
      serverUrl: this.config.serverUrl,
      concurrency: this.config.concurrency,
      maxIterations: this.config.maxIterations,
      dryRun: this.config.dryRun,
    });

    // Connect SSE for reactive wake-up
    this.connectSSE();

    // Create or reuse agents and spawn workers
    await this.spawnWorkers();

    // Set up signal handlers
    const shutdown = () => {
      this.logger.info("received shutdown signal");
      this.shutdown();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Wait for all workers
    await Promise.allSettled(this.workers.map((w) => w.promise));

    this.running = false;
    this.logger.info("loop runner stopped", {
      iterations: this.safety.iteration,
      uptime: Date.now() - this.startedAt,
    });

    // Clean up signal handlers
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }

  /**
   * Signal graceful shutdown to all workers.
   */
  async shutdown(): Promise<void> {
    if (!this.running) return;
    this.logger.info("shutting down workers");
    this.abortController.abort();
    this.eventSource?.close();
  }

  /**
   * Get current status of all workers.
   */
  getStatus(): RunnerStatus {
    return {
      running: this.running,
      uptime: this.running ? Date.now() - this.startedAt : 0,
      workers: this.workers.map((w) => ({
        id: w.id,
        agentId: w.agentId,
        state: w.worker.getState(),
      })),
      totalIterations: this.safety?.iteration ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async spawnWorkers(): Promise<void> {
    // Get existing agents
    let existingAgents: AgentRecord[] = [];
    try {
      existingAgents = await this.client.agent.list.query();
    } catch (err) {
      this.logger.warn("could not list agents", { error: String(err) });
    }

    for (let i = 0; i < this.config.concurrency; i++) {
      const agentName = `${this.config.agentPrefix}-${i}`;

      // Find or create agent
      let agentId: string;
      const existing = existingAgents.find((a) => a.name === agentName);
      if (existing) {
        agentId = existing.id;
        this.logger.info("reusing existing agent", { agentName, agentId });
      } else {
        const created = await this.client.agent.create.mutate({
          name: agentName,
          provider: "claude-code",
          role: "other",
        });
        agentId = created.id;
        this.logger.info("created agent", { agentName, agentId });
      }

      // Create worker
      const taskSource = new TaskSource(this.client as unknown as SyncPointClient, this.config, this.logger);
      const claudeRunner = new ClaudeCodeRunner(this.config, this.logger);
      const childLogger = this.logger.child(`worker-${i}`);

      const waitForNewWork = (): Promise<void> =>
        new Promise((resolve) => {
          this.workEmitter.once("new-work", resolve);
          // Also resolve on abort
          this.abortController.signal.addEventListener("abort", () => resolve(), { once: true });
        });

      const worker = new AgentWorker(
        i,
        this.client as unknown as WorkerSyncPointClient,
        this.config,
        agentId,
        taskSource,
        claudeRunner,
        this.safety,
        childLogger,
        this.abortController,
        waitForNewWork,
      );

      const promise = worker.run();
      this.workers.push({ id: i, agentId, worker, promise });
    }
  }

  private connectSSE(): void {
    try {
      // Use fetch-based SSE to listen for new work events
      const url = `${this.config.serverUrl}/events`;
      const controller = new AbortController();

      fetch(url, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok || !response.body) {
            this.logger.warn("SSE connection failed", { status: response.status });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                try {
                  const event = JSON.parse(line.slice(6));
                  if (
                    event.eventType === "WAKE_CREATED" ||
                    event.eventType === "TASK_CREATED" ||
                    event.eventType === "TASK_ASSIGNED"
                  ) {
                    this.logger.debug("SSE event: new work available", { eventType: event.eventType });
                    this.workEmitter.emit("new-work");
                  }
                } catch {
                  // ignore parse errors (heartbeats, etc.)
                }
              }
            }
          }
        })
        .catch((err: Error) => {
          if (err.name !== "AbortError") {
            this.logger.debug("SSE connection error", { error: err.message });
          }
        });

      this.eventSource = { close: () => controller.abort() };
      this.logger.info("SSE event stream connected", { url });
    } catch (err) {
      this.logger.warn("could not connect SSE, falling back to polling only", { error: String(err) });
    }
  }
}

// ---------------------------------------------------------------------------
// Minimal tRPC client factory (avoids importing full SDK at runtime)
// ---------------------------------------------------------------------------

/**
 * Creates a minimal tRPC HTTP client that matches the shape the runner needs.
 * This avoids pulling in the full SDK dependency at build time and keeps
 * the runner decoupled. For production use, import createSyncPointClient from syncpoint-sdk.
 */
function createMinimalClient(baseUrl: string): MinimalSyncPointClient {
  const trpcUrl = `${baseUrl}/trpc`;

  async function call(path: string, type: "query" | "mutation", input?: unknown): Promise<unknown> {
    const url = new URL(`${trpcUrl}/${path}`);
    if (type === "query" && input) {
      url.searchParams.set("input", JSON.stringify(input));
    }

    const response = await fetch(url.toString(), {
      method: type === "query" ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "x-caller-id": "loop-runner",
      },
      ...(type === "mutation" ? { body: JSON.stringify({ 0: input }) } : {}),
    });

    if (!response.ok) {
      throw new Error(`tRPC ${type} ${path} failed: ${response.status}`);
    }

    const json = (await response.json()) as { result?: { data?: unknown } };
    return json.result?.data;
  }

  function createProxy(prefix: string): Record<string, unknown> {
    return new Proxy({}, {
      get(_target, prop: string) {
        if (prop === "query") return (input?: unknown) => call(prefix, "query", input);
        if (prop === "mutate") return (input?: unknown) => call(prefix, "mutation", input);
        // Nested router — return another proxy
        return createProxy(`${prefix}.${prop}`);
      },
    });
  }

  return createProxy("") as unknown as MinimalSyncPointClient;
}
