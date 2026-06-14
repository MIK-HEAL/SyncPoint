import { describe, it, expect } from "vitest";
import { SafetyGuard, SafetyError } from "../src/safety.js";

describe("SafetyGuard", () => {
  describe("iteration tracking", () => {
    it("increments iteration counter", () => {
      const guard = new SafetyGuard(10, 3);
      expect(guard.iteration).toBe(0);
      guard.incrementIteration();
      expect(guard.iteration).toBe(1);
      guard.incrementIteration();
      expect(guard.iteration).toBe(2);
    });

    it("throws SafetyError when max iterations exceeded", () => {
      const guard = new SafetyGuard(3, 3);
      guard.incrementIteration(); // 1
      guard.incrementIteration(); // 2
      guard.incrementIteration(); // 3 — this triggers
      expect(() => guard.incrementIteration()).toThrow(SafetyError);
      try {
        guard.incrementIteration();
      } catch (err) {
        expect(err).toBeInstanceOf(SafetyError);
        expect((err as SafetyError).reason).toBe("max_iterations");
      }
    });
  });

  describe("task failure tracking", () => {
    it("records failures and returns count", () => {
      const guard = new SafetyGuard(100, 3);
      const failures = new Map<string, number>();

      expect(guard.recordFailure("task-1", failures)).toBe(1);
      expect(guard.recordFailure("task-1", failures)).toBe(2);
    });

    it("throws SafetyError when max failures exceeded", () => {
      const guard = new SafetyGuard(100, 2);
      const failures = new Map<string, number>();

      guard.recordFailure("task-1", failures); // 1
      expect(() => guard.recordFailure("task-1", failures)).toThrow(SafetyError);

      try {
        guard.recordFailure("task-1", failures); // 2 — triggers
      } catch (err) {
        expect(err).toBeInstanceOf(SafetyError);
        expect((err as SafetyError).reason).toBe("max_task_failures");
      }
    });

    it("recordSuccess resets failure count", () => {
      const guard = new SafetyGuard(100, 3);
      const failures = new Map<string, number>();

      guard.recordFailure("task-1", failures); // 1
      guard.recordFailure("task-1", failures); // 2
      guard.recordSuccess("task-1", failures);
      expect(failures.has("task-1")).toBe(false);

      // Can fail again from scratch
      expect(guard.recordFailure("task-1", failures)).toBe(1);
    });

    it("tracks failures per task independently", () => {
      const guard = new SafetyGuard(100, 3);
      const failures = new Map<string, number>();

      guard.recordFailure("task-1", failures); // task-1: 1
      guard.recordFailure("task-2", failures); // task-2: 1
      guard.recordFailure("task-1", failures); // task-1: 2
      expect(guard.recordFailure("task-2", failures)).toBe(2); // task-2: 2
      // task-1 has 2 failures, task-2 has 2 — neither hit limit of 3
      expect(failures.get("task-1")).toBe(2);
      expect(failures.get("task-2")).toBe(2);
    });
  });
});
