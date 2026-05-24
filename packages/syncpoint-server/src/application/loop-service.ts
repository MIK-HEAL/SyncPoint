/**
 * Loop orchestration use cases.
 * These are the composite workflows that CLI, MCP, and tRPC all share.
 * Transport layers (CLI/MCP/router) handle I/O; this module handles logic.
 */

import "./_scope-matchers.js";

export {
  EXIT,
  LoopError,
} from "./loop/types.js";

export type {
  LoopBootInput,
  LoopBootResult,
  LoopResumeInput,
  LoopResumeResult,
  LoopCheckpointInput,
  LoopCheckpointResult,
  LoopHandoffInput,
  LoopHandoffResult,
  LoopStatusInput,
  LoopStatusResult,
} from "./loop/types.js";

export { loopBoot } from "./loop/boot.js";
export { loopResume } from "./loop/resume.js";
export { loopCheckpoint } from "./loop/checkpoint.js";
export { loopHandoff } from "./loop/handoff.js";
export { loopStatus } from "./loop/status.js";
