/**
 * Demo scenarios — disaster (conflict) and resource-first demos.
 */

import fs from "node:fs";
import path from "node:path";
import { ContractStatus } from "syncpoint-adapters";
import * as repo from "syncpoint-server/repositories";
import {
  orchCreateSession,
  orchAssignRole,
  orchPlanTask,
  orchAcceptAssignment,
  orchStartAssignment,
  orchAdvanceSession,
  rcClaim,
  rcRelease,
  stxCreate,
  stxApprove,
  stxResolve,
  sgAck,
  sgResolve,
  opCreate,
  opSubmit,
  opCheck,
  opApprove,
  opApply,
  buildSnapshot,
} from "syncpoint-server/application";
import { formatBlockedExplanation, formatStatusOutput } from "./formatter.js";
import { setupDemoProject } from "./demo-core.js";
import type { Snapshot } from "./formatter.js";

// ── Disaster (Conflict) Blocking Demo ──────────────────

export function runDisasterDemo(opts: {
  project: string;
  keep: boolean;
  json: boolean;
  stage: string;
}): void {
  const { projectRoot } = setupDemoProject(opts.project);
  const isJson = !!opts.json;
  const stage = opts.stage || "all";

  // ── Stage 1: Create agents ──
  const agentA = repo.createAgent({ name: "agent-a-claude", provider: "claude-code", role: "backend" });
  const agentB = repo.createAgent({ name: "agent-b-cursor", provider: "cursor", role: "backend" });
  const reviewer = repo.createAgent({ name: "reviewer-agent", provider: "codex", role: "reviewer" });

  // ── Stage 2: Create session and task ──
  const task = repo.createTask({
    title: "Refactor shared authentication config",
    description: "Both agents need to modify the shared config file.",
  });
  repo.assignTask(task.id, agentA.id);

  const contractDraft = repo.createContract({
    taskId: task.id,
    title: "Shared config coordination",
    participants: [agentA.id, agentB.id, reviewer.id],
    scope: "Coordinate edits to src/shared-config.ts",
    responsibilities: ["Agent A handles auth logic", "Agent B handles token refresh", "Reviewer validates"],
    interfaceSpec: ["Both agents must claim files before editing."],
    resourceBoundaries: ["src/shared-config.ts is the contended file."],
    dependencies: [],
    testPlan: "",
    risks: "Simultaneous edits to the same file without coordination.",
  });
  repo.updateContractStatus(contractDraft.id, ContractStatus.REVIEWING);
  repo.updateContractStatus(contractDraft.id, ContractStatus.APPROVED);

  const sessionResult = orchCreateSession({
    title: "Shared Config Coordination",
    description: "Two agents editing the same file — SyncPoint blocks unsafe continuation.",
    architectId: agentA.id,
    createdBy: "demo",
    relationshipMode: "peer-contract",
  });
  orchAssignRole({ sessionId: sessionResult.session.id, agentId: agentB.id, role: "executor" });
  orchAssignRole({ sessionId: sessionResult.session.id, agentId: reviewer.id, role: "reviewer" });

  const assignment = orchPlanTask({
    sessionId: sessionResult.session.id,
    taskId: task.id,
    assigneeAgentId: agentA.id,
    assignedBy: agentA.id,
    notes: "Agent A starts work on shared-config.ts",
  });
  orchAdvanceSession(sessionResult.session.id);
  orchAcceptAssignment(assignment.id);

  // ── Stage 3: Agent A claims the file ──
  const claimA = rcClaim({
    actorId: agentA.id, taskId: task.id, sessionId: sessionResult.session.id,
    resources: [{ type: "file", scope: "file" as const, locator: "src/shared-config.ts", metadata: "" }],
    mode: "exclusive",
  });
  orchStartAssignment(assignment.id);

  // ── Stage 4: Agent A checkpoints ──
  const checkpoint = repo.createCheckpoint({
    taskId: task.id, agentId: agentA.id,
    summary: "Implemented auth session refresh logic in shared-config.ts",
    progress: "60%",
    currentUnderstanding: "Auth config needs token refresh handler.",
    changedResources: ["src/shared-config.ts"],
    risks: "Another agent may edit the same file.",
    blockers: "", nextSteps: "Need review before Agent B can proceed.",
    needSync: true,
  });

  const tx = stxCreate({
    sessionId: sessionResult.session.id, taskId: task.id,
    checkpointId: checkpoint.id, requestingAgentId: agentA.id,
    requiredApproverIds: [agentB.id],
  });

  // ── Stage 5: Agent B tries to claim the SAME file — CONFLICT ──
  const taskB = repo.createTask({
    title: "Add token refresh to shared config",
    description: "Agent B needs to add token refresh logic.",
  });
  repo.assignTask(taskB.id, agentB.id);

  const claimB = rcClaim({
    actorId: agentB.id, taskId: taskB.id, sessionId: sessionResult.session.id,
    resources: [{ type: "file", scope: "file" as const, locator: "src/shared-config.ts", metadata: "" }],
    mode: "exclusive",
  });

  const blockedSnapshot = buildSnapshot({ sessionId: sessionResult.session.id }) as Snapshot;

  if (isJson && stage === "blocked") {
    console.log(JSON.stringify(blockedSnapshot, null, 2));
    return;
  }

  if (!isJson) {
    console.log("");
    console.log(formatBlockedExplanation(blockedSnapshot));
    console.log("─".repeat(50));
    console.log(formatStatusOutput(blockedSnapshot));
  }

  if (stage === "blocked") {
    if (!isJson) {
      console.log("Demo paused at blocked state.");
      console.log(`Demo workspace: ${projectRoot}`);
      console.log("");
      console.log("To continue resolution:");
      console.log(`  syncpoint demo --project "${projectRoot}" --stage resolve`);
    }
    return;
  }

  // ── Stage 6: Resolution ──
  if (!isJson) {
    console.log("");
    console.log("═".repeat(50));
    console.log("Resolving blockers...");
    console.log("");
  }

  stxApprove(tx.tx.id, agentB.id, "Reviewed checkpoint, auth logic looks correct.");
  stxResolve(tx.tx.id, "Checkpoint approved, ownership transfer agreed.");

  if (claimB.gateId) {
    try { sgAck(claimB.gateId, agentA.id, "Agreed to transfer ownership"); } catch {}
    try { sgAck(claimB.gateId, agentB.id, "Ready to take over"); } catch {}
    try { sgResolve(claimB.gateId, "File ownership transferred from Agent A to Agent B"); } catch {}
  }
  rcRelease(claimA.claim.id);

  const resolvedSnapshot = buildSnapshot({ sessionId: sessionResult.session.id }) as Snapshot;

  if (isJson) {
    console.log(JSON.stringify({ stage: "resolved", blocked: blockedSnapshot, resolved: resolvedSnapshot }, null, 2));
    return;
  }

  console.log("After resolution:");
  console.log("");
  console.log(formatStatusOutput(resolvedSnapshot));
  console.log("═".repeat(50));
  console.log("Demo complete.");
  console.log("");
  console.log("What happened:");
  console.log("  1. Agent A claimed src/shared-config.ts (exclusive)");
  console.log("  2. Agent A checkpointed — created a sync transaction requiring approval");
  console.log("  3. Agent B tried to claim the same file — BLOCKED by file conflict");
  console.log("  4. Agent B approved the checkpoint transaction");
  console.log("  5. File conflict gate resolved — ownership transferred");
  console.log("  6. Both agents can now continue safely");
  console.log("");
  console.log(`Demo workspace: ${projectRoot}`);
  if (!opts.keep) {
    console.log("  (use --keep to preserve the workspace for inspection)");
  }
}

// ── Resource-First Demo ──────────────────────────────────

export function runResourceDemo(opts: { project: string; json: boolean }): void {
  const { projectRoot } = setupDemoProject(opts.project);
  const isJson = !!opts.json;

  const designer = repo.createAgent({ name: "design-agent", provider: "other", role: "frontend" });
  const optimizer = repo.createAgent({ name: "asset-optimizer", provider: "other", role: "other" });

  const task = repo.createTask({
    title: "Update hero banner for launch campaign",
    description: "Replace the hero banner and optimize all campaign images.",
  });
  repo.assignTask(task.id, designer.id);

  const sessionResult = orchCreateSession({
    title: "Launch Campaign Assets",
    description: "Coordinate binary asset changes between designer and optimizer.",
    architectId: designer.id,
    createdBy: "demo",
    relationshipMode: "peer-contract",
  });
  orchAssignRole({ sessionId: sessionResult.session.id, agentId: optimizer.id, role: "executor" });

  const claimDesigner = rcClaim({
    actorId: designer.id, taskId: task.id, sessionId: sessionResult.session.id,
    resources: [
      { type: "binary_asset", scope: "file" as const, locator: "assets/hero-banner.png", metadata: "1920x600 PNG" },
      { type: "binary_asset", scope: "file" as const, locator: "assets/campaign-logo.svg", metadata: "vector logo" },
    ],
    mode: "exclusive",
  });

  if (!isJson) {
    console.log("SyncPoint Resource-First Demo");
    console.log("═".repeat(50));
    console.log("");
    console.log("This demo uses type: \"binary_asset\" — not files, not code.");
    console.log("The same protocol primitives work for any resource type.");
    console.log("");
    console.log("Designer claimed:");
    console.log("  [binary_asset] assets/hero-banner.png  (1920x600 PNG)");
    console.log("  [binary_asset] assets/campaign-logo.svg (vector logo)");
    console.log("");
  }

  const taskOpt = repo.createTask({
    title: "Optimize hero banner for web performance",
    description: "Compress and resize hero-banner.png for web delivery.",
  });
  repo.assignTask(taskOpt.id, optimizer.id);

  const claimOptimizer = rcClaim({
    actorId: optimizer.id, taskId: taskOpt.id, sessionId: sessionResult.session.id,
    resources: [
      { type: "binary_asset", scope: "file" as const, locator: "assets/hero-banner.png", metadata: "optimize to WebP" },
    ],
    mode: "exclusive",
  });

  if (!isJson && claimOptimizer.conflicts.length > 0) {
    console.log("Optimizer tried to claim assets/hero-banner.png — BLOCKED");
    console.log("");
    for (const c of claimOptimizer.conflicts) {
      console.log(`  [conflict] ${c.overlappingLocator}`);
      console.log(`    type: ${c.resourceType}`);
      console.log(`    ${c.claimA.actorId} ↔ ${c.claimB.actorId}`);
    }
    if (claimOptimizer.gateId) {
      console.log("");
      console.log(`  SyncGate created: ${claimOptimizer.gateId}`);
      console.log("  Both agents must sync before continuing.");
    }
  } else if (!isJson) {
    console.log("Optimizer claimed assets/hero-banner.png — no conflict (unexpected).");
  }

  if (claimOptimizer.gateId) {
    try { sgAck(claimOptimizer.gateId, designer.id, "I'll finish the design first"); } catch {}
    try { sgAck(claimOptimizer.gateId, optimizer.id, "Waiting for final design"); } catch {}
    try { sgResolve(claimOptimizer.gateId, "Designer finishes first, then optimizer compresses"); } catch {}
  }

  if (!isJson) {
    console.log("");
    console.log("─".repeat(50));
    console.log("After resolution:");
    console.log("  Designer released claim → optimizer can now proceed.");
  }

  rcRelease(claimOptimizer.claim.id);

  // ── Part 2: Operation lifecycle (asset_edit) ──
  const designerCheckpoint = repo.createCheckpoint({
    taskId: task.id, agentId: designer.id,
    summary: "Completed new hero banner design for launch campaign",
    progress: "Design complete, ready for operation submission",
    changedResources: ["assets/hero-banner.png"],
    currentUnderstanding: "hero-banner.png replaced with new campaign design",
    risks: "", blockers: "", nextSteps: "Submit asset_edit operation", needSync: false,
  });
  repo.createContextSnapshot({
    taskId: task.id, agentId: designer.id, checkpointId: designerCheckpoint.id,
    summary: "Replace hero banner for launch campaign",
    payload: {
      goal: "Replace hero banner for launch campaign",
      currentPhase: "implementation",
      confirmedDecisions: ["1920x600 PNG format, new branding"],
      workingResources: ["assets/hero-banner.png", "assets/campaign-logo.svg"],
      completedWork: "Hero banner design finalized",
      remainingWork: "Submit asset_edit operation",
      risks: [], blockers: [],
    },
  });

  const operation = opCreate({
    type: "asset_edit", actorId: designer.id, taskId: task.id,
    sessionId: sessionResult.session.id,
    title: "Replace hero banner with new campaign design",
    summary: "New 1920x600 hero banner for launch campaign",
    targetResources: [
      { type: "binary_asset", scope: "file" as const, locator: "assets/hero-banner.png", metadata: "1920x600 PNG" },
    ],
    payloadRef: "binary://assets/hero-banner-v2.png",
  });

  opSubmit(operation.id);
  const checkResult = opCheck(operation.id);
  opApprove(operation.id, designer.id, "Auto-approved after passing all checks");
  const applied = opApply(operation.id);
  rcRelease(claimDesigner.claim.id);

  if (!isJson) {
    console.log("");
    console.log("═".repeat(50));
    console.log("Part 2: Operation lifecycle (type: \"asset_edit\")");
    console.log("═".repeat(50));
    console.log("");
    console.log(`Operation: ${operation.id}`);
    console.log("  type: asset_edit");
    console.log("  target: [binary_asset] assets/hero-banner.png");
    console.log("  status flow: DRAFT → SUBMITTED → APPROVED → APPLIED");
    console.log("");
    console.log("Validators executed:");
    const checks = checkResult.checkResult?.items ?? [];
    for (const item of checks) {
      console.log(`  [${item.passed ? "PASS" : "FAIL"}] ${item.check}: ${item.detail}`);
    }
    console.log("");
    console.log(`Final status: ${applied.status}`);
    console.log("");
    console.log("Key takeaway:");
    console.log("  SyncPoint's claim/conflict/gate/operation protocol works identically");
    console.log("  for binary_asset, db_table, api_endpoint — any resource type.");
    console.log("  No code-specific logic was involved.");
    console.log("");
    console.log(`Demo workspace: ${projectRoot}`);
  } else {
    console.log(JSON.stringify({
      designerClaim: claimDesigner, optimizerClaim: claimOptimizer,
      conflict: claimOptimizer.conflicts.length > 0,
      gateId: claimOptimizer.gateId,
      operation: {
        id: operation.id, type: operation.type, status: applied.status,
        targetResources: operation.targetResources,
        checks: checkResult.checkResult?.items ?? [],
      },
    }, null, 2));
  }
}
