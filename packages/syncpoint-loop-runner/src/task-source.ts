import type { RunnerConfig } from "./config.js";
import type { Logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkItem {
  kind: "task" | "wake";
  taskId: string;
  agentId: string;
  wakeRequestId?: string;
  title?: string;
}

/** Minimal typed shape of the tRPC client we actually use. */
export interface SyncPointClient {
  wake: {
    next: { query: (input: { agentId: string }) => Promise<WakeRequest | null> };
  };
  task: {
    list: { query: () => Promise<TaskRecord[]> };
    assign: { mutate: (input: { taskId: string; agentId: string }) => Promise<unknown> };
  };
  constraint: {
    check: { query: (input: { action: string; taskId?: string; agentId?: string }) => Promise<ConstraintResult> };
  };
}

export interface WakeRequest {
  id: string;
  taskId: string | null;
  status: string;
  targetAgentId: string | null;
  action: string | null;
}

export interface TaskRecord {
  id: string;
  title: string;
  description: string | null;
  status: string;
  ownerAgentId: string | null;
}

export interface ConstraintResult {
  blocked: boolean;
  violations: string[];
}

// ---------------------------------------------------------------------------
// TaskSource — discovers what work the runner should do next
// ---------------------------------------------------------------------------

export class TaskSource {
  constructor(
    private client: SyncPointClient,
    private config: RunnerConfig,
    private logger: Logger,
  ) {}

  /**
   * Find the next executable work item for the given agent.
   * Priority: (1) wake requests targeting this agent, (2) open/assigned tasks.
   */
  async nextWorkItem(agentId: string): Promise<WorkItem | null> {
    // 1. Check wake requests first
    const wake = await this.client.wake.next.query({ agentId });
    if (wake?.taskId) {
      this.logger.info("found wake request", {
        wakeId: wake.id,
        taskId: wake.taskId,
        action: wake.action,
      });
      return {
        kind: "wake",
        taskId: wake.taskId,
        agentId,
        wakeRequestId: wake.id,
      };
    }

    // 2. Query available tasks
    const tasks = await this.client.task.list.query();
    const candidates = tasks.filter((t) => {
      if (t.status === "OPEN") return true;
      if (t.status === "ASSIGNED" && t.ownerAgentId === agentId) return true;
      return false;
    });

    // 3. Apply task filter
    const filtered = this.applyFilter(candidates);
    if (filtered.length === 0) return null;

    // 4. Try to atomically claim the first candidate
    for (const task of filtered) {
      try {
        if (task.status === "OPEN") {
          // Attempt to assign — this is the atomic claim
          await this.client.task.assign.mutate({ taskId: task.id, agentId });
        }
        return { kind: "task", taskId: task.id, agentId, title: task.title };
      } catch {
        // Task already claimed by another worker — try next
        this.logger.debug("task already claimed, trying next", { taskId: task.id });
      }
    }

    return null;
  }

  /**
   * List all tasks that are candidates for execution (informational).
   */
  async availableTasks(): Promise<TaskRecord[]> {
    const tasks = await this.client.task.list.query();
    return this.applyFilter(tasks);
  }

  private applyFilter(tasks: TaskRecord[]): TaskRecord[] {
    const filter = this.config.taskFilter;
    if (!filter) return tasks;

    return tasks.filter((t) => {
      if (filter.titlePattern) {
        const regex = new RegExp(filter.titlePattern, "i");
        if (!regex.test(t.title)) return false;
      }
      return true;
    });
  }
}
