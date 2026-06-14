// ---------------------------------------------------------------------------
// Safety guards — prevent runaway execution
// ---------------------------------------------------------------------------

export class SafetyError extends Error {
  constructor(
    public readonly reason: "max_iterations" | "max_task_failures",
    message: string,
  ) {
    super(message);
    this.name = "SafetyError";
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
