/**
 * Shared formatting helpers used by the CLI formatter.
 *
 * Pure utility functions for label mapping, indentation, deadline
 * formatting, and suggested-action generation.
 */

import type { UnifiedBlocker } from "syncpoint-server/application";
import type { SnapshotEvent } from "./formatter-types.js";

// ── Formatting helpers ──

export function indent(text: string, level = 1): string {
  const pad = "  ".repeat(level);
  return text.split("\n").map(l => pad + l).join("\n");
}

export function blockerTypeLabel(type: string): string {
  switch (type) {
    case "sync_gate": return "Sync Gate";
    case "checkpoint_review": return "Checkpoint Review";
    case "handoff": return "Pending Handoff";
    case "review": return "Review Required";
    case "operation": return "Operation";
    default: return type;
  }
}

export function blockerReasonLabel(reason: string): string {
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

export function suggestedAction(blocker: UnifiedBlocker): string {
  switch (blocker.type) {
    case "sync_gate":
      return `syncpoint sync ack --gate ${blocker.id} --agent <agentId>\n` +
             `syncpoint sync resolve --gate ${blocker.id} --summary "Resolved"`;
    case "checkpoint_review":
      return `syncpoint checkpoint review approve --tx ${blocker.id} --agent <agentId>`;
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

export function agentLabel(id: string, agents: Array<{ id: string; name: string }>): string {
  return agents.find(a => a.id === id)?.name ?? id;
}

export function formatDeadline(deadlineAt?: string): string | undefined {
  if (!deadlineAt) return undefined;
  const deadline = new Date(deadlineAt);
  if (Number.isNaN(deadline.getTime())) return deadlineAt;
  const deltaMs = deadline.getTime() - Date.now();
  const absSeconds = Math.abs(Math.round(deltaMs / 1000));
  const minutes = Math.floor(absSeconds / 60);
  const seconds = absSeconds % 60;
  const suffix = deltaMs >= 0 ? `${minutes}m ${seconds}s remaining` : `${minutes}m ${seconds}s overdue`;
  return `${deadlineAt} (${suffix})`;
}

export function formatVoteCounts(counts: Record<string, number>): string {
  const keys = ["approve", "reject", "abstain", "escalate"];
  return keys.map(key => `${key}:${counts[key] ?? 0}`).join(" ");
}

export function eventSummary(event: SnapshotEvent): string {
  if (!event.detail) return "";
  try {
    const detail = JSON.parse(event.detail);
    const parts = [
      detail.locator ? `locator=${detail.locator}` : "",
      detail.decision ? `decision=${detail.decision}` : "",
      detail.gateId ? `gate=${detail.gateId}` : "",
    ].filter(Boolean);
    return parts.join(" ");
  } catch {
    return event.detail;
  }
}
