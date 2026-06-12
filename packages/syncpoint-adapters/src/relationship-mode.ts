/**
 * Relationship Mode — re-exports from syncpoint-kernel (canonical source).
 *
 * Previously defined locally; now delegates to kernel to prevent
 * circular dependencies between governance and adapters.
 */
export {
  RelationshipMode,
  RelationshipModeSchema,
  MODE_PHASE_FLOW,
  MODE_SYNC_RULES,
  MODE_WAKE_VERBS,
  REQUIRED_BEFORE_START,
  RECOMMENDED_ACTIONS,
  FORBIDDEN_ACTIONS,
  isValidWakeVerb,
  getSyncRules,
  getPhaseFlow,
  getModeDescription,
  isModeActionAllowed,
  getRequiredBeforeStart,
  getRecommendedActions,
  getForbiddenActions,
} from "syncpoint-kernel";
export type { ModeSyncRule, ModeActionVerdict } from "syncpoint-kernel";
