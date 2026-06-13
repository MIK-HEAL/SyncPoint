/**
 * MCP review-related prompts — memory review, evidence review, playbook, wake, conflicts, context checks.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getResumeContext } from "syncpoint-server/repositories";
import {
  pmList, prepareContext, orchGetSessionStatus, rwPrepareReviewPacket,
  pbGetNextAction, wakeNext,
  rcDetectConflicts, rcList,
} from "syncpoint-server/application";
import { formatProjectMemorySummary } from "./format.js";

export function registerReviewPrompts(server: McpServer): void {
  // ── syncpoint_memory_review ──
  server.registerPrompt(
    "syncpoint_memory_review",
    { title: "Memory Review", description: "Review all project memories for curation and cleanup." },
    () => {
      const all = pmList();
      const groups = [
        { label: "Draft", items: all.filter(m => m.status === "draft") },
        { label: "Approved", items: all.filter(m => m.status === "approved") },
        { label: "Deprecated", items: all.filter(m => m.status === "deprecated") },
      ];
      const text = [
        "# Project Memory Review", "",
        `Total: ${all.length} (${groups.map(g => `${g.items.length} ${g.label.toLowerCase()}`).join(", ")})`,
        ...groups.flatMap(g => [
          "", `## ${g.label}`, "",
          ...(g.items.length > 0 ? g.items.map(formatProjectMemorySummary) : ["None."]),
        ]),
        "", "---", "",
        "Actions: syncpoint_project_memory_approve | syncpoint_project_memory_add | syncpoint_project_memory_export",
      ].join("\n");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
    }
  );

  // ── syncpoint_user_memory_review ──
  server.registerPrompt(
    "syncpoint_user_memory_review",
    { title: "User Memory Review", description: "Review all project memories by status for curation." },
    () => {
      const prepared = prepareContext({ intent: "memory-review", role: "architect" });
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: prepared.prompt } }] };
    }
  );

  // ── syncpoint_review_with_evidence ──
  server.registerPrompt(
    "syncpoint_review_with_evidence",
    {
      title: "Review with Evidence",
      description: "Full review packet with checklist, evidence, change requests, and gate status.",
      argsSchema: { reviewRequestId: z.string().describe("Review request ID") },
    },
    ({ reviewRequestId }) => {
      const packet = rwPrepareReviewPacket(reviewRequestId);
      const lines: string[] = [
        "# Review with Evidence", "",
        `**Gate**: ${packet.gate.status}`,
      ];
      if (packet.gate.reasons.length > 0) lines.push(`**Reasons**: ${packet.gate.reasons.join("; ")}`);
      lines.push("", "## Checklist");
      for (const i of packet.checklistItems) {
        lines.push(`- [${i.status}] ${i.title}${i.required ? " (required)" : ""}${i.notes ? " — " + i.notes : ""}`);
      }
      lines.push("", "## Evidence");
      for (const e of packet.evidence) { lines.push(`### ${e.kind}: ${e.title}`, e.content); }
      lines.push("", "## Change Requests");
      if (packet.changeRequests.length === 0) { lines.push("None."); }
      else { for (const c of packet.changeRequests) lines.push(`- [${c.status}] ${c.summary}`); }
      if (packet.context) { lines.push("", "## Context", packet.context.prompt); }
      lines.push("", "## Actions");
      if (packet.gate.status === "PASSED") lines.push("- Use `syncpoint_review_approve` to approve.");
      if (packet.gate.status === "BLOCKED") lines.push("- Gate is BLOCKED. Address blocking reasons before approving.");
      lines.push("- Use `syncpoint_review_block` | `syncpoint_review_checklist_update` | `syncpoint_review_evidence_add`");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );

  // ── syncpoint_session_playbook ──
  server.registerPrompt(
    "syncpoint_session_playbook",
    {
      title: "Session Playbook",
      description: "Role-specific sync playbook with pending actions.",
      argsSchema: { sessionId: z.string().describe("Session ID"), agentId: z.string().describe("Agent ID") },
    },
    ({ sessionId, agentId }) => {
      const status = orchGetSessionStatus(sessionId);
      const nextAction = pbGetNextAction({ sessionId, agentId });
      const agentRoles = status.roles.filter(r => r.agentId === agentId).map(r => r.role);

      const roleGuides: Record<string, string[]> = {
        architect: [
          "Decompose work into tasks with clear file boundaries",
          "Ensure each task has an owner — no uncoordinated parallel edits",
          "Advance the session only when all sync gates are cleared",
          "Request reviews at completion sync points",
          "Monitor for file conflicts between agents",
        ],
        executor: [
          "Accept assignments to confirm you own the work scope",
          "Checkpoint regularly so other agents see your progress",
          "Declare file claims before modifying shared files",
          "Stop and sync when you encounter file conflicts",
          "Complete assignments to trigger the review sync point",
        ],
        reviewer: [
          "Start reviews promptly — other agents may be blocked waiting",
          "Verify evidence and checklist items at the approval gate",
          "Approve to unblock the next phase, or block with specific change requests",
          "Your decision is a sync gate — it determines who continues",
        ],
      };

      const lines: string[] = [
        `# Session Playbook: ${status.session.title}`,
        `Session: ${status.session.id} [${status.session.status}]`,
        `Agent: ${agentId}`, `Roles: ${agentRoles.join(", ") || "none"}`, "",
        "## Your Role",
      ];
      for (const role of agentRoles) {
        if (roleGuides[role]) {
          lines.push(`As **${role}**, your sync responsibilities are:`,
            ...roleGuides[role]!.map(r => `- ${r}`));
        }
      }
      lines.push("", "## Current State");
      for (const a of status.assignments) lines.push(`- ${a.taskId} → ${a.assigneeAgentId} [${a.status}]`);
      for (const r of status.reviews) lines.push(`- ${r.taskId} by ${r.reviewerAgentId} [${r.status}]`);
      lines.push("", "## Recommended Next Actions");
      for (const a of nextAction.actions) {
        lines.push(`### [Priority ${a.priority}] ${a.action}`, a.reason);
        if (a.cliHint) lines.push(`CLI: \`${a.cliHint}\``);
        if (a.mcpToolHint) lines.push(`MCP Tool: \`${a.mcpToolHint}\``);
        lines.push("");
      }
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );

  // ── syncpoint_wake_briefing ──
  server.registerPrompt(
    "syncpoint_wake_briefing",
    {
      title: "Wake Briefing",
      description: "Check for pending sync obligations requiring your attention.",
      argsSchema: { agentId: z.string().describe("Agent ID") },
    },
    ({ agentId }) => {
      const wake = wakeNext(agentId);
      if (!wake) {
        return { messages: [{ role: "user" as const, content: { type: "text" as const, text: "No pending wake requests." } }] };
      }
      const lines: string[] = [
        "# SyncPoint Wake Briefing", "",
        "You are being woken because a synchronization point requires your attention.",
        "", `**Wake ID**: ${wake.id}`, `**Sync Action**: ${wake.action}`,
        `**Role**: ${wake.targetRole}`, `**Reason**: ${wake.reason}`,
        `**Session**: ${wake.sessionId}`,
      ];
      if (wake.taskId) lines.push(`**Task**: ${wake.taskId}`);
      if (wake.reviewRequestId) lines.push(`**Review**: ${wake.reviewRequestId}`);
      lines.push("", "## Instructions", "",
        `1. Acknowledge: syncpoint_wake_ack { id: "${wake.id}" }`,
        `2. Start: syncpoint_wake_start { id: "${wake.id}" }`);
      if (wake.mcpToolHint) lines.push(`3. Execute: \`${wake.mcpToolHint}\``);
      if (wake.cliHint) lines.push(`   CLI: \`${wake.cliHint}\``);
      lines.push(`4. Complete: syncpoint_wake_done { id: "${wake.id}", resultSummary: "..." }`);
      if (wake.promptHint) lines.push("", `**Tip**: Use \`${wake.promptHint}\` for detailed role-specific guidance.`);
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );

  // ── syncpoint_conflict_resolution ──
  server.registerPrompt(
    "syncpoint_conflict_resolution",
    {
      title: "Conflict Resolution Guide",
      description: "Analyze active conflicts and generate structured resolution suggestions.",
      argsSchema: {
        taskId: z.string().describe("Your task ID"), agentId: z.string().describe("Your agent ID"),
        locator: z.string().optional().describe("Specific resource locator"),
      },
    },
    ({ taskId, agentId, locator }) => {
      const allConflicts = rcDetectConflicts();
      const conflicts = locator
        ? allConflicts.filter(c => c.overlappingLocator.includes(locator))
        : allConflicts;

      const lines: string[] = [
        "# Resource Conflict Resolution", "",
        `**Agent**: ${agentId}`, `**Task**: ${taskId}`,
        "", `**Active Conflicts**: ${conflicts.length}`,
      ];

      if (conflicts.length === 0) {
        lines.push("", "✅ No active conflicts detected.");
        return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
      }

      for (const c of conflicts) {
        const otherActor = c.claimA.actorId === agentId ? c.claimB.actorId : c.claimA.actorId;
        const otherTask = c.claimA.actorId === agentId ? c.claimB.taskId : c.claimA.taskId;
        lines.push("", `## Conflict: ${c.overlappingLocator}`,
          `- **Type**: ${c.isHardConflict ? "🔒 HARD" : "ℹ️ SOFT"}`,
          `- **Other Agent**: ${otherActor} (task: ${otherTask})`, "", "### Suggestions");

        const claimAResources = c.claimA.resources ?? [];
        const claimBResources = c.claimB.resources ?? [];
        const hasFileScope = claimAResources.some((r: any) => (r.scope ?? "file") === "file")
          || claimBResources.some((r: any) => (r.scope ?? "file") === "file");

        if (hasFileScope) {
          lines.push("1. **Narrow your scope**: Use `scope: 'function'` with `functionName` if editing a specific function.",
            "2. **Wait for release**: Check with `syncpoint status`.");
        } else {
          lines.push("1. **Check for false conflict**: Are you actually editing the same code?",
            "2. **Coordinate**: Both claims are at sub-file granularity.");
        }
        if (c.isHardConflict) {
          lines.push("3. **Resolve SyncGate**: Use `syncpoint_sync_gate_status`.",
            `   Contact ${otherActor} to coordinate resolution.`);
        }
      }

      lines.push("", "---", "", "## Related Constraints",
        "Use `syncpoint_constraint_check` and `syncpoint_preflight` before editing.");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );

  // ── syncpoint_context_aware_check ──
  server.registerPrompt(
    "syncpoint_context_aware_check",
    {
      title: "Context-Aware Pre-edit Check",
      description: "Analyze your task against active constraints, claims, and conflicts.",
      argsSchema: {
        taskId: z.string().describe("Your task ID"), agentId: z.string().describe("Your agent ID"),
        plannedFiles: z.string().optional().describe("Comma-separated files to check"),
      },
    },
    ({ taskId, agentId, plannedFiles }) => {
      const ctx = getResumeContext(taskId, agentId);
      const files = (plannedFiles ?? "").split(",").map(s => s.trim()).filter(Boolean);
      const doNotTouch = process.env.SYNCPOINT_DO_NOT_TOUCH?.split(",").map(s => s.trim()).filter(Boolean) ?? [];

      const lines: string[] = [
        "# Context-Aware Safety Check", "",
        `**Task**: ${ctx.task.title} (${ctx.task.status})`,
        `**Agent**: ${ctx.agent.name}`,
      ];

      if (files.length > 0) {
        lines.push("", "## Planned File Analysis");
        for (const file of files) {
          lines.push(`### ${file}`);
          for (const pattern of doNotTouch) {
            if (file.includes(pattern.replace(/\*/g, ""))) {
              lines.push(`🚫 DO NOT TOUCH: matches restricted pattern '${pattern}'.`);
            }
          }
          const activeClaims = rcList({ status: "ACTIVE" });
          let warned = false;
          for (const claim of activeClaims) {
            if (claim.actorId === agentId) continue;
            for (const resource of claim.resources ?? []) {
              if (resource.scope === "file" && resource.locator === file) {
                warned = true;
                lines.push(claim.mode === "exclusive"
                  ? `🔒 Claimed exclusively by ${claim.actorId} — DO NOT EDIT`
                  : `⚠️ Shared claim by ${claim.actorId} — coordinate before editing`);
              }
            }
          }
          if (!warned) lines.push("✅ No restrictions detected.");
        }
      } else {
        lines.push("", "## General Warnings", "Use `--plannedFiles` to check specific files.", "");
        if (doNotTouch.length > 0) lines.push(`**Do Not Touch**: ${doNotTouch.join(", ")}`);
        const otherClaims = rcList({ status: "ACTIVE" }).filter(c => c.actorId !== agentId);
        if (otherClaims.length > 0) {
          lines.push(`**Active claims by others**: ${otherClaims.length}`);
          for (const claim of otherClaims.slice(0, 5)) {
            const resources = claim.resources?.map((r: any) => r.locator).join(", ") ?? "";
            lines.push(`  - ${claim.actorId}: ${resources}`);
          }
        }
      }

      lines.push("", "---", "**Recommendation**: Run `syncpoint_preflight` before editing in a multi-agent project.");
      return { messages: [{ role: "user" as const, content: { type: "text" as const, text: lines.join("\n") } }] };
    }
  );
}
