/**
 * tRPC router for SyncPoint.
 * Composes domain-specific sub-routers from ./routers/*.
 */

import { t } from "./routers/_trpc.js";
import { agentRouter } from "./routers/agent-router.js";
import { taskRouter } from "./routers/task-router.js";
import { checkpointRouter, diaryRouter } from "./routers/checkpoint-router.js";
import { handoffRouter } from "./routers/handoff-router.js";
import { contractRouter } from "./routers/contract-router.js";
import { contextSnapshotRouter } from "./routers/context-snapshot-router.js";
import { pinnedMemoryRouter } from "./routers/memory-router.js";
import { resumeContextRouter, eventRouter, adapterRouter } from "./routers/context-router.js";
import { loopRouter } from "./routers/loop-router.js";
import { projectMemoryRouter } from "./routers/project-memory-router.js";
import { wakeRouter } from "./routers/wake-router.js";
import { syncStatusRouter } from "./routers/sync-status-router.js";
import { checkpointReviewRouter } from "./routers/checkpoint-review-router.js";
import { constraintRouter } from "./routers/constraint-router.js";
import { syncGateRouter } from "./routers/sync-gate-router.js";
import { negotiationRouter } from "./routers/negotiation-router.js";
import { agentManifestRouter } from "./routers/agent-manifest-router.js";
import { agentRegistryRouter } from "./routers/agent-registry-router.js";
import { fileAuditRouter } from "./routers/file-audit-router.js";
import { writeRouter } from "./routers/write-router.js";
import { guardRouter } from "./routers/guard-router.js";

// ── Root router ────────────────────────────────────────

export const appRouter = t.router({
  agent: agentRouter,
  task: taskRouter,
  checkpoint: checkpointRouter,
  diary: diaryRouter,
  handoff: handoffRouter,
  contract: contractRouter,
  contextSnapshot: contextSnapshotRouter,
  event: eventRouter,
  pinnedMemory: pinnedMemoryRouter,
  resumeContext: resumeContextRouter,
  adapter: adapterRouter,
  loop: loopRouter,
  projectMemory: projectMemoryRouter,
  wake: wakeRouter,
  syncStatus: syncStatusRouter,
  checkpointReview: checkpointReviewRouter,
  constraint: constraintRouter,
  syncGate: syncGateRouter,
  negotiation: negotiationRouter,
  agentManifest: agentManifestRouter,
  agentRegistry: agentRegistryRouter,
  fileAudit: fileAuditRouter,
  write: writeRouter,
  guard: guardRouter,
});

export type AppRouter = typeof appRouter;
