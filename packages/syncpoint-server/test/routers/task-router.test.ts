/**
 * Tests for task router — Task CRUD operations.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {  } from "syncpoint-server";
import * as repo from "../../src/repositories/_exports/foundation.js";
import { TaskStatus } from "syncpoint-adapters";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-rtr-task-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  defaultContext.db;
});

afterAll(() => {
  defaultContext.destroy();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("task router — CRUD", () => {
  it("creates a task with title", () => {
    const task = repo.createTask({ title: "Router task", description: "Test" });
    expect(task.id).toBeTruthy();
    expect(task.title).toBe("Router task");
    expect(task.status).toBe(TaskStatus.OPEN);
  });

  it("lists tasks", () => {
    const tasks = repo.listTasks();
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("gets task by ID", () => {
    const task = repo.createTask({ title: "Gettable task" });
    const found = repo.getTask(task.id);
    expect(found.title).toBe("Gettable task");
  });

  it("updates task status", () => {
    const task = repo.createTask({ title: "Status update test" });
    const updated = repo.updateTaskStatus(task.id, TaskStatus.IN_PROGRESS);
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
  });
});

describe("task router — input validation", () => {
  it("rejects empty title", () => {
    expect(() => repo.createTask({ title: "" })).toThrow();
  });

  it("rejects unknown task ID", () => {
    expect(() => repo.getTask("nonexistent-task-id")).toThrow();
  });
});
