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
import type { ProjectedReality } from "./projection.js";

export type PromptFormat =
  | "system-prompt"
  | "cursorrules"
  | "agents-md"
  | "checkpoint-md"
  | "clipboard";

/**
 * Format a ResumeContext into a specific prompt template.
 * P2: Accepts optional ProjectedReality to inject compiled projection into all formats.
 */
export function formatResumePrompt(
  ctx: ResumeContext,
  format: PromptFormat = "system-prompt",
  projection?: ProjectedReality | null,
): string {
  switch (format) {
    case "system-prompt":
      return formatSystemPrompt(ctx, projection);
    case "cursorrules":
      return formatCursorRules(ctx, projection);
    case "agents-md":
      return formatAgentsMd(ctx, projection);
    case "checkpoint-md":
      return formatCheckpointMd(ctx, projection);
    case "clipboard":
      return formatClipboard(ctx, projection);
    default:
      return formatSystemPrompt(ctx, projection);
  }
}

// ── P2: Reusable projected reality formatter ──────────

/**
 * Format projected reality into a normalized section.
 * Used by all prompt formats to inject compiled projection.
 */
export function formatProjectedReality(projection: ProjectedReality): string {
  const lines: string[] = [];
  const patch = projection.capsulePatch;
  const hasPatchContent =
    patch.verifiedFacts.length > 0 ||
    patch.activeConstraints.length > 0 ||
    patch.risks.length > 0 ||
    patch.doNotTouch.length > 0;

  if (!hasPatchContent && projection.conflicts.length === 0 &&
      projection.skippedStale.length === 0 &&
      projection.protocolRules.length === 0 &&
      projection.constraintRules.length === 0) {
    return "";
  }

  lines.push("## Projected Reality");
  lines.push(`> Projection: ${projection.projectionId} | Memory v${projection.createdFrom.memoryVersion} | ${projection.projectionValidity}`);
  lines.push("");

  if (patch.verifiedFacts.length > 0) {
    lines.push("### Verified Facts");
    for (const f of patch.verifiedFacts) {
      lines.push(`- ${f.title}: ${f.content} [ref:${f.source.sourceMemoryId}]`);
    }
    lines.push("");
  }
  if (patch.activeConstraints.length > 0) {
    lines.push("### Active Constraints");
    for (const c of patch.activeConstraints) {
      lines.push(`- ${c.title}: ${c.content} [ref:${c.source.sourceMemoryId}]`);
    }
    lines.push("");
  }
  if (patch.risks.length > 0) {
    lines.push("### Known Risks");
    for (const r of patch.risks) {
      lines.push(`- ${r.title}: ${r.content} [ref:${r.source.sourceMemoryId}]`);
    }
    lines.push("");
  }
  if (patch.doNotTouch.length > 0) {
    lines.push("### Do Not Touch");
    for (const d of patch.doNotTouch) {
      lines.push(`- ${d.title}: ${d.content} [ref:${d.source.sourceMemoryId}]`);
    }
    lines.push("");
  }

  if (projection.conflicts.length > 0) {
    lines.push("### Projection Conflicts");
    for (const c of projection.conflicts) {
      lines.push(`- ${c.description} (${c.itemA.sourceMemoryId} vs ${c.itemB.sourceMemoryId})`);
    }
    lines.push("");
  }

  if (projection.skippedStale.length > 0) {
    lines.push("### Skipped (stale/invalid)");
    for (const s of projection.skippedStale) {
      lines.push(`- ${s.sourceMemoryId}: ${s.projectionReason}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── system-prompt ─────────────────────────────────────

/** Check if mode restricts to capsule-only content (no raw checkpoint/project memory) */
function isCapsuleRestricted(ctx: ResumeContext): boolean {
  return ctx.contextMode === "capsule-only" || ctx.contextMode === "capsule-locked";
}

function formatSystemPrompt(ctx: ResumeContext, projection?: ProjectedReality | null): string {
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

  // P2: inject projected reality instead of raw project memories
  if (projection) {
    const projSection = formatProjectedReality(projection);
    if (projSection) {
      lines.push(projSection);
    }
  } else if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
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
    if (ctx.latestCapsule.workingResources) lines.push(`- Files: ${ctx.latestCapsule.workingResources}`);
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

function formatCursorRules(ctx: ResumeContext, projection?: ProjectedReality | null): string {
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

  // P2: inject projected reality instead of raw project memories
  if (projection) {
    const projSection = formatProjectedReality(projection);
    if (projSection) {
      lines.push(projSection);
    }
  } else if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
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
    if (ctx.latestCapsule.workingResources) lines.push(`Working files: ${ctx.latestCapsule.workingResources}`);
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

function formatAgentsMd(ctx: ResumeContext, projection?: ProjectedReality | null): string {
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

  // P2: inject projected reality instead of raw project memories
  if (projection) {
    const projSection = formatProjectedReality(projection);
    if (projSection) {
      lines.push(projSection);
      lines.push("");
    }
  } else if (!restricted && ctx.projectMemories && ctx.projectMemories.length > 0) {
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
    if (ctx.latestCapsule.workingResources) {
      lines.push(`**Working Files**: ${ctx.latestCapsule.workingResources}`);
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

function formatCheckpointMd(ctx: ResumeContext, projection?: ProjectedReality | null): string {
  // P3B: always build from structured fields — never use ctx.resumePrompt
  // which contains baked-in raw Project Knowledge.
  const lines: string[] = [];
  lines.push(`# Checkpoint — ${ctx.task.title}`);
  lines.push("");
  lines.push(`**Agent**: ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  // P2: inject projected reality
  if (projection) {
    const projSection = formatProjectedReality(projection);
    if (projSection) {
      lines.push(projSection);
    }
  }

  if (ctx.latestCapsule) {
    lines.push(`**Goal**: ${ctx.latestCapsule.goal}`);
    lines.push(`**Phase**: ${ctx.latestCapsule.currentPhase}`);
    if (ctx.latestCapsule.confirmedDecisions) lines.push(`**Decisions**: ${ctx.latestCapsule.confirmedDecisions}`);
    if (ctx.latestCapsule.workingResources) lines.push(`**Files**: ${ctx.latestCapsule.workingResources}`);
    if (ctx.latestCapsule.completedWork) lines.push(`**Done**: ${ctx.latestCapsule.completedWork}`);
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

  if (!isCapsuleRestricted(ctx) && ctx.latestCheckpoint) {
    lines.push("## Latest Checkpoint");
    lines.push(`**Summary**: ${ctx.latestCheckpoint.summary}`);
    if (ctx.latestCheckpoint.progress) lines.push(`**Progress**: ${ctx.latestCheckpoint.progress}`);
    if (ctx.latestCheckpoint.nextSteps) lines.push(`**Next**: ${ctx.latestCheckpoint.nextSteps}`);
    if (ctx.latestCheckpoint.needSync) lines.push("⚠ **Sync required** before continuing.");
    lines.push("");
  }

  return lines.join("\n");
}

// ── clipboard ─────────────────────────────────────────

function formatClipboard(ctx: ResumeContext, projection?: ProjectedReality | null): string {
  const lines: string[] = [];

  lines.push(`[SyncPoint Resume] ${ctx.task.title} — ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("Rules: " + ctx.pinnedMemories.map(m => `${m.key}=${m.content}`).join("; "));
    lines.push("");
  }

  // P2: inject projected reality (compact form for clipboard)
  if (projection) {
    const patch = projection.capsulePatch;
    const items = [
      ...patch.verifiedFacts.map(f => `[fact] ${f.title}`),
      ...patch.activeConstraints.map(c => `[constraint] ${c.title}`),
      ...patch.risks.map(r => `[risk] ${r.title}`),
      ...patch.doNotTouch.map(d => `[do-not-touch] ${d.title}`),
    ];
    if (items.length > 0) {
      lines.push("Reality: " + items.join("; "));
      lines.push("");
    }
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
