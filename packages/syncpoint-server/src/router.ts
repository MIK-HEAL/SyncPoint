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
import { capsuleRouter } from "./routers/capsule-router.js";
import { pinnedMemoryRouter } from "./routers/memory-router.js";
import { resumeContextRouter, eventRouter, adapterRouter } from "./routers/context-router.js";
import { loopRouter } from "./routers/loop-router.js";
import { projectMemoryRouter } from "./routers/project-memory-router.js";

// ── Root router ────────────────────────────────────────

export const appRouter = t.router({
  agent: agentRouter,
  task: taskRouter,
  checkpoint: checkpointRouter,
  diary: diaryRouter,
  handoff: handoffRouter,
  contract: contractRouter,
  capsule: capsuleRouter,
  event: eventRouter,
  pinnedMemory: pinnedMemoryRouter,
  resumeContext: resumeContextRouter,
  adapter: adapterRouter,
  loop: loopRouter,
  projectMemory: projectMemoryRouter,
});

export type AppRouter = typeof appRouter;
