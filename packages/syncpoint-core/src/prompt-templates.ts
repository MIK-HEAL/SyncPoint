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
import type { RealityProjection } from "./reality-projection.js";

export type PromptFormat =
  | "system-prompt"
  | "cursorrules"
  | "agents-md"
  | "checkpoint-md"
  | "clipboard";

/**
 * Format a ResumeContext into a specific prompt template.
 * P2: Accepts optional RealityProjection to inject compiled projection into all formats.
 */
export function formatResumePrompt(
  ctx: ResumeContext,
  format: PromptFormat = "system-prompt",
  projection?: RealityProjection | null,
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
export function formatRealityProjection(projection: RealityProjection): string {
  const lines: string[] = [];
  const patch = projection.contextPatch;
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

/** Check if mode restricts to snapshot-only content (no raw checkpoint/project memory) */
function isSnapshotRestricted(ctx: ResumeContext): boolean {
  return ctx.contextMode === "snapshot-only" || ctx.contextMode === "snapshot-locked";
}

function formatSystemPrompt(ctx: ResumeContext, projection?: RealityProjection | null): string {
  const lines: string[] = [];
  const restricted = isSnapshotRestricted(ctx);

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
    const projSection = formatRealityProjection(projection);
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
    lines.push(`- Responsibilities: ${ctx.approvedContract.responsibilities.join(", ")}`);
    lines.push(`- Interface: ${ctx.approvedContract.interfaceSpec.join(", ")}`);
    lines.push(`- File boundaries: ${ctx.approvedContract.fileBoundaries.join(", ")}`);
    lines.push("");
  }

  if (ctx.latestSnapshot) {
    const p = ctx.latestSnapshot!.payload;
    lines.push("## Current Context");
    if (p.goal) lines.push(`- Goal: ${p.goal}`);
    if (p.currentPhase) lines.push(`- Phase: ${p.currentPhase}`);
    if (p.confirmedDecisions?.length) lines.push(`- Decisions: ${p.confirmedDecisions.join("; ")}`);
    if (p.workingResources?.length) lines.push(`- Files: ${p.workingResources.join(", ")}`);
    if (p.completedWork) lines.push(`- Done: ${p.completedWork}`);
    if (p.remainingWork) lines.push(`- Remaining: ${p.remainingWork}`);
    if (p.nextSteps?.length) lines.push(`- Next: ${p.nextSteps.join(", ")}`);
    if (p.risks?.length) lines.push(`- Risks: ${p.risks.join(", ")}`);
    if (p.blockers?.length) lines.push(`- Blockers: ${p.blockers.join(", ")}`);
    lines.push("");
    if (p.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push(p.resumePrompt);
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

  if (!ctx.latestSnapshot && !ctx.latestCheckpoint) {
    lines.push("⚠ No snapshot or checkpoint. Create a context snapshot before starting work.");
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

function formatCursorRules(ctx: ResumeContext, projection?: RealityProjection | null): string {
  const lines: string[] = [];
  const restricted = isSnapshotRestricted(ctx);

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
    const projSection = formatRealityProjection(projection);
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
    lines.push(`Responsibilities: ${ctx.approvedContract.responsibilities.join(", ")}`);
    lines.push(`Interface: ${ctx.approvedContract.interfaceSpec.join(", ")}`);
    lines.push(`Files: ${ctx.approvedContract.fileBoundaries.join(", ")}`);
    lines.push("");
  }

  if (ctx.latestSnapshot) {
    const p = ctx.latestSnapshot!.payload;
    lines.push("## Context Snapshot");
    if (p.goal) lines.push(`Goal: ${p.goal}`);
    if (p.currentPhase) lines.push(`Phase: ${p.currentPhase}`);
    if (p.workingResources?.length) lines.push(`Working files: ${p.workingResources.join(", ")}`);
    if (p.remainingWork) lines.push(`Remaining: ${p.remainingWork}`);
    if (p.nextSteps?.length) lines.push(`Next steps: ${p.nextSteps.join(", ")}`);
    if (p.blockers?.length) lines.push(`Blockers: ${p.blockers.join(", ")}`);
    lines.push("");
    if (p.resumePrompt) {
      lines.push("## Instructions");
      lines.push(p.resumePrompt);
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

function formatAgentsMd(ctx: ResumeContext, projection?: RealityProjection | null): string {
  const lines: string[] = [];
  const restricted = isSnapshotRestricted(ctx);

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
    const projSection = formatRealityProjection(projection);
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

  if (ctx.latestSnapshot) {
    const p = ctx.latestSnapshot!.payload;
    lines.push("## Current Work Context");
    lines.push("");
    if (p.goal) { lines.push(`**Goal**: ${p.goal}`); lines.push(""); }
    if (p.currentPhase) { lines.push(`**Phase**: ${p.currentPhase}`); lines.push(""); }
    if (p.confirmedDecisions?.length) {
      lines.push(`**Confirmed Decisions**: ${p.confirmedDecisions.join("; ")}`);
      lines.push("");
    }
    if (p.workingResources?.length) {
      lines.push(`**Working Files**: ${p.workingResources.join(", ")}`);
      lines.push("");
    }
    if (p.completedWork) {
      lines.push(`**Completed**: ${p.completedWork}`);
      lines.push("");
    }
    if (p.remainingWork) {
      lines.push(`**Remaining**: ${p.remainingWork}`);
      lines.push("");
    }
    if (p.nextSteps?.length) {
      lines.push(`**Next Steps**: ${p.nextSteps.join(", ")}`);
      lines.push("");
    }
    if (p.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push("");
      lines.push(p.resumePrompt);
      lines.push("");
    }
  }

  if (ctx.approvedContract) {
    lines.push("## Peer Contract");
    lines.push("");
    lines.push(`**Scope**: ${ctx.approvedContract.scope}`);
    lines.push("");
    lines.push(`**Responsibilities**: ${ctx.approvedContract.responsibilities.join(", ")}`);
    lines.push("");
    lines.push(`**Interface**: ${ctx.approvedContract.interfaceSpec.join(", ")}`);
    lines.push("");
    lines.push(`**File Boundaries**: ${ctx.approvedContract.fileBoundaries.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ── checkpoint-md ─────────────────────────────────────

function formatCheckpointMd(ctx: ResumeContext, projection?: RealityProjection | null): string {
  // P3B: always build from structured fields — never use ctx.resumePrompt
  // which contains baked-in raw Project Knowledge.
  const lines: string[] = [];
  lines.push(`# Checkpoint — ${ctx.task.title}`);
  lines.push("");
  lines.push(`**Agent**: ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  // P2: inject projected reality
  if (projection) {
    const projSection = formatRealityProjection(projection);
    if (projSection) {
      lines.push(projSection);
    }
  }

  if (ctx.latestSnapshot) {
    const p = ctx.latestSnapshot!.payload;
    if (p.goal) lines.push(`**Goal**: ${p.goal}`);
    if (p.currentPhase) lines.push(`**Phase**: ${p.currentPhase}`);
    if (p.confirmedDecisions?.length) lines.push(`**Decisions**: ${p.confirmedDecisions.join("; ")}`);
    if (p.workingResources?.length) lines.push(`**Files**: ${p.workingResources.join(", ")}`);
    if (p.completedWork) lines.push(`**Done**: ${p.completedWork}`);
    if (p.remainingWork) lines.push(`**Remaining**: ${p.remainingWork}`);
    if (p.nextSteps?.length) lines.push(`**Next**: ${p.nextSteps.join(", ")}`);
    if (p.blockers?.length) lines.push(`**Blockers**: ${p.blockers.join(", ")}`);
    lines.push("");
    if (p.resumePrompt) {
      lines.push("## Resume Instructions");
      lines.push(p.resumePrompt);
      lines.push("");
    }
  } else {
    lines.push("⚠ No snapshot available.");
  }

  if (!isSnapshotRestricted(ctx) && ctx.latestCheckpoint) {
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

function formatClipboard(ctx: ResumeContext, projection?: RealityProjection | null): string {
  const lines: string[] = [];

  lines.push(`[SyncPoint Resume] ${ctx.task.title} — ${ctx.agent.name} (${ctx.agent.role})`);
  lines.push("");

  if (ctx.pinnedMemories.length > 0) {
    lines.push("Rules: " + ctx.pinnedMemories.map(m => `${m.key}=${m.content}`).join("; "));
    lines.push("");
  }

  // P2: inject projected reality (compact form for clipboard)
  if (projection) {
    const patch = projection.contextPatch;
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

  if (ctx.latestSnapshot) {
    const p = ctx.latestSnapshot!.payload;
    if (p.goal) lines.push(`Goal: ${p.goal}`);
    if (p.currentPhase) lines.push(`Phase: ${p.currentPhase}`);
    if (p.remainingWork) lines.push(`Remaining: ${p.remainingWork}`);
    if (p.nextSteps?.length) lines.push(`Next: ${p.nextSteps.join(", ")}`);
    if (p.resumePrompt) {
      lines.push("");
      lines.push(p.resumePrompt);
    }
  } else if (ctx.latestCheckpoint) {
    lines.push(ctx.latestCheckpoint.summary);
  } else {
    lines.push("⚠ No snapshot/checkpoint — create one first.");
  }

  if (!ctx.ready) {
    lines.push("");
    lines.push("⚠ " + ctx.warnings.join("; "));
  }

  return lines.join("\n");
}
