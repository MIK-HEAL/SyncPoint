// ---------------------------------------------------------------------------
// Safety guards — prevent runaway execution
// ---------------------------------------------------------------------------

import { SyncPointError } from "syncpoint-kernel";

export class SafetyError extends SyncPointError {
  readonly code = "LOOP_SAFETY_LIMIT";
  readonly httpStatus = 429;
  readonly retryable = false;
  readonly suggestion = "Reduce the workload or increase the configured safety limit before retrying.";
  readonly userMessage: string;

  constructor(
    public readonly reason: "max_iterations" | "max_task_failures",
    message: string,
  ) {
    super(message);
    this.name = "SafetyError";
    this.userMessage = reason === "max_iterations"
      ? "The loop stopped after reaching its iteration safety limit"
      : "The loop stopped after a task exceeded its failure safety limit";
  }
}

export class SafetyGuard {
  private _iteration = 0;

  constructor(
    private maxIterations: number,
    private maxFailuresPerTask: number,
  ) {}

  get iteration(): number {
    return this._iteration;
  }

  incrementIteration(): void {
    this._iteration++;
    if (this._iteration > this.maxIterations) {
      throw new SafetyError(
        "max_iterations",
        `Global iteration limit reached (${this.maxIterations}). Stopping.`,
      );
    }
  }

  recordFailure(taskId: string, failures: Map<string, number>): number {
    const next = (failures.get(taskId) ?? 0) + 1;
    failures.set(taskId, next);
    if (next >= this.maxFailuresPerTask) {
      throw new SafetyError(
        "max_task_failures",
        `Task ${taskId} exceeded failure limit (${this.maxFailuresPerTask}). Giving up.`,
      );
    }
    return next;
  }

  recordSuccess(taskId: string, failures: Map<string, number>): void {
    failures.delete(taskId);
  }
}
