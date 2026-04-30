/**
 * CLI commands for synchronization sessions.
 */

import { Command } from "commander";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
  orchSubmitReview,
  orchGetSessionStatus,
  orchAdvanceSession,
  orchCancelSession,
} from "syncpoint-server/application";
import type { OrchestratorRole, ReviewVerdict } from "syncpoint-core";
import { RelationshipMode } from "syncpoint-core";

export function registerSessionCommands(program: Command): void {
  const session = program
    .command("session")
    .description("Manage synchronization sessions");

  // ── create ─────────────────────────────────────────
  session
    .command("create")
    .description("Create a new synchronization session")
    .requiredOption("--title <title>", "Session title")
    .option("--description <desc>", "Session description")
    .option("--architect <agentId>", "Architect agent ID")
    .option("--mode <mode>", "Relationship mode: manager-delegate|peer-contract|handoff-resume", "manager-delegate")
    .option("--json", "Output JSON")
    .action((opts) => {
      const validModes = Object.values(RelationshipMode) as string[];
      if (!validModes.includes(opts.mode)) {
        throw new Error(`Invalid mode: ${opts.mode}. Must be one of: ${validModes.join(", ")}`);
      }
      const result = orchCreateSession({
        title: opts.title,
        description: opts.description,
        relationshipMode: opts.mode,
        architectId: opts.architect,
        createdBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Session created: ${result.session.id} [${result.session.status}]`);
        console.log(`  Title: ${result.session.title}`);
        console.log(`  Mode: ${result.session.relationshipMode}`);
        if (result.architectRole) {
          console.log(`  Architect: ${result.architectRole.agentId}`);
        }
      }
    });

  // ── status ─────────────────────────────────────────
  session
    .command("status")
    .description("Get synchronization session status overview")
    .requiredOption("--session <id>", "Session ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = orchGetSessionStatus(opts.session);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Session: ${result.session.title} [${result.session.status}]`);
        console.log(`  Mode: ${result.session.relationshipMode}`);
        console.log(`  Roles: ${result.roles.map(r => `${r.agentId}=${r.role}`).join(", ") || "none"}`);
        console.log(`  Assignments: ${result.assignments.length}`);
        console.log(`  Reviews: ${result.reviews.length}`);
        console.log(`  Decisions: ${result.decisions.length}`);
      }
    });

  // ── assign-role ────────────────────────────────────
  session
    .command("assign-role")
    .description("Assign a sync responsibility to an agent within a session")
    .requiredOption("--session <id>", "Session ID")
    .requiredOption("--agent <agentId>", "Agent ID")
    .requiredOption("--role <role>", "Role: architect|executor|reviewer|owner")
    .option("--json", "Output JSON")
    .action((opts) => {
      const rp = orchAssignRole({
        sessionId: opts.session,
        agentId: opts.agent,
        role: opts.role as OrchestratorRole,
      });
      if (opts.json) {
        console.log(JSON.stringify(rp, null, 2));
      } else {
        console.log(`Role assigned: ${rp.agentId} → ${rp.role}`);
      }
    });

  // ── plan ───────────────────────────────────────────
  session
    .command("plan")
    .description("Plan a task assignment within a sync session")
    .requiredOption("--session <id>", "Session ID")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--assignee <agentId>", "Assignee agent ID")
    .option("--notes <notes>", "Assignment notes")
    .option("--json", "Output JSON")
    .action((opts) => {
      const ta = orchPlanTask({
        sessionId: opts.session,
        taskId: opts.task,
        assigneeAgentId: opts.assignee,
        assignedBy: "cli",
        notes: opts.notes,
      });
      if (opts.json) {
        console.log(JSON.stringify(ta, null, 2));
      } else {
        console.log(`Task assigned: ${ta.taskId} → ${ta.assigneeAgentId} [${ta.status}]`);
      }
    });

  // ── accept ─────────────────────────────────────────
  session
    .command("accept")
    .description("Accept a task assignment")
    .requiredOption("--assignment <id>", "Assignment ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const ta = orchAcceptAssignment(opts.assignment);
      if (opts.json) {
        console.log(JSON.stringify(ta, null, 2));
      } else {
        console.log(`Assignment accepted: ${ta.id} [${ta.status}]`);
      }
    });

  // ── start ──────────────────────────────────────────
  session
    .command("start")
    .description("Start work if no synchronization gate blocks the assignment")
    .requiredOption("--assignment <id>", "Assignment ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const ta = orchStartAssignment(opts.assignment);
      if (opts.json) {
        console.log(JSON.stringify(ta, null, 2));
      } else {
        console.log(`Assignment started: ${ta.id} [${ta.status}]`);
      }
    });

  // ── complete ───────────────────────────────────────
  session
    .command("complete")
    .description("Complete a task assignment")
    .requiredOption("--assignment <id>", "Assignment ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const ta = orchCompleteAssignment(opts.assignment);
      if (opts.json) {
        console.log(JSON.stringify(ta, null, 2));
      } else {
        console.log(`Assignment completed: ${ta.id} [${ta.status}]`);
      }
    });

  // ── review ─────────────────────────────────────────
  session
    .command("review")
    .description("Request a review for a task")
    .requiredOption("--session <id>", "Session ID")
    .requiredOption("--task <taskId>", "Task ID")
    .requiredOption("--reviewer <agentId>", "Reviewer agent ID")
    .option("--scope <scope>", "Review scope")
    .option("--json", "Output JSON")
    .action((opts) => {
      const rr = orchRequestReview({
        sessionId: opts.session,
        taskId: opts.task,
        reviewerAgentId: opts.reviewer,
        requestedBy: "cli",
        scope: opts.scope,
      });
      if (opts.json) {
        console.log(JSON.stringify(rr, null, 2));
      } else {
        console.log(`Review requested: ${rr.id} [${rr.status}]`);
      }
    });

  // ── start-review ───────────────────────────────────
  session
    .command("start-review")
    .description("Start reviewing a review request")
    .requiredOption("--review <id>", "Review request ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const rr = orchStartReview(opts.review);
      if (opts.json) {
        console.log(JSON.stringify(rr, null, 2));
      } else {
        console.log(`Review started: ${rr.id} [${rr.status}]`);
      }
    });

  // ── decide ─────────────────────────────────────────
  session
    .command("decide")
    .description("Submit a review decision")
    .requiredOption("--review <id>", "Review request ID")
    .requiredOption("--verdict <verdict>", "Verdict: approved|request-changes|rejected")
    .requiredOption("--summary <text>", "Decision summary")
    .option("--changes <text>", "Requested changes (for request-changes verdict)")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = orchSubmitReview({
        reviewRequestId: opts.review,
        verdict: opts.verdict as ReviewVerdict,
        summary: opts.summary,
        requestedChanges: opts.changes,
        decidedBy: "cli",
      });
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Review decided: ${result.decision.verdict}`);
        console.log(`  ${result.decision.summary}`);
      }
    });

  // ── advance ────────────────────────────────────────
  session
    .command("advance")
    .description("Advance session status based on current state")
    .requiredOption("--session <id>", "Session ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const result = orchAdvanceSession(opts.session);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Session: ${result.session.id} [${result.session.status}]`);
        console.log(`  Transitioned: ${result.transitioned}`);
        console.log(`  Reason: ${result.reason}`);
      }
    });

  // ── cancel ─────────────────────────────────────────
  session
    .command("cancel")
    .description("Cancel a session")
    .requiredOption("--session <id>", "Session ID")
    .option("--json", "Output JSON")
    .action((opts) => {
      const s = orchCancelSession(opts.session);
      if (opts.json) {
        console.log(JSON.stringify(s, null, 2));
      } else {
        console.log(`Session cancelled: ${s.id} [${s.status}]`);
      }
    });
}
