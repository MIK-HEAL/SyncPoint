/**
 * CLI demo commands — entry point.
 *
 * Scenario implementations: demo-scenarios.ts
 * Output formatting: demo-output.ts
 * Shared types/helpers: demo-core.ts
 */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { ContractStatus } from "syncpoint-adapters";
import {
  ProjectMemoryCategory,
  ProjectMemoryConfidence,
  ProjectMemoryScope,
  ProjectMemorySourceType,
} from "syncpoint-context";
import { ChecklistItemStatus } from "syncpoint-governance";
import { getSyncpointDir } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchCompleteAssignment,
  orchRequestReview,
  orchStartReview,
  orchAdvanceSession,
  orchGetSessionStatus,
  rwCreateChecklistItem,
  rwUpdateChecklistItem,
  rwAddEvidence,
  rwEvaluateGate,
  rwApproveReview,
  rwPrepareReviewPacket,
  pmAdd,
  pmApprove,
  pmExport,
} from "syncpoint-server/application";
import { setupDemoProject } from "./demo-core.js";
import { writeDemoReport } from "./demo-output.js";
import { runDisasterDemo, runResourceDemo } from "./demo-scenarios.js";
import type { DemoResult } from "./demo-core.js";

export function registerDemoCommands(program: Command): void {
  const demo = program
    .command("demo")
    .description("Run SyncPoint demos — shows how agents get blocked and unblocked")
    .action(() => {
      runDisasterDemo({
        project: path.join(process.cwd(), ".syncpoint", "demo-workspace"),
        keep: false,
        json: false,
        stage: "all",
      });
    });

  demo
    .command("conflict")
    .description("File conflict blocking demo — two agents claim the same file")
    .option("--project <dir>", "Project directory for demo state",
      path.join(process.cwd(), ".syncpoint", "demo-workspace"))
    .option("--keep", "Keep demo workspace for inspection", false)
    .option("--json", "Machine-readable JSON output")
    .option("--stage <stage>", "Run specific stage: blocked, resolve, all", "all")
    .action((opts) => { runDisasterDemo(opts); });

  demo
    .command("resource")
    .description("Resource-first demo — two agents claim the same binary asset, not code")
    .option("--project <dir>", "Project directory for demo state",
      path.join(process.cwd(), ".syncpoint", "resource-demo-workspace"))
    .option("--json", "Machine-readable JSON output")
    .action((opts) => { runResourceDemo(opts); });

  demo
    .command("mvp")
    .description("Create a full local MVP demo and write a showcase report")
    .option("--project <dir>", "Project directory to initialize/use",
      path.join(process.cwd(), ".syncpoint", "mvp-demo-workspace"))
    .option("--output <file>", "Markdown report path")
    .option("--json", "Output JSON")
    .action((opts) => { runMvpDemo(opts); });
}

// ── MVP Demo ──────────────────────────────────────────────

function runMvpDemo(opts: { project: string; output?: string; json?: boolean }): void {
  const { projectRoot, syncpointDir } = setupDemoProject(opts.project);

  const architect = repo.createAgent({ name: "mvp-architect", provider: "claude-code", role: "manager" });
  const executor = repo.createAgent({ name: "mvp-executor", provider: "codex", role: "backend" });
  const reviewer = repo.createAgent({ name: "mvp-reviewer", provider: "cursor", role: "reviewer" });

  const memories = [
    pmAdd({
      scope: ProjectMemoryScope.PROJECT, category: ProjectMemoryCategory.OVERVIEW,
      title: "SyncPoint MVP positioning",
      content: "SyncPoint is a local synchronization protocol layer for editor AI agents.",
      tags: ["mvp", "positioning"], sourceType: ProjectMemorySourceType.AGENT,
      sourceRef: "syncpoint-demo-mvp", confidence: ProjectMemoryConfidence.HIGH,
      taskId: null, createdBy: architect.id,
    }),
    pmAdd({
      scope: ProjectMemoryScope.PROJECT, category: ProjectMemoryCategory.ARCHITECTURE,
      title: "Layered protocol architecture",
      content: "Core defines protocol types; server owns application use cases; CLI and MCP are transport/adapters.",
      tags: ["architecture", "boundary"], sourceType: ProjectMemorySourceType.AGENT,
      sourceRef: "syncpoint-demo-mvp", confidence: ProjectMemoryConfidence.HIGH,
      taskId: null, createdBy: architect.id,
    }),
    pmAdd({
      scope: ProjectMemoryScope.PROJECT, category: ProjectMemoryCategory.DECISION,
      title: "Review requires evidence",
      content: "Reviewer approval must be backed by checklist state and at least one evidence record.",
      tags: ["review", "approval"], sourceType: ProjectMemorySourceType.AGENT,
      sourceRef: "syncpoint-demo-mvp", confidence: ProjectMemoryConfidence.HIGH,
      taskId: null, createdBy: reviewer.id,
    }),
  ];
  for (const memory of memories) pmApprove(memory.id, "demo");
  const memoryExport = pmExport(undefined, "demo");

  const task = repo.createTask({
    title: "MVP: evidence-backed multi-agent review",
    description: "Show Architect -> Executor -> Reviewer collaboration with checkpoint, snapshot, gate, and approval.",
  });
  repo.assignTask(task.id, executor.id);

  const contractDraft = repo.createContract({
    taskId: task.id, title: "MVP demo contract",
    participants: [architect.id, executor.id, reviewer.id],
    scope: "Implement and review a showcase-ready SyncPoint MVP flow.",
    responsibilities: ["Architect plans", "Executor implements", "Reviewer validates evidence"],
    interfaceSpec: ["CLI/MCP share application services and local SQLite state."],
    resourceBoundaries: ["Demo data and generated report stay under the project .syncpoint directory."],
    dependencies: ["syncpoint-core", "syncpoint-server", "syncpoint-cli", "syncpoint-mcp"],
    testPlan: "Record build, typecheck, and test evidence before approval.",
    risks: "Approval without evidence is blocked by the review workflow gate.",
  });
  repo.updateContractStatus(contractDraft.id, ContractStatus.REVIEWING);
  const contract = repo.updateContractStatus(contractDraft.id, ContractStatus.APPROVED);

  const sessionResult = orchCreateSession({
    title: "MVP Demo Session",
    description: "Presentation-ready SyncPoint synchronization session.",
    architectId: architect.id, createdBy: "demo",
  });
  orchAssignRole({ sessionId: sessionResult.session.id, agentId: executor.id, role: "executor" });
  orchAssignRole({ sessionId: sessionResult.session.id, agentId: reviewer.id, role: "reviewer" });
  const assignment = orchPlanTask({
    sessionId: sessionResult.session.id, taskId: task.id, assigneeAgentId: executor.id,
    assignedBy: architect.id,
    notes: "Use checkpoint, snapshot, review evidence, and approval gate.",
  });
  orchAdvanceSession(sessionResult.session.id);
  orchAcceptAssignment(assignment.id);
  orchStartAssignment(assignment.id);

  const checkpoint = repo.createCheckpoint({
    taskId: task.id, agentId: executor.id,
    summary: "MVP workflow implemented for demo data.",
    progress: "100%",
    currentUnderstanding: "SyncPoint can coordinate synchronization boundaries and evidence-backed review.",
    changedResources: ["packages/syncpoint-cli/src/commands/demo.ts", "docs/mvp-showcase.md"],
    risks: "Keep MVP focused on local protocol and avoid overpromising automatic runtime.",
    blockers: "", nextSteps: "Reviewer validates evidence and approval gate.", needSync: false,
  });

  const snapshot = repo.createContextSnapshot({
    taskId: task.id, agentId: executor.id, checkpointId: checkpoint.id,
    summary: "Demonstrate a complete SyncPoint collaboration loop.",
    payload: {
      goal: "Demonstrate a complete SyncPoint collaboration loop.",
      currentPhase: "review",
      confirmedDecisions: ["Use local SQLite state, CLI, MCP, and evidence-backed review."],
      interfaceContract: "Review approval requires checklist + evidence + no open changes.",
      workingResources: ["packages/syncpoint-cli/src/commands/demo.ts", "docs/review-workflow.md"],
      completedWork: "Session, task, contract, memory, checkpoint, snapshot, review evidence, and approval gate are created.",
      remainingWork: "Present the generated report.",
      risks: ["Demo is local-first and does not claim autonomous model scheduling."],
      blockers: [],
      nextSteps: ["Show mvp-demo.md and run session/review status commands."],
      resumePrompt: "Continue from the generated MVP demo report and inspect the review packet.",
    },
  });

  orchCompleteAssignment(assignment.id);
  orchAdvanceSession(sessionResult.session.id);

  const reviewRequest = orchRequestReview({
    sessionId: sessionResult.session.id, taskId: task.id, reviewerAgentId: reviewer.id,
    requestedBy: architect.id,
    scope: "Validate architecture boundary, context artifacts, and review evidence.",
  });
  orchStartReview(reviewRequest.id);

  const checklist = [
    rwCreateChecklistItem({ reviewRequestId: reviewRequest.id, title: "Project memory approved", required: true }),
    rwCreateChecklistItem({ reviewRequestId: reviewRequest.id, title: "Checkpoint and snapshot exist", required: true }),
    rwCreateChecklistItem({ reviewRequestId: reviewRequest.id, title: "Evidence-backed approval gate", required: true }),
  ];
  for (const item of checklist) {
    rwUpdateChecklistItem(item.id, ChecklistItemStatus.PASSED, {
      notes: "Verified in generated MVP flow.", updatedBy: reviewer.id,
    });
  }

  rwAddEvidence({
    reviewRequestId: reviewRequest.id, kind: "build", title: "pnpm build",
    content: "All workspace packages build successfully in the MVP validation flow.",
    metadataJson: JSON.stringify({ command: "pnpm build", source: "demo" }),
    createdBy: reviewer.id,
  });
  rwAddEvidence({
    reviewRequestId: reviewRequest.id, kind: "typecheck", title: "pnpm typecheck",
    content: "TypeScript project references typecheck successfully.",
    metadataJson: JSON.stringify({ command: "pnpm typecheck", source: "demo" }),
    createdBy: reviewer.id,
  });
  rwAddEvidence({
    reviewRequestId: reviewRequest.id, kind: "test", title: "pnpm test",
    content: "Full test suite is expected to pass before external presentation.",
    metadataJson: JSON.stringify({ command: "pnpm test", source: "demo" }),
    createdBy: reviewer.id,
  });

  const gate = rwEvaluateGate(reviewRequest.id);
  const approval = rwApproveReview({
    reviewRequestId: reviewRequest.id,
    summary: "MVP flow approved: checklist passed, evidence exists, and no open changes remain.",
    decidedBy: reviewer.id,
  });
  orchAdvanceSession(sessionResult.session.id);
  const finalSessionStatus = orchGetSessionStatus(sessionResult.session.id);
  const packet = rwPrepareReviewPacket(reviewRequest.id);

  const reportPath = path.resolve(opts.output ?? path.join(getSyncpointDir(), "mvp-demo.md"));
  writeDemoReport(reportPath, {
    projectRoot, syncpointDir, memoryPath: memoryExport.path,
    architect, executor, reviewer, task, contract,
    session: sessionResult.session, assignmentId: assignment.id,
    reviewRequestId: reviewRequest.id, checkpointId: checkpoint.id,
    snapshotId: snapshot.id, gateStatus: gate.status,
    approvalRecordId: approval.approvalRecord.id,
    reviewDecisionId: approval.reviewDecision.id,
    finalSessionStatus,
  });

  const result: DemoResult = {
    ok: true, projectRoot, syncpointDir, reportPath, memoryPath: memoryExport.path,
    agents: { architectId: architect.id, executorId: executor.id, reviewerId: reviewer.id },
    taskId: task.id, contractId: contract.id, sessionId: sessionResult.session.id,
    assignmentId: assignment.id, reviewRequestId: reviewRequest.id,
    approvalRecordId: approval.approvalRecord.id,
    reviewDecisionId: approval.reviewDecision.id,
    gateStatus: packet.gate.status, sessionStatus: finalSessionStatus.session.status,
  };

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("SyncPoint MVP demo created.");
  console.log(`  Report:  ${reportPath}`);
  console.log(`  Memory:  ${memoryExport.path}`);
  console.log(`  Session: ${sessionResult.session.id} [${finalSessionStatus.session.status}]`);
  console.log(`  Review:  ${reviewRequest.id} gate=${packet.gate.status}`);
  console.log("");
  console.log("Show this report:");
  console.log(`  ${reportPath}`);
  console.log("");
  console.log("Useful commands:");
  console.log(`  syncpoint session status --session ${sessionResult.session.id}`);
  console.log(`  syncpoint review packet --review ${reviewRequest.id}`);
}
