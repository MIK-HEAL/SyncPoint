import { OrchestrationEventType } from "syncpoint-core";
import type { SyncPointEventData } from "../../event-bus.js";
import {
  getReviewRequest,
  getTaskAssignment,
} from "../../repositories/_exports/orchestration.js";

export const ORCHESTRATION_EVENT_SET = new Set<string>(
  Object.values(OrchestrationEventType),
);

export function parseSessionIdFromDetail(detail?: string): string | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    return parsed.sessionId ?? null;
  } catch {
    if (detail.startsWith("session:")) return detail.slice(8);
    return detail;
  }
}

export function resolveTaskId(event: SyncPointEventData): string | null {
  if (
    event.eventType === OrchestrationEventType.ASSIGNMENT_CREATED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_ACCEPTED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_STARTED ||
    event.eventType === OrchestrationEventType.ASSIGNMENT_COMPLETED
  ) {
    try {
      const assignment = getTaskAssignment(event.entityId);
      return assignment.taskId;
    } catch { return null; }
  }
  if (
    event.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    event.eventType === OrchestrationEventType.REVIEW_STARTED ||
    event.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    event.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    event.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    try {
      const review = getReviewRequest(event.entityId);
      return review.taskId;
    } catch { return null; }
  }
  return null;
}

export function resolveReviewRequestId(event: SyncPointEventData): string | null {
  if (
    event.eventType === OrchestrationEventType.REVIEW_REQUESTED ||
    event.eventType === OrchestrationEventType.REVIEW_STARTED ||
    event.eventType === OrchestrationEventType.REVIEW_DECIDED ||
    event.eventType === OrchestrationEventType.REVIEW_APPROVED ||
    event.eventType === OrchestrationEventType.REVIEW_BLOCKED
  ) {
    return event.entityId;
  }
  return null;
}

export function mapActionToPrompt(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint_architect_plan",
    "accept-assignment": "syncpoint_executor_resume",
    "start-work": "syncpoint_executor_resume",
    "checkpoint": "syncpoint_executor_resume",
    "complete-assignment": "syncpoint_executor_resume",
    "address-changes": "syncpoint_executor_resume",
    "start-review": "syncpoint_review_with_evidence",
    "add-checklist": "syncpoint_review_with_evidence",
    "add-evidence": "syncpoint_review_with_evidence",
    "evaluate-gate": "syncpoint_review_with_evidence",
    "approve-review": "syncpoint_review_with_evidence",
    "block-review": "syncpoint_review_with_evidence",
    "request-review": "syncpoint_architect_plan",
    "advance-session": "syncpoint_session_playbook",
  };
  return map[action] ?? "";
}

export function mapActionToMcpTool(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint_session_plan_task",
    "accept-assignment": "syncpoint_session_accept",
    "start-work": "syncpoint_session_start",
    "complete-assignment": "syncpoint_session_complete",
    "request-review": "syncpoint_session_request_review",
    "start-review": "syncpoint_session_start_review",
    "add-checklist": "syncpoint_review_checklist_add",
    "add-evidence": "syncpoint_review_evidence_add",
    "evaluate-gate": "syncpoint_review_gate",
    "approve-review": "syncpoint_review_approve",
    "block-review": "syncpoint_review_block",
    "address-changes": "syncpoint_review_changes_address",
    "advance-session": "syncpoint_session_advance",
    "checkpoint": "syncpoint_loop_checkpoint",
  };
  return map[action] ?? "";
}

export function mapActionToCli(action: string): string {
  const map: Record<string, string> = {
    "plan-tasks": "syncpoint session plan --session <id> --task <id> --assignee <agentId>",
    "accept-assignment": "syncpoint session accept --assignment <id>",
    "start-work": "syncpoint session start --assignment <id>",
    "complete-assignment": "syncpoint session complete --assignment <id>",
    "request-review": "syncpoint session review --session <id> --task <id> --reviewer <agentId>",
    "start-review": "syncpoint session start-review --review <id>",
    "add-checklist": "syncpoint review checklist-add --review <id> --title '...'",
    "add-evidence": "syncpoint review evidence-add --review <id> --kind test --title '...' --content '...'",
    "evaluate-gate": "syncpoint review gate --review <id>",
    "approve-review": "syncpoint review approve --review <id> --summary '...'",
    "block-review": "syncpoint review block --review <id> --summary '...'",
    "address-changes": "syncpoint review changes-address --change <id>",
    "advance-session": "syncpoint session advance --session <id>",
    "checkpoint": "syncpoint loop checkpoint --agent <id> --task <id> --summary '...'",
  };
  return map[action] ?? "";
}
