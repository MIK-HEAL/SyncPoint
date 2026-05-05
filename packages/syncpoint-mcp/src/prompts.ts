/**
 * MCP prompts — reusable prompt templates for LLM interactions.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatResumePrompt } from "syncpoint-core";
import { getResumeContext } from "syncpoint-server/repositories";
import { pmList, prepareContext, orchGetSessionStatus, rwPrepareReviewPacket, pbGetNextAction, wakeNext, wakeList } from "syncpoint-server/application";
import { formatProjectMemorySummary } from "./format.js";

export function registerPrompts(server: McpServer): void {
  // ── syncpoint_resume ──
  server.registerPrompt(
    "syncpoint_resume",
    {
      title: "Resume Task",
      description: "Generate a synchronization-aware resume prompt for an agent. Includes task state, contract, checkpoint, capsule, pinned memories, project knowledge, and continuation blockers.",
      argsSchema: {
        taskId: z.string().describe("Task ID"),
        agentId: z.string().describe("Agent ID"),
      },
    },
    ({ taskId, agentId }) => {
      const ctx = getResumeContext(taskId, agentId);
      ctx.projectMemories = []; // P3B: no raw PM in resume output
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
      description: "Guide an agent to produce a structured checkpoint that can become a sync transaction when another agent must approve before continuation.",
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
        "- **workingResources**: Key resources currently being modified",
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
      description: "Onboard a new agent with approved project memories, current task context, and SyncPoint synchronization obligations.",
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
          ctx.projectMemories = []; // P3B: no raw PM in resume output
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
        "Welcome to this project. Here is the curated project knowledge and synchronization context:",
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
      description: "Resume an executor at a sync point — includes checkpoint context, file boundaries, and hard gate enforcement.",
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
      description: "Review sync gate — contract terms, checkpoint evidence, capsule context, and approval checklist.",
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
      description: "Architect sync briefing — project memory, task boundaries, agent assignments, and coordination guidance.",
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
      description: "Generate an architect planning prompt with project memory, task list, context policy, file boundaries, and blocker prevention guidance.",
      argsSchema: {
        sessionId: z.string().describe("Sync session ID"),
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
      description: "Role-specific sync playbook — what sync points need your attention and what actions to take.",
      argsSchema: {
        sessionId: z.string().describe("Sync session ID"),
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
        lines.push("As **Architect**, your sync responsibilities are:");
        lines.push("- Decompose work into tasks with clear file boundaries");
        lines.push("- Ensure each task has an owner — no uncoordinated parallel edits");
        lines.push("- Advance the session only when all sync gates are cleared");
        lines.push("- Request reviews at completion sync points");
        lines.push("- Monitor for file conflicts between agents");
      }
      if (agentRoles.includes("executor")) {
        lines.push("As **Executor**, your sync responsibilities are:");
        lines.push("- Accept assignments to confirm you own the work scope");
        lines.push("- Checkpoint regularly so other agents see your progress");
        lines.push("- Declare file claims before modifying shared files");
        lines.push("- Stop and sync when you encounter file conflicts");
        lines.push("- Complete assignments to trigger the review sync point");
      }
      if (agentRoles.includes("reviewer")) {
        lines.push("As **Reviewer**, your sync responsibilities are:");
        lines.push("- Start reviews promptly — other agents may be blocked waiting");
        lines.push("- Verify evidence and checklist items at the approval gate");
        lines.push("- Approve to unblock the next phase, or block with specific change requests");
        lines.push("- Your decision is a sync gate — it determines who continues");
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

  // ── syncpoint_wake_briefing ──
  server.registerPrompt(
    "syncpoint_wake_briefing",
    {
      title: "Wake Briefing",
      description: "Check for pending sync obligations. Shows the next wake request — a specific synchronization point that requires your attention.",
      argsSchema: {
        agentId: z.string().describe("Agent ID to check for wake requests"),
      },
    },
    ({ agentId }) => {
      const wake = wakeNext(agentId);
      if (!wake) {
        return {
          messages: [
            { role: "user" as const, content: { type: "text" as const, text: "No pending wake requests. No synchronization obligation is currently queued for this agent." } },
          ],
        };
      }

      const lines: string[] = [];
      lines.push("# SyncPoint Wake Briefing");
      lines.push("");
      lines.push("You are being woken because a **synchronization point** requires your attention.");
      lines.push("This is not a request to run autonomously — it is a specific sync obligation.");
      lines.push("");
      lines.push(`**Wake ID**: ${wake.id}`);
      lines.push(`**Sync Action**: ${wake.action}`);
      lines.push(`**Role**: ${wake.targetRole}`);
      lines.push(`**Reason**: ${wake.reason}`);
      lines.push(`**Session**: ${wake.sessionId}`);
      if (wake.taskId) lines.push(`**Task**: ${wake.taskId}`);
      if (wake.reviewRequestId) lines.push(`**Review**: ${wake.reviewRequestId}`);
      lines.push("");

      lines.push("## Instructions");
      lines.push("");
      lines.push("1. **Acknowledge** this wake request: `syncpoint_wake_ack { id: \"" + wake.id + "\" }`");
      lines.push("2. **Start** executing: `syncpoint_wake_start { id: \"" + wake.id + "\" }`");
      if (wake.mcpToolHint) {
        lines.push(`3. **Execute** the action using: \`${wake.mcpToolHint}\``);
      }
      if (wake.cliHint) {
        lines.push(`   CLI alternative: \`${wake.cliHint}\``);
      }
      lines.push(`4. **Complete**: \`syncpoint_wake_done { id: "${wake.id}", resultSummary: "..." }\``);
      lines.push("");

      if (wake.promptHint) {
        lines.push(`**Tip**: Use the \`${wake.promptHint}\` prompt for detailed role-specific guidance.`);
      }

      return {
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } },
        ],
      };
    }
  );
}
