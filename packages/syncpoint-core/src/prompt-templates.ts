/**
 * Prompt Template Engine — format ResumeContext for different AI editors.
 *
 * Supported formats:
 *   - system-prompt:  Plain text for system prompt injection
 *   - cursorrules:    .cursorrules / .windsurfrules file format
 *   - agents-md:      AGENTS.md project knowledge file
 *   - checkpoint-md:  Standalone markdown checkpoint document
 *   - clipboard:      Compact text for clipboard paste
 */

import type { ResumeContext } from "./memory.js";

export type PromptFormat =
  | "system-prompt"
  | "cursorrules"
  | "agents-md"
  | "checkpoint-md"
  | "clipboard";

/**
 * Format a ResumeContext into a specific prompt template.
 */
export function formatResumePrompt(
  ctx: ResumeContext,
  format: PromptFormat = "system-prompt",
): string {
  switch (format) {
    case "system-prompt":
      return formatSystemPrompt(ctx);
    case "cursorrules":
      return formatCursorRules(ctx);
    case "agents-md":
      return formatAgentsMd(ctx);
    case "checkpoint-md":
      return formatCheckpointMd(ctx);
    case "clipboard":
      return formatClipboard(ctx);
    default:
      return formatSystemPrompt(ctx);
  }
}

// ── system-prompt ─────────────────────────────────────

/** Check if mode restricts to capsule-only content (no raw checkpoint/project memory) */
function isCapsuleRestricted(ctx: ResumeContext): boolean {
  return ctx.contextMode === "capsule-only" || ctx.contextMode === "capsule-locked";
}

function formatSystemPrompt(ctx: ResumeContext): string {
  const lines: string[] = [];
  const restricted = isCapsuleRestricted(ctx);

  lines.push("You are resuming work on a task managed by SyncPoint.");
  lines.push("Below is the ONLY context you should use. Do NOT rely on prior conversation history.");
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("## Mandatory Rules");
    for (const m of ctx.pinnedMemories) {
      lines.push(`- ${m.key}: ${m.content}`);
    }
    lines.push("");
  }

  if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of ctx.projectMemories) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  }

  lines.push(`## Task: ${ctx.task.title}`);
  lines.push(`- ID: ${ctx.task.id}`);
  lines.push(`- Status: ${ctx.task.status}`);
  lines.push(`- Your role: ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  if (ctx.approvedContract) {
    lines.push("## Peer Contract (APPROVED)");
    lines.push(`- Scope: ${ctx.approvedContract.scope}`);
    lines.push(`- Responsibilities: ${ctx.approvedContract.responsibilities}`);
    lines.push(`- Interface: ${ctx.approvedContract.interfaceSpec}`);
    lines.push(`- File boundaries: ${ctx.approvedContract.fileBoundaries}`);
    lines.push("");
  }

  if (ctx.latestCapsule) {
    lines.push("## Current Context");
    lines.push(`- Goal: ${ctx.latestCapsule.goal}`);
    lines.push(`- Phase: ${ctx.latestCapsule.currentPhase}`);
    if (ctx.latestCapsule.confirmedDecisions) lines.push(`- Decisions: ${ctx.latestCapsule.confirmedDecisions}`);
    if (ctx.latestCapsule.workingFiles) lines.push(`- Files: ${ctx.latestCapsule.workingFiles}`);
    if (ctx.latestCapsule.completedWork) lines.push(`- Done: ${ctx.latestCapsule.completedWork}`);
    if (ctx.latestCapsule.remainingWork) lines.push(`- Remaining: ${ctx.latestCapsule.remainingWork}`);
    if (ctx.latestCapsule.nextSteps) lines.push(`- Next: ${ctx.latestCapsule.nextSteps}`);
    if (ctx.latestCapsule.risks) lines.push(`- Risks: ${ctx.latestCapsule.risks}`);
    if (ctx.latestCapsule.blockers) lines.push(`- Blockers: ${ctx.latestCapsule.blockers}`);
    lines.push("");
    if (ctx.latestCapsule.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push(ctx.latestCapsule.resumePrompt);
      lines.push("");
    }
  }

  if (!restricted && ctx.latestCheckpoint) {
    lines.push("## Latest Checkpoint");
    lines.push(`- ${ctx.latestCheckpoint.summary}`);
    if (ctx.latestCheckpoint.progress) lines.push(`- Progress: ${ctx.latestCheckpoint.progress}`);
    if (ctx.latestCheckpoint.nextSteps) lines.push(`- Next: ${ctx.latestCheckpoint.nextSteps}`);
    if (ctx.latestCheckpoint.needSync) lines.push("- ⚠ Sync required before continuing");
    lines.push("");
  }

  if (!ctx.latestCapsule && !ctx.latestCheckpoint) {
    lines.push("⚠ No capsule or checkpoint. Create a capsule before starting work.");
    lines.push("");
  }

  if (ctx.warnings.length > 0) {
    lines.push("## Warnings");
    for (const w of ctx.warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── cursorrules ───────────────────────────────────────

function formatCursorRules(ctx: ResumeContext): string {
  const lines: string[] = [];
  const restricted = isCapsuleRestricted(ctx);

  lines.push("# SyncPoint Resume Context");
  lines.push("# Auto-generated — do not edit manually");
  lines.push(`# Generated: ${ctx.generatedAt}`);
  lines.push("");
  lines.push("# When resuming this task, use ONLY the context below.");
  lines.push("# Do NOT carry over previous conversation history.");
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("## Rules");
    for (const m of ctx.pinnedMemories) {
      lines.push(`- ${m.key}: ${m.content}`);
    }
    lines.push("");
  }

  if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
    lines.push("## Project Knowledge");
    for (const m of ctx.projectMemories) {
      lines.push(`## ${m.title} [${m.category}]`);
      lines.push(m.content);
      lines.push("");
    }
  }

  lines.push(`## Task: ${ctx.task.title} [${ctx.task.status}]`);
  lines.push(`Agent: ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  if (ctx.approvedContract) {
    lines.push("## Contract");
    lines.push(`Scope: ${ctx.approvedContract.scope}`);
    lines.push(`Responsibilities: ${ctx.approvedContract.responsibilities}`);
    lines.push(`Interface: ${ctx.approvedContract.interfaceSpec}`);
    lines.push(`Files: ${ctx.approvedContract.fileBoundaries}`);
    lines.push("");
  }

  if (ctx.latestCapsule) {
    lines.push("## Context Capsule");
    lines.push(`Goal: ${ctx.latestCapsule.goal}`);
    lines.push(`Phase: ${ctx.latestCapsule.currentPhase}`);
    if (ctx.latestCapsule.workingFiles) lines.push(`Working files: ${ctx.latestCapsule.workingFiles}`);
    if (ctx.latestCapsule.remainingWork) lines.push(`Remaining: ${ctx.latestCapsule.remainingWork}`);
    if (ctx.latestCapsule.nextSteps) lines.push(`Next steps: ${ctx.latestCapsule.nextSteps}`);
    if (ctx.latestCapsule.blockers) lines.push(`Blockers: ${ctx.latestCapsule.blockers}`);
    lines.push("");
    if (ctx.latestCapsule.resumePrompt) {
      lines.push("## Instructions");
      lines.push(ctx.latestCapsule.resumePrompt);
      lines.push("");
    }
  }

  if (!restricted && ctx.latestCheckpoint) {
    lines.push("## Checkpoint");
    lines.push(ctx.latestCheckpoint.summary);
    if (ctx.latestCheckpoint.needSync) lines.push("⚠ SYNC REQUIRED");
    lines.push("");
  }

  return lines.join("\n");
}

// ── agents-md ─────────────────────────────────────────

function formatAgentsMd(ctx: ResumeContext): string {
  const lines: string[] = [];
  const restricted = isCapsuleRestricted(ctx);

  lines.push("# AGENTS.md — SyncPoint Project Knowledge");
  lines.push("");
  lines.push(`> Auto-generated by SyncPoint at ${ctx.generatedAt}`);
  lines.push("> This file provides resume context for AI agents working on this project.");
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("## Project Rules");
    lines.push("");
    for (const m of ctx.pinnedMemories) {
      lines.push(`- **${m.key}**: ${m.content}`);
    }
    lines.push("");
  }

  if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
    lines.push("## Project Knowledge");
    lines.push("");
    for (const m of ctx.projectMemories) {
      lines.push(`### ${m.title} [${m.category}]`);
      lines.push("");
      lines.push(m.content);
      lines.push("");
    }
  }

  lines.push("## Active Task");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Task | ${ctx.task.title} |`);
  lines.push(`| Status | ${ctx.task.status} |`);
  lines.push(`| Agent | ${ctx.agent.name} (${ctx.agent.role}) |`);
  if (ctx.approvedContract) {
    lines.push(`| Contract | ${ctx.approvedContract.title} — ${ctx.approvedContract.scope} |`);
  }
  lines.push("");

  if (ctx.latestCapsule) {
    lines.push("## Current Work Context");
    lines.push("");
    lines.push(`**Goal**: ${ctx.latestCapsule.goal}`);
    lines.push("");
    lines.push(`**Phase**: ${ctx.latestCapsule.currentPhase}`);
    lines.push("");
    if (ctx.latestCapsule.confirmedDecisions) {
      lines.push(`**Confirmed Decisions**: ${ctx.latestCapsule.confirmedDecisions}`);
      lines.push("");
    }
    if (ctx.latestCapsule.workingFiles) {
      lines.push(`**Working Files**: ${ctx.latestCapsule.workingFiles}`);
      lines.push("");
    }
    if (ctx.latestCapsule.completedWork) {
      lines.push(`**Completed**: ${ctx.latestCapsule.completedWork}`);
      lines.push("");
    }
    if (ctx.latestCapsule.remainingWork) {
      lines.push(`**Remaining**: ${ctx.latestCapsule.remainingWork}`);
      lines.push("");
    }
    if (ctx.latestCapsule.nextSteps) {
      lines.push(`**Next Steps**: ${ctx.latestCapsule.nextSteps}`);
      lines.push("");
    }
    if (ctx.latestCapsule.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push("");
      lines.push(ctx.latestCapsule.resumePrompt);
      lines.push("");
    }
  }

  if (ctx.approvedContract) {
    lines.push("## Peer Contract");
    lines.push("");
    lines.push(`**Scope**: ${ctx.approvedContract.scope}`);
    lines.push("");
    lines.push(`**Responsibilities**: ${ctx.approvedContract.responsibilities}`);
    lines.push("");
    lines.push(`**Interface**: ${ctx.approvedContract.interfaceSpec}`);
    lines.push("");
    lines.push(`**File Boundaries**: ${ctx.approvedContract.fileBoundaries}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── checkpoint-md ─────────────────────────────────────

function formatCheckpointMd(ctx: ResumeContext): string {
  if (isCapsuleRestricted(ctx)) {
    // In capsule-only/locked mode, build a capsule-only checkpoint doc
    const lines: string[] = [];
    lines.push(`# Checkpoint — ${ctx.task.title}`);
    lines.push("");
    if (ctx.latestCapsule) {
      lines.push(`**Goal**: ${ctx.latestCapsule.goal}`);
      lines.push(`**Phase**: ${ctx.latestCapsule.currentPhase}`);
      if (ctx.latestCapsule.remainingWork) lines.push(`**Remaining**: ${ctx.latestCapsule.remainingWork}`);
      if (ctx.latestCapsule.nextSteps) lines.push(`**Next**: ${ctx.latestCapsule.nextSteps}`);
      if (ctx.latestCapsule.blockers) lines.push(`**Blockers**: ${ctx.latestCapsule.blockers}`);
      lines.push("");
      if (ctx.latestCapsule.resumePrompt) {
        lines.push("## Resume Instructions");
        lines.push(ctx.latestCapsule.resumePrompt);
        lines.push("");
      }
    } else {
      lines.push("⚠ No capsule available.");
    }
    return lines.join("\n");
  }
  // Legacy: raw resumePrompt (may contain project knowledge + checkpoint)
  return ctx.resumePrompt;
}

// ── clipboard ─────────────────────────────────────────

function formatClipboard(ctx: ResumeContext): string {
  const lines: string[] = [];

  lines.push(`[SyncPoint Resume] ${ctx.task.title} — ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("Rules: " + ctx.pinnedMemories.map(m => `${m.key}=${m.content}`).join("; "));
    lines.push("");
  }

  if (ctx.latestCapsule) {
    lines.push(`Goal: ${ctx.latestCapsule.goal}`);
    lines.push(`Phase: ${ctx.latestCapsule.currentPhase}`);
    if (ctx.latestCapsule.remainingWork) lines.push(`Remaining: ${ctx.latestCapsule.remainingWork}`);
    if (ctx.latestCapsule.nextSteps) lines.push(`Next: ${ctx.latestCapsule.nextSteps}`);
    if (ctx.latestCapsule.resumePrompt) {
      lines.push("");
      lines.push(ctx.latestCapsule.resumePrompt);
    }
  } else if (ctx.latestCheckpoint) {
    lines.push(ctx.latestCheckpoint.summary);
  } else {
    lines.push("⚠ No capsule/checkpoint — create one first.");
  }

  if (!ctx.ready) {
    lines.push("");
    lines.push("⚠ " + ctx.warnings.join("; "));
  }

  return lines.join("\n");
}
