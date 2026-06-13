/**
 * CLI Output Formatter — human-readable status and blocker explanations.
 *
 * Turns raw snapshot data into explainable output that answers:
 *   - Who is blocked?
 *   - Why?
 *   - What needs to happen?
 *   - What command to run?
 */

import type { UnifiedBlocker } from "syncpoint-server/application";
import {
  type Snapshot,
  type SnapshotAgent,
  type SnapshotConflict,
  type SnapshotClaim,
  type SnapshotOperation,
  type SnapshotWake,
  type SnapshotEvent,
} from "./formatter-types.js";
import {
  indent,
  blockerTypeLabel,
  blockerReasonLabel,
  suggestedAction,
  agentLabel,
  formatDeadline,
  formatVoteCounts,
  eventSummary,
} from "./formatter-helpers.js";

// Re-export Snapshot type for backward compatibility
export type { Snapshot } from "./formatter-types.js";

// ── Main formatters ──

export function formatStatusOutput(snapshot: Snapshot): string {
  const lines: string[] = [];
  const s = snapshot.summary;

  // ── Header ──
  lines.push("SyncPoint Status");
  lines.push("═".repeat(50));
  lines.push("");

  // ── Quick summary ──
  if (s.blockerCount === 0 && s.blockedAgentCount === 0) {
    lines.push("  All clear — no active blockers.");
  } else {
    lines.push(`  ${s.blockedAgentCount} agent(s) blocked, ${s.blockerCount} blocker(s) active`);
    if (s.hardConflictCount > 0) {
      lines.push(`  ${s.hardConflictCount} hard file conflict(s)`);
    }
    if (s.constraintBlockedAgents > 0) {
      lines.push(`  ${s.constraintBlockedAgents} agent(s) constraint-blocked`);
    }
  }
  lines.push("");

  // ── Sessions ──
  if (snapshot.sessions.length > 0) {
    lines.push("Sessions");
    lines.push("─".repeat(40));
    for (const sess of snapshot.sessions) {
      lines.push(`  ${sess.title} [${sess.status}] (${sess.relationshipMode})`);
      for (const a of sess.agents) {
        lines.push(`    ${a.agentName} — ${a.role}`);
      }
    }
    lines.push("");
  }

  // ── Agents ──
  if (snapshot.agents.length > 0) {
    lines.push("Agents");
    lines.push("─".repeat(40));
    for (const agent of snapshot.agents) {
      const status = agent.blocked ? "BLOCKED" : agent.status;
      const constraint = agent.constraintBlocked ? " [constraint-blocked]" : "";
      lines.push(`  ${agent.name} (${agent.provider}) — ${status}${constraint}`);

      for (const ta of agent.activeAssignments) {
        lines.push(`    Task: ${ta.taskTitle} [${ta.status}]`);
      }
      for (const c of agent.claimedResources) {
        const locs = c.resources.map((r: any) => r.locator).join(", ");
        lines.push(`    Claim: ${locs} (${c.mode})`);
      }
      if (agent.pendingWakeCount > 0) {
        lines.push(`    Wake: ${agent.pendingWakeCount} pending`);
      }
    }
    lines.push("");
  }

  // ── Resource Ownership ──
  const fo = snapshot.resourceOwnership;
  if (fo.activeClaims.length > 0 || fo.conflicts.length > 0) {
    lines.push("Resource Ownership");
    lines.push("─".repeat(40));
    for (const c of fo.activeClaims) {
      const locs = c.resources.map(r => r.locator).join(", ");
      lines.push(`  ${locs}  — ${c.actorName} (${c.mode})`);
    }
    if (fo.conflicts.length > 0) {
      lines.push("");
      lines.push("  Conflicts:");
      for (const c of fo.conflicts) {
        lines.push(`    [conflict] ${c.overlappingLocator}: ${c.claimA.actorName} vs ${c.claimB.actorName}`);
      }
    }
    lines.push("");
  }

  // ── Blockers ──
  if (snapshot.blockers.length > 0) {
    lines.push("Blockers");
    lines.push("─".repeat(40));
    for (const b of snapshot.blockers) {
      lines.push(`  [${blockerTypeLabel(b.type)}] ${blockerReasonLabel(b.reason)}`);
      if (b.description) {
        // Clean up overlapping path display in gate descriptions
        const desc = b.description.replace(/(\S+)\s*↔\s*\1/g, "$1");
        lines.push(`    ${desc}`);
      }
      lines.push(`    Status: ${b.status}`);
      if (b.requiredAgents.length > 0) {
        const names = b.requiredAgents.map(a => a.name).join(", ");
        lines.push(`    Required: ${names}`);
      }
      if (b.gateDetails) {
        const details = b.gateDetails;
        const pending = details.pendingAgentIds.map(id => agentLabel(id, b.requiredAgents)).join(", ") || "none";
        const acked = details.ackedAgentIds.map(id => agentLabel(id, b.requiredAgents)).join(", ") || "none";
        lines.push(`    Policy: ${details.policy}`);
        lines.push(`    Pending: ${pending}`);
        lines.push(`    Acked: ${acked}`);
        lines.push(`    Votes: ${formatVoteCounts(details.voteCounts)}`);
        lines.push(`    Eligible voters: ${details.eligibleVoterIds.join(", ") || "none"}`);
        const deadline = formatDeadline(details.deadlineAt);
        if (deadline) lines.push(`    Deadline: ${deadline}`);
        lines.push(`    Liveness: ${details.livenessPreview.action} — ${details.livenessPreview.reason}`);
        if (details.livenessPreview.escalateTo?.length) {
          lines.push(`    Escalate to: ${details.livenessPreview.escalateTo.join(", ")}`);
        }
        if (details.requiresHuman) {
          lines.push(`    Human action: required`);
        }
        if (details.availableActions?.length) {
          lines.push(`    Available actions: ${details.availableActions.join(", ")}`);
        }
      }
      const action = suggestedAction(b);
      if (action) {
        lines.push(`    Action:`);
        for (const line of action.split("\n")) {
          lines.push(`      ${line}`);
        }
      }
      lines.push("");
    }
  }

  // ── Operations ──
  if (snapshot.operations.length > 0) {
    lines.push("Operations");
    lines.push("─".repeat(40));
    for (const op of snapshot.operations) {
      lines.push(`  ${op.title} by ${op.actorName} [${op.status}] → ${op.needsAction}`);
    }
    lines.push("");
  }

  // ── Wake Queue ──
  if (snapshot.wakeQueue.length > 0) {
    lines.push("Wake Queue");
    lines.push("─".repeat(40));
    for (const w of snapshot.wakeQueue) {
      lines.push(`  ${w.targetAgentName}: ${w.reason || w.sourceEvent} [${w.status}]`);
    }
    lines.push("");
  }

  const recentEvents = snapshot.recentEvents ?? [];
  if (recentEvents.length > 0) {
    lines.push("Recent Events");
    lines.push("─".repeat(40));
    for (const event of recentEvents) {
      const summary = eventSummary(event);
      lines.push(`  ${event.createdAt} ${event.eventType} ${event.entityType}:${event.entityId}`);
      if (summary) lines.push(`    ${summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a demo blocked state — focused on explaining WHY the agent is blocked.
 */
export function formatBlockedExplanation(snapshot: Snapshot): string {
  const lines: string[] = [];

  const blockedAgents = snapshot.agents.filter(a => a.blocked || a.constraintBlocked);

  if (blockedAgents.length === 0 && snapshot.blockers.length === 0) {
    lines.push("No agents are currently blocked.");
    return lines.join("\n");
  }

  lines.push("SyncPoint blocked unsafe continuation.");
  lines.push("");

  for (const agent of blockedAgents) {
    lines.push(`Blocked agent:`);
    lines.push(`  ${agent.name} (${agent.provider})`);
    lines.push("");

    // Collect reasons
    const reasons: string[] = [];

    // File conflicts
    const seenConflictPaths = new Set<string>();
    for (const c of snapshot.resourceOwnership.conflicts) {
      if (c.claimA.actorId === agent.id || c.claimB.actorId === agent.id) {
        const other = c.claimA.actorId === agent.id ? c.claimB : c.claimA;
        const displayPath = c.overlappingLocator;
        if (!seenConflictPaths.has(displayPath)) {
          seenConflictPaths.add(displayPath);
          reasons.push(`${displayPath} is already claimed by ${other.actorName}`);
        }
      }
    }

    // Blocking gates (skip resource_conflict gates — already covered above)
    const seenReasons = new Set<string>();
    for (const b of snapshot.blockers) {
      if (b.type === "sync_gate" && agent.blockingGateIds.includes(b.id)) {
        if (b.reason === "resource_conflict") continue; // already shown via resource conflicts
        const reason = blockerReasonLabel(b.reason);
        if (!seenReasons.has(reason)) {
          seenReasons.add(reason);
          reasons.push(reason);
        }
      }
      if (b.type === "checkpoint_review") {
        const reason = "checkpoint requires approval before another agent continues";
        if (!seenReasons.has(reason)) {
          seenReasons.add(reason);
          reasons.push(reason);
        }
      }
      if (b.type === "review") {
        reasons.push(`review missing: ${b.description}`);
      }
    }

    if (agent.constraintBlocked) {
      reasons.push("constraint violation on working files");
    }

    if (reasons.length > 0) {
      lines.push("Why:");
      for (const r of reasons) {
        lines.push(`  - ${r}`);
      }
      lines.push("");
    }
  }

  // Current state summary
  lines.push("Current state:");
  lines.push(`  Resource conflicts: ${snapshot.resourceOwnership.stats.hardConflicts > 0 ? `${snapshot.resourceOwnership.stats.hardConflicts} hard` : "none"}`);
  lines.push(`  Sync gates: ${snapshot.gateStats.active} active`);
  lines.push(`  Operations: ${snapshot.operations.length > 0 ? snapshot.operations.map(op => op.status).join(", ") : "none"}`);
  lines.push(`  Wake queue: ${snapshot.wakeQueue.length} pending`);
  lines.push("");

  // Suggested actions
  if (snapshot.blockers.length > 0) {
    lines.push("Suggested actions:");
    for (const b of snapshot.blockers) {
      const action = suggestedAction(b);
      if (action) {
        for (const line of action.split("\n")) {
          lines.push(`  ${line}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format resume output with explainable blockers and recovery info.
 */
export function formatResumeExplanation(opts: {
  agentId: string;
  agentName: string;
  taskTitle: string;
  blocked: boolean;
  snapshotValid: boolean;
  protocolGateBlocked: boolean;
  validationNotes: string[];
  constraintWarnings: string[];
  goal?: string;
  phase?: string;
  completedWork?: string;
  remainingWork?: string;
  workingResources?: string;
  blockers?: string;
  nextSteps?: string;
}): string {
  const lines: string[] = [];

  if (opts.blocked) {
    lines.push("SyncPoint: Resume BLOCKED");
    lines.push("═".repeat(40));
  } else {
    lines.push("SyncPoint: Resume Ready");
    lines.push("═".repeat(40));
  }
  lines.push("");
  lines.push(`Agent: ${opts.agentName}`);
  lines.push(`Task:  ${opts.taskTitle}`);
  lines.push("");

  // Snapshot recovery info
  if (opts.goal) {
    lines.push("Snapshot:");
    lines.push(`  Goal: ${opts.goal}`);
    if (opts.phase) lines.push(`  Phase: ${opts.phase}`);
    if (opts.workingResources) lines.push(`  Working resources: ${opts.workingResources}`);
    if (opts.completedWork) lines.push(`  Completed: ${opts.completedWork}`);
    if (opts.remainingWork) lines.push(`  Remaining: ${opts.remainingWork}`);
    lines.push("");
  }

  // Blockers
  if (opts.protocolGateBlocked || !opts.snapshotValid || opts.constraintWarnings.length > 0) {
    lines.push("Blockers:");
    if (opts.protocolGateBlocked) {
      lines.push("  - Protocol gate is blocking continuation");
    }
    if (!opts.snapshotValid) {
      lines.push("  - Snapshot validation failed");
    }
    for (const w of opts.constraintWarnings) {
      lines.push(`  - ${w}`);
    }
    lines.push("");
  }

  if (opts.validationNotes.length > 0) {
    lines.push("Validation:");
    for (const n of opts.validationNotes) {
      lines.push(`  - ${n}`);
    }
    lines.push("");
  }

  if (opts.nextSteps) {
    lines.push(`Next steps: ${opts.nextSteps}`);
    lines.push("");
  }

  return lines.join("\n");
}
