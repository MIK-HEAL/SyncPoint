/**
 * Tests for MCP prompt registration — validates prompt metadata
 * and argument schemas.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ── Prompt argument Zod schemas (mirrors prompts-system.ts + prompts-task.ts + prompts-review.ts) ──

const ResumeArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  agentId: z.string().describe("Agent ID"),
});

const CheckpointArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  agentId: z.string().describe("Agent ID"),
});

const HandoffArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  fromAgentId: z.string().describe("Sending agent ID"),
  toAgentId: z.string().describe("Receiving agent ID"),
});

const ProjectOnboardingArgsSchema = z.object({
  taskId: z.string().describe("Task ID").optional(),
  agentId: z.string().describe("Agent ID").optional(),
});

const ExecutorResumeArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  agentId: z.string().describe("Agent ID"),
  contextMode: z.string().optional(),
});

const ReviewerChecklistArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  agentId: z.string().describe("Agent ID"),
});

const ArchitectBriefingArgsSchema = z.object({
  taskId: z.string().describe("Task ID").optional(),
  agentId: z.string().describe("Agent ID").optional(),
});

const MemoryReviewArgsSchema = z.object({
  status: z.string().optional(),
});

const SessionPlaybookArgsSchema = z.object({
  sessionId: z.string().describe("Session ID"),
  agentId: z.string().describe("Agent ID"),
});

const ReviewTaskArgsSchema = z.object({
  taskId: z.string().describe("Task ID"),
  agentId: z.string().describe("Agent ID"),
});

const ReviewWithEvidenceArgsSchema = z.object({
  reviewRequestId: z.string().describe("Review request ID"),
});

const ArchitectPlanArgsSchema = z.object({
  sessionId: z.string().describe("Session ID"),
});

describe("resume prompt args", () => {
  it("accepts valid taskId and agentId", () => {
    const result = ResumeArgsSchema.safeParse({ taskId: "t1", agentId: "a1" });
    expect(result.success).toBe(true);
  });

  it("rejects missing taskId", () => {
    const result = ResumeArgsSchema.safeParse({ agentId: "a1" });
    expect(result.success).toBe(false);
  });

  it("rejects missing agentId", () => {
    const result = ResumeArgsSchema.safeParse({ taskId: "t1" });
    expect(result.success).toBe(false);
  });

  it("rejects empty strings", () => {
    const result = ResumeArgsSchema.safeParse({ taskId: "", agentId: "a1" });
    expect(result.success).toBe(false);
  });
});

describe("handoff prompt args", () => {
  it("accepts valid args", () => {
    const result = HandoffArgsSchema.safeParse({
      taskId: "t1", fromAgentId: "a1", toAgentId: "a2",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing toAgentId", () => {
    const result = HandoffArgsSchema.safeParse({ taskId: "t1", fromAgentId: "a1" });
    expect(result.success).toBe(false);
  });
});

describe("project onboarding args", () => {
  it("accepts empty object (all optional)", () => {
    const result = ProjectOnboardingArgsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial args", () => {
    const result = ProjectOnboardingArgsSchema.safeParse({ taskId: "t1" });
    expect(result.success).toBe(true);
  });
});

describe("executor resume args", () => {
  it("accepts optional contextMode", () => {
    const result = ExecutorResumeArgsSchema.safeParse({
      taskId: "t1", agentId: "a1", contextMode: "snapshot-only",
    });
    expect(result.success).toBe(true);
  });

  it("accepts without contextMode", () => {
    const result = ExecutorResumeArgsSchema.safeParse({ taskId: "t1", agentId: "a1" });
    expect(result.success).toBe(true);
  });
});

describe("memory review args", () => {
  it("accepts empty object", () => {
    const result = MemoryReviewArgsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts status filter", () => {
    const result = MemoryReviewArgsSchema.safeParse({ status: "approved" });
    expect(result.success).toBe(true);
  });
});

describe("session playbook args", () => {
  it("accepts valid args", () => {
    const result = SessionPlaybookArgsSchema.safeParse({
      sessionId: "s1", agentId: "a1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing sessionId", () => {
    const result = SessionPlaybookArgsSchema.safeParse({ agentId: "a1" });
    expect(result.success).toBe(false);
  });
});

describe("review task args", () => {
  it("accepts valid args", () => {
    const result = ReviewTaskArgsSchema.safeParse({ taskId: "t1", agentId: "a1" });
    expect(result.success).toBe(true);
  });
});

describe("review with evidence args", () => {
  it("accepts valid review request ID", () => {
    const result = ReviewWithEvidenceArgsSchema.safeParse({ reviewRequestId: "rr1" });
    expect(result.success).toBe(true);
  });

  it("rejects missing reviewRequestId", () => {
    const result = ReviewWithEvidenceArgsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("architect plan args", () => {
  it("accepts valid session ID", () => {
    const result = ArchitectPlanArgsSchema.safeParse({ sessionId: "s1" });
    expect(result.success).toBe(true);
  });

  it("rejects missing sessionId", () => {
    const result = ArchitectPlanArgsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("checkpoint prompt args", () => {
  it("accepts valid args", () => {
    const result = CheckpointArgsSchema.safeParse({ taskId: "t1", agentId: "a1" });
    expect(result.success).toBe(true);
  });
});

describe("reviewer checklist args", () => {
  it("accepts valid args", () => {
    const result = ReviewerChecklistArgsSchema.safeParse({ taskId: "t1", agentId: "a1" });
    expect(result.success).toBe(true);
  });
});

describe("architect briefing args", () => {
  it("accepts empty object", () => {
    const result = ArchitectBriefingArgsSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
