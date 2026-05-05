/**
 * Blocker Explanation Formatter — shared human-readable output for CLI.
 *
 * Turns raw snapshot data into explainable output that answers:
 *   - Who is blocked?
 *   - Why?
 *   - What needs to happen?
 *   - What command to run?
 */

import type { UnifiedBlocker } from "syncpoint-server/application";

// ── Snapshot types (mirror sync-status-service output) ──

interface SnapshotAgent {
  id: string;
  name: string;
  status: string;
  provider: string;
  role: string;
  blocked: boolean;
  blockingGateIds: string[];
  constraintBlocked: boolean;
  constraintBlockerCount: number;
  constraintWarningCount: number;
  activeAssignments: Array<{ id: string; taskId: string; taskTitle: string; status: string }>;
  claimedResources: Array<{ claimId: string; resources: any[]; mode: string; taskId: string }>;
  pendingWakeCount: number;
}

interface SnapshotSession {
  id: string;
  title: string;
  status: string;
  relationshipMode: string;
  agents: Array<{ agentId: string; agentName: string; role: string }>;
}

interface SnapshotConflict {
  overlappingLocator: string;
  claimA: { id: string; actorId: string; actorName: string; mode: string };
  claimB: { id: string; actorId: string; actorName: string; mode: string };
}

interface SnapshotClaim {
  id: string;
  actorId: string;
  actorName: string;
  taskId: string;
  taskTitle: string;
  resources: Array<{ type: string; locator: string; metadata: string }>;
  mode: string;
}

interface SnapshotOperation {
  id: string;
  title: string;
  actorId: string;
  actorName: string;
  status: string;
  taskId: string;
  taskTitle: string;
  needsAction: string;
}

interface SnapshotWake {
  id: string;
  targetAgentId: string;
  targetAgentName: string;
  sourceEvent: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface Snapshot {
  timestamp: string;
  sessions: SnapshotSession[];
  agents: SnapshotAgent[];
  resourceOwnership: {
    activeClaims: SnapshotClaim[];
    conflicts: SnapshotConflict[];
    stats: {
      totalClaims: number;
      exclusiveClaims: number;
      sharedClaims: number;
      hardConflicts: number;
      softConflicts: number;
    };
  };
  blockers: UnifiedBlocker[];
  blockerCount: number;
  operations: SnapshotOperation[];
  wakeQueue: SnapshotWake[];
  gateStats: { total: number; active: number; resolved: number; cancelled: number };
  summary: {
    activeSessionCount: number;
    agentCount: number;
    blockedAgentCount: number;
    activeClaimCount: number;
    hardConflictCount: number;
    pendingOperationCount: number;
    pendingWakeCount: number;
    blockerCount: number;
    constraintBlockedAgents: number;
    constraintBlockedTasks: number;
  };
}

// ── Formatting helpers ──

function indent(text: string, level = 1): string {
  const pad = "  ".repeat(level);
  return text.split("\n").map(l => pad + l).join("\n");
}

function blockerTypeLabel(type: string): string {
  switch (type) {
    case "sync_gate": return "Sync Gate";
    case "sync_transaction": return "Checkpoint Transaction";
    case "handoff": return "Pending Handoff";
    case "review": return "Review Required";
    case "operation": return "Operation";
    default: return type;
  }
}

function blockerReasonLabel(reason: string): string {
  switch (reason) {
    case "resource_conflict": return "resource ownership conflict";
    case "checkpoint_required": return "checkpoint requires approval";
    case "checkpoint_approval": return "checkpoint waiting for approval";
    case "manual_request": return "manual sync request";
    case "review_requested": return "review not started";
    case "review_in_progress": return "review in progress";
    case "handoff_pending": return "handoff waiting for acceptance";
    case "operation_awaiting_approval": return "operation awaiting approval";
    case "operation_conflict": return "operation has conflicts";
    default: return reason;
  }
}

function suggestedAction(blocker: UnifiedBlocker): string {
  switch (blocker.type) {
    case "sync_gate":
      return `syncpoint sync ack --gate ${blocker.id} --agent <agentId>\n` +
             `syncpoint sync resolve --gate ${blocker.id} --summary "Resolved"`;
    case "sync_transaction":
      return `syncpoint sync tx approve --tx ${blocker.id} --agent <agentId>`;
    case "handoff":
      return `syncpoint handoff accept --handoff ${blocker.id}`;
    case "review":
      return `syncpoint review approve --review ${blocker.id} --summary "Approved" --by <agentId>`;
    case "operation":
      if (blocker.reason === "operation_conflict") {
        return `syncpoint operation check --id ${blocker.id}\nsyncpoint operation submit --id ${blocker.id}`;
      }
      return `syncpoint operation approve --id ${blocker.id} --agent <agentId>`;
    default:
      return "";
  }
}

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
      if (b.type === "sync_transaction") {
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
  const fo = snapshot.resourceOwnership;
  lines.push("Current state:");
  lines.push(`  Resource conflicts: ${fo.stats.hardConflicts > 0 ? `${fo.stats.hardConflicts} hard` : "none"}`);
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
  capsuleValid: boolean;
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

  // Capsule recovery info
  if (opts.goal) {
    lines.push("Capsule:");
    lines.push(`  Goal: ${opts.goal}`);
    if (opts.phase) lines.push(`  Phase: ${opts.phase}`);
    if (opts.workingResources) lines.push(`  Working resources: ${opts.workingResources}`);
    if (opts.completedWork) lines.push(`  Completed: ${opts.completedWork}`);
    if (opts.remainingWork) lines.push(`  Remaining: ${opts.remainingWork}`);
    lines.push("");
  }

  // Blockers
  if (opts.protocolGateBlocked || !opts.capsuleValid || opts.constraintWarnings.length > 0) {
    lines.push("Blockers:");
    if (opts.protocolGateBlocked) {
      lines.push("  - Protocol gate is blocking continuation");
    }
    if (!opts.capsuleValid) {
      lines.push("  - Capsule validation failed");
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
