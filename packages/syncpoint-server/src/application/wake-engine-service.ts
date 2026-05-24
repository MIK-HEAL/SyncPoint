/**
 * Wake Engine Service — event-driven auto-wake orchestration.
 *
 * Listens to EventBus events, resolves which session they belong to,
 * computes wake targets using the pure core engine, and creates WakeRequests.
 *
 * This is the runtime that turns SyncPoint from "tell me what to do next"
 * into "automatically generate who should be woken, with what context."
 */

import "./_scope-matchers.js";
export type {
  WakeEngineOptions,
  WakeEngineStats,
  WakeListInput,
} from "./wake-engine/types.js";

export {
  wakeEngineStart,
  wakeEngineStop,
  wakeEngineStats,
  processOrchestrationEvent,
} from "./wake-engine/engine.js";

export {
  wakeList,
  wakeGet,
  wakeAck,
  wakeStart,
  wakeDone,
  wakeFail,
  wakeSkip,
  wakeNext,
} from "./wake-engine/use-cases.js";
