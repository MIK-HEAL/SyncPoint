import type { RunnerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import type { WorkItem } from "./task-source.js";
import { TaskSource } from "./task-source.js";
import { ClaudeCodeRunner, extractSummary, extractProgress, extractNextSteps } from "./agent-runner.js";
import { SafetyGuard, SafetyError } from "./safety.js";

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

export type WorkerState =
  | { status: "idle" }
  | { status: "working"; taskId: string; startedAt: number }
  | { status: "blocked"; taskId: string; gateIds: string[] }
  | { status: "error"; taskId: string; error: string }
  | { status: "shutdown" };

// ---------------------------------------------------------------------------
// SyncPoint tRPC surface the worker uses (superset of TaskSource)
// ---------------------------------------------------------------------------

interface LoopClient {
  boot: { mutate: (input: { agentId: string; taskId: string; provider?: string }) => Promise<BootResult> };
  resume: { mutate: (input: ResumeInput) => Promise<ResumeResult> };
  checkpoint: { mutate: (input: CheckpointInput) => Promise<CheckpointResult> };
}

interface BootResult {
  contextReady: boolean;
  warnings?: string[];
}

interface ResumeInput {
  agentId: string;
  taskId: string;
  provider?: string;
  format?: string;
  contextMode?: string;
  sessionId?: string;
}

interface ResumeResult {
  prompt: string;
  protocolGateBlocked?: boolean;
  gateIds?: string[];
  constraintWarnings?: string[];
}

interface CheckpointInput {
  agentId: string;
  taskId: string;
  summary: string;
  progress?: string;
  nextSteps?: string;
  provider?: string;
  needSync?: boolean;
}

interface CheckpointResult {
  checkpointId: string;
  snapshotId?: string;
}

interface WakeClient {
  next: { query: (input: { agentId: string }) => Promise<unknown> };
  ack: { mutate: (input: { id: string }) => Promise<unknown> };
  start: { mutate: (input: { id: string }) => Promise<unknown> };
  done: { mutate: (input: { id: string; resultSummary?: string }) => Promise<unknown> };
  fail: { mutate: (input: { id: string; resultSummary?: string }) => Promise<unknown> };
}

interface SyncGateClient {
  vote: { mutate: (input: { gateId: string; agentId: string; vote: string; summary?: string }) => Promise<unknown> };
}

interface TaskClient {
  list: { query: () => Promise<Array<{ id: string; status: string; ownerAgentId: string | null; title: string; description: string | null }>> };
  get: { query: (input: { id: string }) => Promise<{ status: string } | null> };
  assign: { mutate: (input: { taskId: string; agentId: string }) => Promise<unknown> };
}

export interface WorkerSyncPointClient {
  loop: LoopClient;
  wake: WakeClient;
  syncGate: SyncGateClient;
  task: TaskClient;
}

// ---------------------------------------------------------------------------
// AgentWorker — single autonomous agent loop
// ---------------------------------------------------------------------------

export class AgentWorker {
  private _state: WorkerState = { status: "idle" };
  private taskFailures = new Map<string, number>();

  constructor(
    private workerId: number,
    private client: WorkerSyncPointClient,
    private config: RunnerConfig,
    private agentId: string,
    private taskSource: TaskSource,
    private runner: ClaudeCodeRunner,
    private safety: SafetyGuard,
    private logger: Logger,
    private abortController: AbortController,
    private waitForNewWork?: () => Promise<void>,
  ) {}

  getState(): WorkerState {
    return this._state;
  }

  /**
   * Main loop. Runs until shutdown signal, max iterations, or no more work.
   */
  async run(): Promise<void> {
    this.logger.info("worker started", { agentId: this.agentId });

    while (!this.abortController.signal.aborted) {
      try {
        this.safety.incrementIteration();
      } catch (err) {
        if (err instanceof SafetyError) {
          this.logger.error("safety guard triggered", { reason: err.reason, message: err.message });
          break;
        }
        throw err;
      }

      // 1. Query for next work
      let workItem: WorkItem | null;
      try {
        workItem = await this.taskSource.nextWorkItem(this.agentId);
      } catch (err) {
        this.logger.error("failed to query work", { error: String(err) });
        await this.sleep(this.config.pollInterval);
        continue;
      }

      if (!workItem) {
        this.logger.debug("no work available, waiting");
        await this.waitForWork();
        continue;
      }

      this._state = { status: "working", taskId: workItem.taskId, startedAt: Date.now() };
      this.logger.info("picked up work item", {
        kind: workItem.kind,
        taskId: workItem.taskId,
        title: workItem.title,
      });

      try {
        if (workItem.kind === "wake" && workItem.wakeRequestId) {
          await this.handleWake(workItem);
        } else {
          await this.handleTask(workItem);
        }
      } catch (err) {
        if (err instanceof SafetyError) {
          this.logger.error("safety guard triggered in task", {
            reason: err.reason,
            taskId: workItem.taskId,
          });
          if (err.reason === "max_iterations") break;
          // max_task_failures — continue to next task
        } else {
          this.logger.error("unexpected error in worker loop", {
            error: String(err),
            taskId: workItem.taskId,
          });
          this.safety.recordFailure(workItem.taskId, this.taskFailures);
        }
      } finally {
        this._state = { status: "idle" };
      }
    }

    this._state = { status: "shutdown" };
    this.logger.info("worker stopped", { agentId: this.agentId });
  }

  // ---------------------------------------------------------------------------
  // Handle a regular task
  // ---------------------------------------------------------------------------

  private async handleTask(workItem: WorkItem): Promise<void> {
    if (this.config.dryRun) {
      this.logger.info("[dry-run] would execute task", { taskId: workItem.taskId });
      return;
    }

    // Boot the agent on the task
    const bootResult = await this.client.loop.boot.mutate({
      agentId: this.agentId,
      taskId: workItem.taskId,
      provider: "claude-code",
    });
    this.logger.info("agent booted", {
      taskId: workItem.taskId,
      contextReady: bootResult.contextReady,
      warnings: bootResult.warnings,
    });

    // Get resume prompt
    const resumeResult = await this.client.loop.resume.mutate({
      agentId: this.agentId,
      taskId: workItem.taskId,
      provider: "claude-code",
      format: "system-prompt",
      contextMode: "snapshot-first",
    });

    // Check for sync gate blocks
    if (resumeResult.protocolGateBlocked) {
      const gateIds = resumeResult.gateIds ?? [];
      this._state = { status: "blocked", taskId: workItem.taskId, gateIds };
      this.logger.warn("blocked by sync gate", { gateIds });

      if (this.config.escalateOnBlock) {
        for (const gateId of gateIds) {
          try {
            await this.client.syncGate.vote.mutate({
              gateId,
              agentId: this.agentId,
              vote: "escalate",
              summary: `Loop runner worker ${this.workerId} blocked by gate`,
            });
          } catch (err) {
            this.logger.warn("failed to escalate gate", { gateId, error: String(err) });
          }
        }
      }
      return;
    }

    // Check constraint warnings
    const blockedWarnings = (resumeResult.constraintWarnings ?? []).filter((w) =>
      w.startsWith("[BLOCKED]"),
    );
    if (blockedWarnings.length > 0) {
      this.logger.warn("constraint blocked", { warnings: blockedWarnings });
      return;
    }

    // Spawn Claude Code
    const runResult = await this.runner.run(resumeResult.prompt);

    if (runResult.timedOut) {
      this.logger.error("claude timed out", { taskId: workItem.taskId, durationMs: runResult.durationMs });
      this.safety.recordFailure(workItem.taskId, this.taskFailures);
      return;
    }

    if (runResult.exitCode === 0) {
      // Checkpoint the results
      const checkpointResult = await this.client.loop.checkpoint.mutate({
        agentId: this.agentId,
        taskId: workItem.taskId,
        summary: extractSummary(runResult.stdout),
        progress: extractProgress(runResult.stdout),
        nextSteps: extractNextSteps(runResult.stdout),
        provider: "claude-code",
      });
      this.safety.recordSuccess(workItem.taskId, this.taskFailures);
      this.logger.info("checkpoint saved", {
        taskId: workItem.taskId,
        checkpointId: checkpointResult.checkpointId,
        durationMs: runResult.durationMs,
      });

      // Check if task is now done
      try {
        const taskStatus = await this.client.task.get.query({ id: workItem.taskId });
        if (taskStatus?.status === "DONE") {
          this.logger.info("task completed", { taskId: workItem.taskId });
        }
      } catch {
        // non-critical — just log and continue
        this.logger.debug("could not check task status after checkpoint");
      }
    } else {
      const failures = this.safety.recordFailure(workItem.taskId, this.taskFailures);
      this.logger.warn("claude exited with error", {
        exitCode: runResult.exitCode,
        failures,
        stderr: runResult.stderr.slice(0, 500),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Handle a wake request
  // ---------------------------------------------------------------------------

  private async handleWake(workItem: WorkItem): Promise<void> {
    const wakeId = workItem.wakeRequestId!;

    if (this.config.dryRun) {
      this.logger.info("[dry-run] would process wake", { wakeId, taskId: workItem.taskId });
      return;
    }

    try {
      await this.client.wake.ack.mutate({ id: wakeId });
      await this.client.wake.start.mutate({ id: wakeId });
    } catch (err) {
      this.logger.warn("failed to ack/start wake", { wakeId, error: String(err) });
      return;
    }

    // Boot and resume
    try {
      await this.client.loop.boot.mutate({
        agentId: this.agentId,
        taskId: workItem.taskId,
        provider: "claude-code",
      });

      const resumeResult = await this.client.loop.resume.mutate({
        agentId: this.agentId,
        taskId: workItem.taskId,
        provider: "claude-code",
        format: "system-prompt",
        contextMode: "snapshot-first",
      });

      if (resumeResult.protocolGateBlocked) {
        await this.client.wake.fail.mutate({ id: wakeId, resultSummary: "Blocked by sync gate" });
        return;
      }

      // Execute
      const runResult = await this.runner.run(resumeResult.prompt);

      if (runResult.exitCode === 0) {
        await this.client.loop.checkpoint.mutate({
          agentId: this.agentId,
          taskId: workItem.taskId,
          summary: extractSummary(runResult.stdout),
          progress: extractProgress(runResult.stdout),
          nextSteps: extractNextSteps(runResult.stdout),
          provider: "claude-code",
        });
        await this.client.wake.done.mutate({
          id: wakeId,
          resultSummary: extractSummary(runResult.stdout),
        });
        this.safety.recordSuccess(workItem.taskId, this.taskFailures);
        this.logger.info("wake completed", { wakeId, taskId: workItem.taskId });
      } else {
        await this.client.wake.fail.mutate({
          id: wakeId,
          resultSummary: `exit code ${runResult.exitCode}`,
        });
        this.safety.recordFailure(workItem.taskId, this.taskFailures);
        this.logger.warn("wake task failed", { wakeId, exitCode: runResult.exitCode });
      }
    } catch (err) {
      await this.client.wake.fail.mutate({ id: wakeId, resultSummary: String(err) }).catch(() => {});
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Wait for work — SSE wake-up or poll interval
  // ---------------------------------------------------------------------------

  private async waitForWork(): Promise<void> {
    if (this.waitForNewWork) {
      await Promise.race([this.sleep(this.config.pollInterval), this.waitForNewWork()]);
    } else {
      await this.sleep(this.config.pollInterval);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abortController.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    });
  }
}
