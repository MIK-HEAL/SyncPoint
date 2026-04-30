#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const stage = args.stage ?? "blocked";

if (!["blocked", "resolve", "all"].includes(stage)) {
  printUsageAndExit(`Unknown stage: ${stage}`);
}

const projectDir = resolveProjectDir(args.project, stage);
const srcDir = path.join(projectDir, "src");
const syncpointDir = path.join(projectDir, ".syncpoint");
const metaPath = path.join(syncpointDir, "demo-sync-flow.json");
const configPath = path.join(srcDir, "shared-config.ts");
const patchPath = path.join(projectDir, "agent-b.patch");

fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(syncpointDir, { recursive: true });
process.env.SYNCPOINT_DB_DIR = syncpointDir;
process.env.SYNCPOINT_PROJECT_ROOT = projectDir;

const server = await importLocalPackage("packages/syncpoint-server/dist/index.js");
const app = await importLocalPackage("packages/syncpoint-server/dist/application/index.js");
const repo = await importLocalPackage("packages/syncpoint-server/dist/repositories.js");

server.initSyncpointDir(projectDir);

try {
  if (stage === "blocked") {
    const meta = await createBlockedState();
    writeMeta(meta);
    printBlockedSummary(meta);
  }

  if (stage === "resolve") {
    const meta = readMeta();
    const resolved = await resolveState(meta);
    writeMeta(resolved);
    printResolvedSummary(resolved);
  }

  if (stage === "all") {
    const meta = await createBlockedState();
    writeMeta(meta);
    printBlockedSummary(meta);
    const resolved = await resolveState(meta);
    writeMeta(resolved);
    printResolvedSummary(resolved);
  }
} finally {
  server.closeDb();
}

async function createBlockedState() {
  writeInitialConfig();

  const agentA = repo.createAgent({
    name: "agent-a-claude",
    provider: "claude-code",
    role: "backend",
  });
  const agentB = repo.createAgent({
    name: "agent-b-cursor",
    provider: "cursor",
    role: "frontend",
  });

  const sessionResult = app.orchCreateSession({
    title: "P10 sync truncation demo",
    description: "Two editor AI agents coordinate on one shared file through claims, gates, transactions, and patches.",
    relationshipMode: "peer-contract",
    architectId: agentA.id,
    createdBy: "demo-sync-flow",
  });
  const session = sessionResult.session;

  app.orchAssignRole({
    sessionId: session.id,
    agentId: agentA.id,
    role: "executor",
    capabilities: "Owns the initial shared config change.",
  });
  app.orchAssignRole({
    sessionId: session.id,
    agentId: agentB.id,
    role: "executor",
    capabilities: "Proposes the follow-up patch after sync.",
  });
  app.orchAssignRole({
    sessionId: session.id,
    agentId: agentB.id,
    role: "reviewer",
    capabilities: "Approves the checkpoint transaction.",
  });

  const taskA = repo.createTask({
    title: "Agent A prepares base shared config",
    description: "Create the base edit and checkpoint before Agent B continues.",
  });
  const taskB = repo.createTask({
    title: "Agent B proposes shared config patch",
    description: "Attempt to touch the same file, stop at the conflict, then continue after sync.",
  });

  const assignmentA = app.orchPlanTask({
    sessionId: session.id,
    taskId: taskA.id,
    assigneeAgentId: agentA.id,
    assignedBy: agentA.id,
    notes: "Claim src/shared-config.ts first.",
  });
  const assignmentB = app.orchPlanTask({
    sessionId: session.id,
    taskId: taskB.id,
    assigneeAgentId: agentB.id,
    assignedBy: agentA.id,
    notes: "Try the same file, then stop at the gate.",
  });

  app.orchAcceptAssignment(assignmentA.id);
  app.orchAcceptAssignment(assignmentB.id);

  const claimAResult = app.fcClaimFiles({
    agentId: agentA.id,
    taskId: taskA.id,
    sessionId: session.id,
    paths: "src/shared-config.ts",
    mode: "exclusive",
  });

  app.orchStartAssignment(assignmentA.id);

  const claimBResult = app.fcClaimFiles({
    agentId: agentB.id,
    taskId: taskB.id,
    sessionId: session.id,
    paths: "src/shared-config.ts",
    mode: "exclusive",
  });

  let blockedStartError = "";
  try {
    app.orchStartAssignment(assignmentB.id);
  } catch (error) {
    blockedStartError = error instanceof Error ? error.message : String(error);
  }

  const checkpoint = app.loopCheckpoint({
    taskId: taskA.id,
    agentId: agentA.id,
    summary: "Base shared config prepared; Agent B must review before continuing.",
    progress: "70%",
    nextSteps: "Agent B approves the checkpoint transaction, then takes ownership for the follow-up patch.",
    workingFiles: "src/shared-config.ts",
    blockers: "Waiting on sync transaction approval and file-claim conflict resolution.",
    needSync: true,
  });

  const txStatus = app.stxCreate({
    sessionId: session.id,
    taskId: taskA.id,
    checkpointId: checkpoint.checkpointId,
    requestingAgentId: agentA.id,
    requiredApproverIds: [agentB.id],
  });

  const activeGates = app.sgListActive({ sessionId: session.id });
  const wakes = app.wakeList({ sessionId: session.id });

  return {
    projectDir,
    createdAt: new Date().toISOString(),
    stage: "blocked",
    ids: {
      sessionId: session.id,
      agentAId: agentA.id,
      agentBId: agentB.id,
      taskAId: taskA.id,
      taskBId: taskB.id,
      assignmentAId: assignmentA.id,
      assignmentBId: assignmentB.id,
      claimAId: claimAResult.claim.id,
      claimBId: claimBResult.claim.id,
      fileConflictGateId: claimBResult.gateId,
      checkpointId: checkpoint.checkpointId,
      syncTransactionId: txStatus.tx.id,
      syncTransactionGateId: txStatus.tx.gateId,
    },
    blockedStartError,
    activeGateIds: activeGates.map(g => g.id),
    wakeIds: wakes.map(w => w.id),
  };
}

async function resolveState(meta) {
  const ids = meta.ids;
  if (!ids.fileConflictGateId) {
    throw new Error("Metadata does not contain fileConflictGateId. Re-run --stage blocked.");
  }

  safeGateAck(ids.fileConflictGateId, ids.agentAId, "Agent A acknowledges the overlapping file claim and will release ownership.");
  safeGateAck(ids.fileConflictGateId, ids.agentBId, "Agent B acknowledges the conflict and waits for ownership transfer.");
  safeGateResolve(ids.fileConflictGateId, "Agent A releases the file claim; Agent B owns the follow-up patch.");
  app.fcReleaseClaim(ids.claimAId);

  const txBefore = app.stxStatus(ids.syncTransactionId);
  if (txBefore.tx.status === "WAITING_APPROVAL") {
    app.stxApprove(ids.syncTransactionId, ids.agentBId, "Checkpoint accepted. Agent B can continue from this state.");
  }

  const txAfterApprove = app.stxStatus(ids.syncTransactionId);
  if (txAfterApprove.tx.status === "APPROVED" || txAfterApprove.tx.status === "REJECTED") {
    app.stxResolve(ids.syncTransactionId, "Checkpoint transaction resolved and bound gate released.");
  }

  let startBStatus = "started";
  try {
    app.orchStartAssignment(ids.assignmentBId);
  } catch (error) {
    startBStatus = error instanceof Error ? error.message : String(error);
  }

  const patchText = buildPatchText();
  fs.writeFileSync(patchPath, patchText, "utf8");

  const proposal = app.ppPropose({
    sessionId: ids.sessionId,
    taskId: ids.taskBId,
    agentId: ids.agentBId,
    title: "Agent B updates shared config after sync",
    summary: "Follow-up patch after claim conflict and checkpoint transaction are resolved.",
    patchText,
  });
  const submitted = app.ppSubmit(proposal.id);

  if (!submitted.checkResult?.allPassed) {
    throw new Error(`Patch checks failed: ${JSON.stringify(submitted.checkResult, null, 2)}`);
  }

  app.ppApprove(proposal.id, ids.agentAId, "Patch checks passed after ownership transfer.");
  const applied = app.ppApply(proposal.id);
  writeAppliedConfig();

  const activeGates = app.sgListActive({ sessionId: ids.sessionId });
  const patchStatus = app.ppStatus(applied.id);

  return {
    ...meta,
    stage: "resolved",
    resolvedAt: new Date().toISOString(),
    ids: {
      ...ids,
      patchProposalId: applied.id,
    },
    startBStatus,
    patchCheck: patchStatus.checkResult,
    activeGateIdsAfterResolve: activeGates.map(g => g.id),
  };
}

function safeGateAck(gateId, agentId, summary) {
  const status = app.sgStatus(gateId);
  if (status.gate.status !== "SYNC_REQUESTED") return;
  if (status.gate.ackedAgentIds.split(",").filter(Boolean).includes(agentId)) return;
  app.sgAck(gateId, agentId, summary);
}

function safeGateResolve(gateId, summary) {
  const status = app.sgStatus(gateId);
  if (status.gate.status === "READY_TO_CONTINUE" || status.gate.status === "CANCELLED") return;
  if (status.gate.status !== "SYNC_ACKED") {
    throw new Error(`Gate ${gateId} is ${status.gate.status}, not SYNC_ACKED.`);
  }
  app.sgResolve(gateId, summary);
}

function writeInitialConfig() {
  fs.writeFileSync(configPath, [
    "export const syncMode = \"manual\";",
    "export const owner = \"agent-a\";",
    "",
  ].join("\n"), "utf8");
}

function writeAppliedConfig() {
  fs.writeFileSync(configPath, [
    "export const syncMode = \"protocol-gated\";",
    "export const owner = \"agent-b\";",
    "",
  ].join("\n"), "utf8");
}

function buildPatchText() {
  return [
    "diff --git a/src/shared-config.ts b/src/shared-config.ts",
    "--- a/src/shared-config.ts",
    "+++ b/src/shared-config.ts",
    "@@ -1,2 +1,2 @@",
    "-export const syncMode = \"manual\";",
    "-export const owner = \"agent-a\";",
    "+export const syncMode = \"protocol-gated\";",
    "+export const owner = \"agent-b\";",
    "",
  ].join("\n");
}

function writeMeta(meta) {
  fs.mkdirSync(syncpointDir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
}

function readMeta() {
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Demo metadata not found: ${metaPath}. Run --stage blocked first.`);
  }
  return JSON.parse(fs.readFileSync(metaPath, "utf8"));
}

function resolveProjectDir(projectArg, selectedStage) {
  if (projectArg) return path.resolve(projectArg);
  if (selectedStage === "resolve") {
    printUsageAndExit("--stage resolve requires --project <demo-project>.");
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(rootDir, ".tmp", `syncpoint-demo-${stamp}`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--stage") parsed.stage = argv[++i];
    else if (arg === "--project") parsed.project = argv[++i];
    else if (arg === "--help" || arg === "-h") printUsageAndExit();
    else printUsageAndExit(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function importLocalPackage(relativePath) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Built package file not found: ${absolutePath}. Run pnpm build first.`);
  }
  return import(pathToFileURL(absolutePath).href);
}

function printBlockedSummary(meta) {
  printHeader("Blocked sync state created");
  printLine("Project", meta.projectDir);
  printLine("Metadata", metaPath);
  printLine("Session", meta.ids.sessionId);
  printLine("Agent A", meta.ids.agentAId);
  printLine("Agent B", meta.ids.agentBId);
  printLine("Task A", meta.ids.taskAId);
  printLine("Task B", meta.ids.taskBId);
  printLine("Claim A", meta.ids.claimAId);
  printLine("Claim B", meta.ids.claimBId);
  printLine("File conflict gate", meta.ids.fileConflictGateId);
  printLine("Checkpoint", meta.ids.checkpointId);
  printLine("Sync transaction", meta.ids.syncTransactionId);
  printLine("Transaction gate", meta.ids.syncTransactionGateId);
  printLine("Active gates", meta.activeGateIds.join(", "));
  printLine("Wake requests", meta.wakeIds.join(", ") || "none");
  printLine("Blocked start error", meta.blockedStartError);
  printNextCommands(meta.projectDir, meta.ids.sessionId, meta.ids.agentBId);
}

function printResolvedSummary(meta) {
  printHeader("Sync state resolved and patch applied");
  printLine("Project", meta.projectDir);
  printLine("Session", meta.ids.sessionId);
  printLine("Patch proposal", meta.ids.patchProposalId);
  printLine("Patch file", patchPath);
  printLine("Agent B start", meta.startBStatus);
  printLine("Patch checks", meta.patchCheck?.allPassed ? "ALL PASSED" : "UNKNOWN");
  printLine("Active gates after resolve", meta.activeGateIdsAfterResolve.join(", ") || "none");
  printNextCommands(meta.projectDir, meta.ids.sessionId, meta.ids.agentBId, meta.ids.patchProposalId);
}

function printNextCommands(targetProject, sessionId, agentId, patchId) {
  console.log("");
  console.log("Inspect with CLI from the demo project:");
  console.log(`  syncpoint sync status --session ${sessionId}`);
  console.log(`  syncpoint sync status --session ${sessionId} --agent ${agentId}`);
  console.log(`  syncpoint patch list --session ${sessionId}`);
  if (patchId) console.log(`  syncpoint patch status --patch ${patchId}`);
  console.log("");
  console.log("Start the server from the demo project, then open Sync View:");
  console.log(`  Project: ${targetProject}`);
  console.log("  Command: syncpoint server start --port 8765");
  console.log("");
  if (stage === "blocked") {
    console.log("Continue the flow:");
    console.log(`  node scripts/demo-sync-flow.mjs --stage resolve --project "${targetProject}"`);
  }
}

function printHeader(text) {
  console.log("");
  console.log(`=== ${text} ===`);
}

function printLine(label, value) {
  console.log(`${label.padEnd(22)} ${value}`);
}

function printUsageAndExit(message) {
  if (message) console.error(message);
  console.error("Usage: node scripts/demo-sync-flow.mjs --stage blocked|resolve|all [--project <path>]");
  process.exit(message ? 1 : 0);
}
