import { describe, it, expect } from "vitest";
import { z } from "zod";
import { EventType, EventSchema } from "../src/events.js";

describe("EventType", () => {
  it("has all required event categories", () => {
    const types = Object.values(EventType);
    // Agent
    expect(types).toContain("AGENT_REGISTERED");
    expect(types).toContain("AGENT_STATUS_CHANGED");
    // Task
    expect(types).toContain("TASK_CREATED");
    expect(types).toContain("TASK_ASSIGNED");
    // Operation
    expect(types).toContain("OPERATION_CREATED");
    expect(types).toContain("OPERATION_APPROVED");
    expect(types).toContain("OPERATION_APPLIED");
    // Write
    expect(types).toContain("WRITE_PERMIT_ISSUED");
    expect(types).toContain("WRITE_PERMIT_DENIED");
    // SyncGate
    expect(types).toContain("SYNC_GATE_CREATED");
    expect(types).toContain("SYNC_GATE_RESOLVED");
    // Resource
    expect(types).toContain("RESOURCE_CLAIMED");
    expect(types).toContain("RESOURCE_RELEASED");
    // Project Memory
    expect(types).toContain("PROJECT_MEMORY_CREATED");
    expect(types).toContain("PROJECT_MEMORY_APPROVED");
    // Wake
    expect(types).toContain("WAKE_CREATED");
    expect(types).toContain("WAKE_DONE");
    // Guard
    expect(types).toContain("GUARD_VIOLATION");
  });

  it("all event type values are unique strings", () => {
    const types = Object.values(EventType);
    const unique = new Set(types);
    expect(unique.size).toBe(types.length);
  });

  it("all values are UPPER_SNAKE_CASE", () => {
    for (const type of Object.values(EventType)) {
      expect(type).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

describe("EventSchema", () => {
  const validEvent = {
    id: "evt_1234567890ab",
    eventType: EventType.TASK_CREATED,
    entityType: "task" as const,
    entityId: "task_1234567890cd",
    detail: "Task created by architect",
    createdAt: "2026-06-01T12:00:00.000Z",
  };

  it("accepts a valid event", () => {
    const result = EventSchema.safeParse(validEvent);
    expect(result.success).toBe(true);
  });

  it("rejects empty id", () => {
    const result = EventSchema.safeParse({ ...validEvent, id: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid entityType", () => {
    const result = EventSchema.safeParse({ ...validEvent, entityType: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid datetime", () => {
    const result = EventSchema.safeParse({ ...validEvent, createdAt: "not-a-date" });
    expect(result.success).toBe(false);
  });

  it("defaults detail to empty string", () => {
    const event = EventSchema.parse({
      id: "evt_1234567890ab",
      eventType: EventType.TASK_CREATED,
      entityType: "task",
      entityId: "task_1234567890cd",
      createdAt: "2026-06-01T12:00:00.000Z",
    });
    expect(event.detail).toBe("");
  });

  it("accepts all valid entity types", () => {
    const validEntities = ["agent", "task", "checkpoint", "handoff", "contract", "context_snapshot", "diary", "agent_message"];
    for (const et of validEntities) {
      const result = EventSchema.safeParse({ ...validEvent, entityType: et });
      expect(result.success).toBe(true);
    }
  });
});
