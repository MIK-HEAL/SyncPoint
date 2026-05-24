/**
 * Sync Status Service — aggregation & read-model layer for the Editor Sync View (P9).
 *
 * All query aggregation, session scoping, blocker classification, and snapshot
 * assembly lives here.  The router is a thin transport adapter that delegates
 * to these functions.
 */

export { buildScopeFilter } from "./sync-status/shared.js";
export { classifyBlockers } from "./sync-status/blockers.js";
export { buildOverview } from "./sync-status/overview.js";
export { buildSnapshot } from "./sync-status/snapshot.js";

export type { UnifiedBlocker } from "./sync-status/blockers.js";
export type { OverviewInput } from "./sync-status/overview.js";
export type { SnapshotInput } from "./sync-status/snapshot.js";
