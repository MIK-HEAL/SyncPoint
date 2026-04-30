/**
 * Playbook Engine — pure next-action computation.
 *
 * Given a session snapshot (status, roles, assignments, reviews, checklist/evidence state),
 * returns the next recommended action for a specific agent.
 * No side effects — all inputs are plain data.
 */

import { z } from "zod";
import { SessionStatus, TaskAssignmentStatus, ReviewRequestStatus } from "./orchestration.js";
import { ApprovalGateStatus } from "./review-workflow.js";
import type { ApprovalGateResult } from "./review-workflow.js";
import { RelationshipMode, MODE_SYNC_RULES, isModeActionAllowed } from "./relationship-mode.js";

// ── Action Kinds ────────────────────────────────────

export const PlaybookActionKind = z.enum([
  // Architect actions
  "plan-tasks",
  "assign-roles",
  "advance-session",

  // Executor actions
  "accept-assignment",
  "start-work",
  "checkpoint",
  "complete-assignment",
  "address-changes",

  // Reviewer actions
  "start-review",
  "add-checklist",
  "add-evidence",
  "evaluate-gate",
  "approve-review",
  "block-review",

  // Shared actions
  "request-review",
  "handoff",

  // Mode-specific sync actions
  "claim-files",
  "sync-checkpoint",

  // Terminal / informational
  "wait",
  "session-completed",
  "no-action",
]);
export type PlaybookActionKind = z.infer<typeof PlaybookActionKind>;

// ── NextAction Schema ───────────────────────────────

export const NextActionSchema = z.object({
  action: PlaybookActionKind,
  reason: z.string(),
  /** CLI command suggestion */
  cliHint: z.string(),
  /** MCP tool suggestion */
  mcpToolHint: z.string(),
  /** Priority: 1 = immediate, 2 = soon, 3 = optional */
  priority: z.number().int().min(1).max(3),
  /** Entity IDs relevant to this action */
  targetIds: z.record(z.string()).default({}),
});
export type NextAction = z.infer<typeof NextActionSchema>;

// ── Session Snapshot ────────────────────────────────

export interface SessionSnapshot {
  sessionId: string;
  sessionStatus: SessionStatus;
  agentId: string;
  agentRoles: string[]; // OrchestratorRole values the agent holds

  assignments: Array<{
    id: string;
    taskId: string;
    assigneeAgentId: string;
    status: TaskAssignmentStatus;
  }>;

  reviews: Array<{
    id: string;
    taskId: string;
    reviewerAgentId: string;
    status: ReviewRequestStatus;
  }>;

  /** Per-review gate status (only for reviews assigned to this agent) */
  gates: Record<string, ApprovalGateResult>;

  /** Open change request count per review request */
  openChanges: Record<string, number>;

  /** Relationship mode for this session (optional, defaults to manager-delegate) */
  relationshipMode?: RelationshipMode;

  /** Task IDs for which this agent already has active file claims */
  activeClaimTaskIds?: string[];
}

// ── Pure Computation ────────────────────────────────

/**
 * Compute the next recommended action(s) for an agent within a session.
 * Returns actions sorted by priority (most urgent first).
 */
export function computeNextActions(snap: SessionSnapshot): NextAction[] {
  const actions: NextAction[] = [];
  const { sessionStatus, agentId, agentRoles } = snap;

  // Terminal states
  if (sessionStatus === SessionStatus.COMPLETED) {
    return [{ action: "session-completed", reason: "Session is completed.", cliHint: "", mcpToolHint: "", priority: 3, targetIds: {} }];
  }
  if (sessionStatus === SessionStatus.CANCELLED) {
    return [{ action: "no-action", reason: "Session is cancelled.", cliHint: "", mcpToolHint: "", priority: 3, targetIds: {} }];
  }

  const isArchitect = agentRoles.includes("architect");
  const isExecutor = agentRoles.includes("executor");
  const isReviewer = agentRoles.includes("reviewer");

  const myAssignments = snap.assignments.filter(a => a.assigneeAgentId === agentId);
  const myReviews = snap.reviews.filter(r => r.reviewerAgentId === agentId);

  // ── PLANNING phase ──
  if (sessionStatus === SessionStatus.PLANNING) {
    if (isArchitect) {
      if (snap.assignments.length === 0) {
        actions.push({
          action: "plan-tasks",
          reason: "No tasks planned yet. Create tasks and assign them.",
          cliHint: "syncpoint session plan --session <id> --task <id> --assignee <agentId>",
          mcpToolHint: "syncpoint_session_plan_task",
          priority: 1,
          targetIds: { sessionId: snap.sessionId },
        });
      } else {
        actions.push({
          action: "advance-session",
          reason: "Tasks are planned. Advance session to EXECUTING.",
          cliHint: "syncpoint session advance --session <id>",
          mcpToolHint: "syncpoint_session_advance",
          priority: 1,
          targetIds: { sessionId: snap.sessionId },
        });
      }
    } else {
      actions.push({
        action: "wait",
        reason: "Waiting for architect to plan tasks.",
        cliHint: "syncpoint session status --session <id>",
        mcpToolHint: "syncpoint_session_status",
        priority: 3,
        targetIds: { sessionId: snap.sessionId },
      });
    }
  }

  // ── Mode rules ──
  const mode = snap.relationshipMode ?? RelationshipMode.MANAGER_DELEGATE;
  const syncRules = MODE_SYNC_RULES[mode];

  // ── EXECUTING phase ──
  if (sessionStatus === SessionStatus.EXECUTING) {
    // Executor: accept / start / complete assignments
    if (isExecutor) {
      for (const a of myAssignments) {
        if (a.status === TaskAssignmentStatus.PROPOSED) {
          actions.push({
            action: "accept-assignment",
            reason: `Assignment ${a.id} is proposed. Accept it to begin.`,
            cliHint: `syncpoint session accept --assignment ${a.id}`,
            mcpToolHint: "syncpoint_session_accept",
            priority: 1,
            targetIds: { assignmentId: a.id, taskId: a.taskId },
          });
        } else if (a.status === TaskAssignmentStatus.ACCEPTED) {
          // peer-contract: claim files before starting work
          const hasClaims = (snap.activeClaimTaskIds ?? []).includes(a.taskId);
          if (syncRules.requiresFileClaim && !hasClaims) {
            actions.push({
              action: "claim-files",
              reason: `Mode ${mode}: claim file ownership before starting work on task ${a.taskId}.`,
              cliHint: `syncpoint file claim --agent ${agentId} --task ${a.taskId} --paths "src/..."`,
              mcpToolHint: "syncpoint_file_claim",
              priority: 1,
              targetIds: { assignmentId: a.id, taskId: a.taskId },
            });
            // claim-files is required before start — don't suggest start-work yet
          } else {
            actions.push({
              action: "start-work",
              reason: `Assignment ${a.id} is accepted. Start working on it.`,
              cliHint: `syncpoint session start --assignment ${a.id}`,
              mcpToolHint: "syncpoint_session_start",
              priority: 1,
              targetIds: { assignmentId: a.id, taskId: a.taskId },
            });
          }
        } else if (a.status === TaskAssignmentStatus.IN_PROGRESS) {
          // Check for open change requests addressed to this task
          const relatedReview = snap.reviews.find(r => r.taskId === a.taskId);
          const hasOpenChanges = relatedReview && (snap.openChanges[relatedReview.id] ?? 0) > 0;

          if (hasOpenChanges) {
            actions.push({
              action: "address-changes",
              reason: `Open change requests on task ${a.taskId}. Address them before completing.`,
              cliHint: `syncpoint review changes-address --change <changeId>`,
              mcpToolHint: "syncpoint_review_changes_address",
              priority: 1,
              targetIds: { taskId: a.taskId, reviewRequestId: relatedReview!.id },
            });
          } else {
            actions.push({
              action: "checkpoint",
              reason: `Task ${a.taskId} is in progress. Save a checkpoint or complete.`,
              cliHint: `syncpoint loop checkpoint --agent ${agentId} --task ${a.taskId} --summary "..."`,
              mcpToolHint: "syncpoint_loop_checkpoint",
              priority: 2,
              targetIds: { assignmentId: a.id, taskId: a.taskId },
            });
            // peer-contract: suggest sync checkpoint for parallel coordination
            if (syncRules.requiresSyncGate) {
              actions.push({
                action: "sync-checkpoint",
                reason: `Mode ${mode}: consider requesting sync if file overlap detected.`,
                cliHint: `syncpoint sync request --task ${a.taskId} --agent ${agentId} --reason "checkpoint_required"`,
                mcpToolHint: "syncpoint_sync_request",
                priority: 2,
                targetIds: { assignmentId: a.id, taskId: a.taskId },
              });
            }
            // handoff-resume: suggest handoff instead of complete
            if (mode === RelationshipMode.HANDOFF_RESUME) {
              actions.push({
                action: "handoff",
                reason: `Mode ${mode}: hand off to next agent when ready.`,
                cliHint: `syncpoint loop handoff --task ${a.taskId} --from ${agentId} --to <nextAgentId>`,
                mcpToolHint: "syncpoint_loop_handoff",
                priority: 2,
                targetIds: { assignmentId: a.id, taskId: a.taskId },
              });
            }
            actions.push({
              action: "complete-assignment",
              reason: `Task ${a.taskId} is in progress. Complete if done.`,
              cliHint: `syncpoint session complete --assignment ${a.id}`,
              mcpToolHint: "syncpoint_session_complete",
              priority: 2,
              targetIds: { assignmentId: a.id, taskId: a.taskId },
            });
          }
        }
      }
    }

    // Architect: request review when all tasks completed, or advance
    if (isArchitect) {
      const allCompleted = snap.assignments.length > 0 &&
        snap.assignments.every(a => a.status === TaskAssignmentStatus.COMPLETED);
      if (allCompleted) {
        const unreviewedTasks = snap.assignments
          .filter(a => !snap.reviews.some(r => r.taskId === a.taskId))
          .map(a => a.taskId);
        if (unreviewedTasks.length > 0) {
          actions.push({
            action: "request-review",
            reason: `${unreviewedTasks.length} completed task(s) need review.`,
            cliHint: `syncpoint session review --session <id> --task <taskId> --reviewer <agentId>`,
            mcpToolHint: "syncpoint_session_request_review",
            priority: 1,
            targetIds: { sessionId: snap.sessionId, taskIds: unreviewedTasks.join(",") },
          });
        } else {
          actions.push({
            action: "advance-session",
            reason: "All tasks completed and reviews requested. Advance to REVIEWING.",
            cliHint: `syncpoint session advance --session <id>`,
            mcpToolHint: "syncpoint_session_advance",
            priority: 1,
            targetIds: { sessionId: snap.sessionId },
          });
        }
      }
    }
  }

  // ── REVIEWING phase ──
  if (sessionStatus === SessionStatus.REVIEWING) {
    if (isReviewer) {
      for (const r of myReviews) {
        if (r.status === ReviewRequestStatus.PENDING) {
          actions.push({
            action: "start-review",
            reason: `Review ${r.id} is pending. Start reviewing task ${r.taskId}.`,
            cliHint: `syncpoint session start-review --review ${r.id}`,
            mcpToolHint: "syncpoint_session_start_review",
            priority: 1,
            targetIds: { reviewRequestId: r.id, taskId: r.taskId },
          });
        } else if (r.status === ReviewRequestStatus.IN_PROGRESS) {
          const gate = snap.gates[r.id];
          if (!gate || gate.status === ApprovalGateStatus.BLOCKED) {
            // Gate missing or blocked — suggest adding checklist + evidence
            actions.push({
              action: "add-checklist",
              reason: gate ? `Gate BLOCKED: ${gate.reasons.join("; ")}. Add/update checklist items.` : `Review ${r.id} in progress. Add checklist items.`,
              cliHint: `syncpoint review checklist-add --review ${r.id} --title "..."`,
              mcpToolHint: "syncpoint_review_checklist_add",
              priority: 1,
              targetIds: { reviewRequestId: r.id },
            });
            actions.push({
              action: "add-evidence",
              reason: gate ? `Gate BLOCKED: ${gate.reasons.join("; ")}. Add evidence.` : `Review ${r.id} in progress. Record evidence.`,
              cliHint: `syncpoint review evidence-add --review ${r.id} --kind test --title "..." --content "..."`,
              mcpToolHint: "syncpoint_review_evidence_add",
              priority: 1,
              targetIds: { reviewRequestId: r.id },
            });
            if (gate) {
              actions.push({
                action: "block-review",
                reason: `Gate blocked. Consider blocking with change requests.`,
                cliHint: `syncpoint review block --review ${r.id} --summary "..." --changes "..."`,
                mcpToolHint: "syncpoint_review_block",
                priority: 2,
                targetIds: { reviewRequestId: r.id },
              });
            }
          } else if (gate.status === ApprovalGateStatus.PASSED) {
            actions.push({
              action: "approve-review",
              reason: `Gate PASSED for review ${r.id}. Approve to proceed.`,
              cliHint: `syncpoint review approve --review ${r.id} --summary "..."`,
              mcpToolHint: "syncpoint_review_approve",
              priority: 1,
              targetIds: { reviewRequestId: r.id },
            });
          }
        }
      }
    }

    // Architect: advance after all reviews decided
    if (isArchitect) {
      const allDecided = snap.reviews.length > 0 &&
        snap.reviews.every(r => r.status === ReviewRequestStatus.DECIDED);
      if (allDecided) {
        actions.push({
          action: "advance-session",
          reason: "All reviews decided. Advance session.",
          cliHint: `syncpoint session advance --session <id>`,
          mcpToolHint: "syncpoint_session_advance",
          priority: 1,
          targetIds: { sessionId: snap.sessionId },
        });
      }
    }
  }

  // Filter out actions that are blocked by the current mode
  const filtered = actions.filter(a => isModeActionAllowed(mode, a.action) !== "blocked");

  // Sort by priority
  filtered.sort((a, b) => a.priority - b.priority);

  if (filtered.length === 0) {
    return [{
      action: "wait",
      reason: "No actionable items for this agent right now.",
      cliHint: `syncpoint session status --session ${snap.sessionId}`,
      mcpToolHint: "syncpoint_session_status",
      priority: 3,
      targetIds: { sessionId: snap.sessionId },
    }];
  }

  return filtered;
}
