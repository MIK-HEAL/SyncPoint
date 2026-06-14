import { describe, it, expect, vi } from "vitest";
import { TaskSource, type SyncPointClient, type WakeRequest, type TaskRecord } from "../src/task-source.js";
import { RunnerConfigSchema } from "../src/config.js";
import { createLogger } from "../src/logger.js";

function createMockClient(overrides: Partial<{
  wakeNext: WakeRequest | null;
  taskList: TaskRecord[];
  assignError: Error | null;
}> = {}): SyncPointClient {
  return {
    wake: {
      next: { query: vi.fn().mockResolvedValue(overrides.wakeNext ?? null) },
    },
    task: {
      list: { query: vi.fn().mockResolvedValue(overrides.taskList ?? []) },
      assign: {
        mutate: overrides.assignError
          ? vi.fn().mockRejectedValue(overrides.assignError)
          : vi.fn().mockResolvedValue({}),
      },
    },
    constraint: {
      check: { query: vi.fn().mockResolvedValue({ blocked: false, violations: [] }) },
    },
  } as unknown as SyncPointClient;
}

const config = RunnerConfigSchema.parse({});
const logger = createLogger("error"); // quiet in tests

describe("TaskSource", () => {
  describe("nextWorkItem", () => {
    it("returns wake request with highest priority", async () => {
      const client = createMockClient({
        wakeNext: { id: "wake-1", taskId: "task-1", status: "QUEUED", targetAgentId: "agent-1", action: "checkpoint" },
        taskList: [{ id: "task-2", title: "Other task", status: "OPEN", description: null, ownerAgentId: null }],
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).not.toBeNull();
      expect(item!.kind).toBe("wake");
      expect(item!.taskId).toBe("task-1");
      expect(item!.wakeRequestId).toBe("wake-1");
    });

    it("returns open task when no wake requests", async () => {
      const client = createMockClient({
        taskList: [
          { id: "task-1", title: "Fix bug", status: "OPEN", description: null, ownerAgentId: null },
          { id: "task-2", title: "Add feature", status: "OPEN", description: null, ownerAgentId: null },
        ],
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).not.toBeNull();
      expect(item!.kind).toBe("task");
      expect(item!.taskId).toBe("task-1");
    });

    it("returns task assigned to this agent", async () => {
      const client = createMockClient({
        taskList: [
          { id: "task-1", title: "My task", status: "ASSIGNED", description: null, ownerAgentId: "agent-1" },
        ],
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).not.toBeNull();
      expect(item!.taskId).toBe("task-1");
    });

    it("skips tasks assigned to other agents", async () => {
      const client = createMockClient({
        taskList: [
          { id: "task-1", title: "Other's task", status: "ASSIGNED", description: null, ownerAgentId: "agent-2" },
        ],
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).toBeNull();
    });

    it("skips DONE tasks", async () => {
      const client = createMockClient({
        taskList: [
          { id: "task-1", title: "Done task", status: "DONE", description: null, ownerAgentId: null },
        ],
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).toBeNull();
    });

    it("returns null when no work available", async () => {
      const client = createMockClient({ taskList: [] });
      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");
      expect(item).toBeNull();
    });

    it("skips tasks that fail to assign (already claimed)", async () => {
      const client = createMockClient({
        taskList: [
          { id: "task-1", title: "Claimed", status: "OPEN", description: null, ownerAgentId: null },
          { id: "task-2", title: "Available", status: "OPEN", description: null, ownerAgentId: null },
        ],
        assignError: new Error("already assigned"),
      });

      // Override assign to fail on first call, succeed on second
      let callCount = 0;
      (client.task.assign.mutate as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++;
        if (callCount === 1) return Promise.reject(new Error("already assigned"));
        return Promise.resolve({});
      });

      const source = new TaskSource(client, config, logger);
      const item = await source.nextWorkItem("agent-1");

      expect(item).not.toBeNull();
      expect(item!.taskId).toBe("task-2");
    });
  });

  describe("availableTasks", () => {
    it("lists all tasks (unfiltered)", async () => {
      const tasks: TaskRecord[] = [
        { id: "task-1", title: "Fix bug", status: "OPEN", description: null, ownerAgentId: null },
        { id: "task-2", title: "Add feature", status: "DONE", description: null, ownerAgentId: null },
      ];
      const client = createMockClient({ taskList: tasks });

      const source = new TaskSource(client, config, logger);
      const result = await source.availableTasks();
      expect(result).toHaveLength(2);
    });

    it("filters by title pattern", async () => {
      const tasks: TaskRecord[] = [
        { id: "task-1", title: "Fix auth bug", status: "OPEN", description: null, ownerAgentId: null },
        { id: "task-2", title: "Add dark mode", status: "OPEN", description: null, ownerAgentId: null },
      ];
      const client = createMockClient({ taskList: tasks });
      const filterConfig = RunnerConfigSchema.parse({ taskFilter: { titlePattern: "bug" } });

      const source = new TaskSource(client, filterConfig, logger);
      const result = await source.availableTasks();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("task-1");
    });
  });
});
