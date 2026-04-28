/**
 * MCP prompts — reusable prompt templates for LLM interactions.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatResumePrompt } from "syncpoint-core";
import { getResumeContext } from "syncpoint-server/repositories";
import { pmList, prepareContext, orchGetSessionStatus, rwPrepareReviewPacket, pbGetNextAction } from "syncpoint-server/application";
import { formatProjectMemorySummary } from "./format.js";

export function registerPrompts(server: McpServer): void {
  // ── syncpoint_resume ──
  server.registerPrompt(
    "syncpoint_resume",
    {
      title: "Resume Task",
      description: "Generate a full resume prompt for an agent to continue a task. Includes task state, contract, checkpoint, capsule, pinned memories, and project knowledge.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        agentId: z.string().describe("Agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const ctx = getResumeContext(taskId, agentId);
      const prompt = formatResumePrompt(ctx, "system-prompt");
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prompt } },
        ],
      };
    }
  );

  // ── syncpoint_checkpoint ──
  server.registerPrompt(
    "syncpoint_checkpoint",
    {
      title: "Checkpoint Guide",
      description: "Guide an agent to produce a structured checkpoint with all required fields.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        agentId: z.string().describe("Agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const ctx = getResumeContext(taskId, agentId);
      const text = [
        "You are about to save a checkpoint for SyncPoint. Please provide the following information:",
        "",
        `**Task**: ${ctx.task.title} (${ctx.task.status})`,
        `**Agent**: ${ctx.agent.name}`,
        "",
        "Required fields:",
        "- **summary**: A brief summary of what you accomplished in this session",
        "- **progress**: What percentage / phase of the task is complete",
        "- **nextSteps**: What should be done next",
        "",
        "Optional fields:",
        "- **risks**: Any risks or concerns",
        "- **blockers**: Anything blocking progress",
        "- **goal**: Current overarching goal",
        "- **phase**: Current development phase",
        "- **completed**: Work completed this session",
        "- **remaining**: Work still to be done",
        "- **workingFiles**: Key files currently being modified",
        "- **needSync**: Set true if another agent needs to review before continuing",
        "",
        "Once you have the information, call the `syncpoint_loop_checkpoint` tool.",
      ].join("\n");
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    }
  );

  // ── syncpoint_handoff ──
  server.registerPrompt(
    "syncpoint_handoff",
    {
      title: "Handoff Guide",
      description: "Guide an agent to produce a structured handoff to another agent.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        fromAgentId: z.string().describe("Sending agent ID"),
        toAgentId: z.string().describe("Receiving agent ID"),
      },
    },
    ({ taskId, fromAgentId, toAgentId }) => {
      const ctx = getResumeContext(taskId, fromAgentId);
      const text = [
        `You are handing off task **${ctx.task.title}** to another agent.`,
        "",
        `- **From**: ${fromAgentId}`,
        `- **To**: ${toAgentId}`,
        "",
        "Please provide a **context** string that includes:",
        "1. What has been completed",
        "2. Current state and any important decisions made",
        "3. What the receiving agent should do next",
        "4. Any known risks or blockers",
        "",
        "Once ready, call the `syncpoint_loop_handoff` tool.",
      ].join("\n");
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    }
  );

  // ── syncpoint_project_onboarding ──
  server.registerPrompt(
    "syncpoint_project_onboarding",
    {
      title: "Project Onboarding",
      description: "Onboard a new agent by providing all approved project memories and current task context.",
      argsSchema: {
        taskId: z.string().describe("Task ID").optional(),
        agentId: z.string().describe("Agent ID").optional(),
      },
    },
    ({ taskId, agentId }) => {
      const mems = pmList({ status: "approved" });
      const memSection = mems.length > 0
        ? mems.map(formatProjectMemorySummary).join("\n\n")
        : "No approved project memories yet.";

      let taskSection = "";
      if (taskId && agentId) {
        try {
          const ctx = getResumeContext(taskId, agentId);
          taskSection = [
            "",
            "---",
            "",
            "## Current Task Context",
            "",
            formatResumePrompt(ctx, "system-prompt"),
          ].join("\n");
        } catch { /* task/agent not found — skip */ }
      }

      const text = [
        "# Project Onboarding",
        "",
        "Welcome to this project. Here is the curated project knowledge:",
        "",
        "## Project Memory",
        "",
        memSection,
        taskSection,
      ].join("\n");

      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    }
  );

  // ── syncpoint_memory_review ──
  server.registerPrompt(
    "syncpoint_memory_review",
    {
      title: "Memory Review",
      description: "Review all project memories (draft, approved, deprecated) for curation and cleanup.",
    },
    () => {
      const all = pmList();
      const draft = all.filter(m => m.status === "draft");
      const approved = all.filter(m => m.status === "approved");
      const deprecated = all.filter(m => m.status === "deprecated");

      const text = [
        "# Project Memory Review",
        "",
        `Total: ${all.length} memories (${draft.length} draft, ${approved.length} approved, ${deprecated.length} deprecated)`,
        "",
        "## Draft (needs review)",
        "",
        ...(draft.length > 0 ? draft.map(formatProjectMemorySummary) : ["None."]),
        "",
        "## Approved (active in context)",
        "",
        ...(approved.length > 0 ? approved.map(formatProjectMemorySummary) : ["None."]),
        "",
        "## Deprecated",
        "",
        ...(deprecated.length > 0 ? deprecated.map(formatProjectMemorySummary) : ["None."]),
        "",
        "---",
        "",
        "Actions you can take:",
        "- `syncpoint_project_memory_approve` — approve a draft memory",
        "- `syncpoint_project_memory_add` — add new project knowledge",
        "- `syncpoint_project_memory_export` — export to .syncpoint/project-memory.md",
      ].join("\n");

      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    }
  );

  // ── syncpoint_executor_resume ──
  server.registerPrompt(
    "syncpoint_executor_resume",
    {
      title: "Executor Resume",
      description: "Resume prompt specifically for executor role — includes hard gate enforcement and full task context.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        agentId: z.string().describe("Agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "resume", role: "executor", taskId, agentId });
      let text = prepared.prompt;
      if (!prepared.ready) {
        text = [
          "⚠ **Context not ready** — the following are missing:",
          ...prepared.missingSections.map(s => `- ${s}`),
          "",
          "Suggested actions:",
          ...prepared.suggestedNextActions.map(a => `- ${a}`),
          "",
          "---",
          "",
          text,
        ].join("\n");
      }
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text } },
        ],
      };
    }
  );

  // ── syncpoint_reviewer_checklist ──
  server.registerPrompt(
    "syncpoint_reviewer_checklist",
    {
      title: "Reviewer Checklist",
      description: "Review context for a task — includes contract, checkpoint, capsule, and a review checklist.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        agentId: z.string().describe("Agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prepared.prompt } },
        ],
      };
    }
  );

  // ── syncpoint_architect_briefing ──
  server.registerPrompt(
    "syncpoint_architect_briefing",
    {
      title: "Architect Briefing",
      description: "Architect-level project briefing with project memory, task overview, and planning guidance.",
    },
    () => {
      const prepared = prepareContext({ intent: "architect-plan", role: "architect" });
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prepared.prompt } },
        ],
      };
    }
  );

  // ── syncpoint_user_memory_review ──
  server.registerPrompt(
    "syncpoint_user_memory_review",
    {
      title: "User Memory Review",
      description: "Review all project memories by status for curation — approve drafts, deprecate stale entries, add new knowledge.",
    },
    () => {
      const prepared = prepareContext({ intent: "memory-review", role: "architect" });
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prepared.prompt } },
        ],
      };
    }
  );

  // ── syncpoint_architect_plan ──
  server.registerPrompt(
    "syncpoint_architect_plan",
    {
      title: "Architect Planning",
      description: "Generate an architect planning prompt with project memory, task list, and context policy for task decomposition.",
      argsSchema: {
        sessionId: z.string().describe("Orchestration session ID"),
      },
    },
    ({ sessionId }) => {
      const status = orchGetSessionStatus(sessionId);
      const prepared = prepareContext({ intent: "architect-plan", role: "architect" });
      const lines: string[] = [];
      lines.push(prepared.prompt);
      lines.push("");
      lines.push("## Current Session");
      lines.push(`**Session**: ${status.session.title} [${status.session.status}]`);
      if (status.roles.length > 0) {
        lines.push("**Roles**: " + status.roles.map(r => `${r.agentId}=${r.role}`).join(", "));
      }
      if (status.assignments.length > 0) {
        lines.push("**Assignments**: " + status.assignments.map(a => `${a.taskId}→${a.assigneeAgentId}[${a.status}]`).join(", "));
      }
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } },
        ],
      };
    }
  );

  // ── syncpoint_review_task ──
  server.registerPrompt(
    "syncpoint_review_task",
    {
      title: "Review Task",
      description: "Generate a reviewer prompt for a specific task with context policy, contract, checkpoint, and capsule.",
      argsSchema: {
        taskId: z.string().describe("Task ID to review"),
        agentId: z.string().describe("Reviewer agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const prepared = prepareContext({ intent: "review", role: "reviewer", taskId, agentId });
      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prepared.prompt } },
        ],
      };
    }
  );

  // ── syncpoint_review_with_evidence ──
  server.registerPrompt(
    "syncpoint_review_with_evidence",
    {
      title: "Review with Evidence",
      description: "Full review packet with checklist, evidence, change requests, and gate status for structured reviewer decision.",
      argsSchema: {
        reviewRequestId: z.string().describe("Review request ID"),
      },
    },
    ({ reviewRequestId }) => {
      const packet = rwPrepareReviewPacket(reviewRequestId);
      const lines: string[] = [];
      lines.push("# Review with Evidence");
      lines.push("");
      lines.push(`**Gate**: ${packet.gate.status}`);
      if (packet.gate.reasons.length > 0) {
        lines.push(`**Reasons**: ${packet.gate.reasons.join("; ")}`);
      }
      lines.push("");
      lines.push("## Checklist");
      for (const i of packet.checklistItems) {
        lines.push(`- [${i.status}] ${i.title}${i.required ? " (required)" : " (optional)"}${i.notes ? " — " + i.notes : ""}`);
      }
      lines.push("");
      lines.push("## Evidence");
      for (const e of packet.evidence) {
        lines.push(`### ${e.kind}: ${e.title}`);
        lines.push(e.content);
      }
      lines.push("");
      lines.push("## Change Requests");
      if (packet.changeRequests.length === 0) {
        lines.push("None.");
      } else {
        for (const c of packet.changeRequests) {
          lines.push(`- [${c.status}] ${c.summary}`);
        }
      }
      if (packet.context) {
        lines.push("");
        lines.push("## Context");
        lines.push(packet.context.prompt);
      }
      lines.push("");
      lines.push("## Actions");
      if (packet.gate.status === "PASSED") {
        lines.push("- Use `syncpoint_review_approve` to approve.");
      }
      if (packet.gate.status === "BLOCKED") {
        lines.push("- Gate is BLOCKED. Address blocking reasons before approving.");
      }
      lines.push("- Use `syncpoint_review_block` to block with change request.");
      lines.push("- Use `syncpoint_review_checklist_update` to update checklist items.");
      lines.push("- Use `syncpoint_review_evidence_add` to add more evidence.");

      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } },
        ],
      };
    }
  );

  // ── syncpoint_session_playbook ──
  server.registerPrompt(
    "syncpoint_session_playbook",
    {
      title: "Session Playbook",
      description: "Generate a role-specific playbook prompt with session status and next actions.",
      argsSchema: {
        sessionId: z.string().describe("Orchestration session ID"),
        agentId: z.string().describe("Agent ID to generate playbook for"),
      },
    },
    ({ sessionId, agentId }) => {
      const status = orchGetSessionStatus(sessionId);
      const nextAction = pbGetNextAction({ sessionId, agentId });
      const agentRoles = status.roles
        .filter(r => r.agentId === agentId)
        .map(r => r.role);

      const lines: string[] = [];
      lines.push(`# Session Playbook: ${status.session.title}`);
      lines.push(`Session: ${status.session.id} [${status.session.status}]`);
      lines.push(`Agent: ${agentId}`);
      lines.push(`Roles: ${agentRoles.join(", ") || "none"}`);
      lines.push("");

      // Role-specific guidance
      lines.push("## Your Role");
      if (agentRoles.includes("architect")) {
        lines.push("As **Architect**, you are responsible for:");
        lines.push("- Decomposing work into tasks and assigning them");
        lines.push("- Advancing the session through phases");
        lines.push("- Requesting reviews when tasks are completed");
        lines.push("- Monitoring overall progress");
      }
      if (agentRoles.includes("executor")) {
        lines.push("As **Executor**, you are responsible for:");
        lines.push("- Accepting and starting assigned tasks");
        lines.push("- Creating regular checkpoints during work");
        lines.push("- Completing assignments when done");
        lines.push("- Addressing change requests from reviewers");
      }
      if (agentRoles.includes("reviewer")) {
        lines.push("As **Reviewer**, you are responsible for:");
        lines.push("- Starting assigned reviews");
        lines.push("- Adding checklist items and evidence");
        lines.push("- Evaluating the approval gate");
        lines.push("- Approving or blocking with change requests");
      }
      lines.push("");

      // Current state
      lines.push("## Current State");
      lines.push(`Assignments: ${status.assignments.length}`);
      for (const a of status.assignments) {
        lines.push(`- ${a.taskId} → ${a.assigneeAgentId} [${a.status}]`);
      }
      lines.push(`Reviews: ${status.reviews.length}`);
      for (const r of status.reviews) {
        lines.push(`- ${r.taskId} by ${r.reviewerAgentId} [${r.status}]`);
      }
      lines.push("");

      // Next actions
      lines.push("## Recommended Next Actions");
      for (const a of nextAction.actions) {
        lines.push(`### [Priority ${a.priority}] ${a.action}`);
        lines.push(a.reason);
        if (a.cliHint) lines.push(`CLI: \`${a.cliHint}\``);
        if (a.mcpToolHint) lines.push(`MCP Tool: \`${a.mcpToolHint}\``);
        lines.push("");
      }

      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } },
        ],
      };
    }
  );
}
