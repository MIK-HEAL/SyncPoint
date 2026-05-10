/**
 * Repository layer — thin re-export barrel.
 * Actual implementations live in ./repositories/*.
 * This file exists for backward compatibility.
 */

export {
  __setDb,
  NotFoundError,
} from "./repositories/_shared.js";

export {
  createAgent,
  getAgent,
  getAgentByName,
  listAgents,
  updateAgentStatus,
  updateAgentRuntime,
} from "./repositories/agent-repository.js";

export {
  createTask,
  getTask,
  listTasks,
  assignTask,
  updateTaskStatus,
} from "./repositories/task-repository.js";

export {
  createCheckpoint,
  listCheckpoints,
  getLatestCheckpointForAgent,
  createDiaryEntry,
  listDiaryEntries,
} from "./repositories/checkpoint-repository.js";

export {
  createHandoff,
  acceptHandoff,
  rejectHandoff,
  listHandoffs,
  listPendingHandoffs,
  getLatestHandoffForReceiver,
} from "./repositories/handoff-repository.js";

export {
  createContract,
  getContract,
  getContractForTask,
  updateContractStatus,
} from "./repositories/contract-repository.js";

export {
  createContextSnapshot,
  listContextSnapshots,
  getLatestContextSnapshot,
} from "./repositories/context-snapshot-repository.js";

export {
  createPinnedMemory,
  getPinnedMemory,
  getPinnedMemoryByKey,
  listPinnedMemories,
  updatePinnedMemory,
  deletePinnedMemory,
  collectPinnedMemories,
} from "./repositories/memory-repository.js";

export {
  listEvents,
} from "./repositories/event-repository.js";

export {
  getResumeContext,
  enforceContextPolicy,
} from "./repositories/resume-context-repository.js";

export {
  createProjectMemory,
  getProjectMemory,
  updateProjectMemory,
  approveProjectMemory,
  deprecateProjectMemory,
  listProjectMemories,
  searchProjectMemories,
  collectProjectMemories,
  checkMemoryDuplicate,
  supersedeProjectMemory,
  getMemoryVersion,
  bumpMemoryVersion,
} from "./repositories/project-memory-repository.js";
export type { CollectedMemory } from "./repositories/project-memory-repository.js";

export {
  createSession,
  getSession,
  listSessions,
  updateSessionStatus,
  assignRole,
  listRoles,
  getRoleForAgent,
  createTaskAssignment,
  getTaskAssignment,
  listTaskAssignments,
  updateTaskAssignmentStatus,
  createReviewRequest,
  getReviewRequest,
  listReviewRequests,
  updateReviewRequestStatus,
  createReviewDecision,
  getReviewDecision,
  listReviewDecisions,
} from "./repositories/orchestration-repository.js";

export {
  createChecklistItem,
  getChecklistItem,
  listChecklistItems,
  updateChecklistItemStatus,
  createEvidence,
  listEvidence,
  createChangeRequest,
  getChangeRequest,
  listChangeRequests,
  updateChangeRequestStatus,
  createApprovalRecord,
  listApprovalRecords,
} from "./repositories/review-workflow-repository.js";

export {
  createWakeRequest,
  getWakeRequest,
  listWakeRequests,
  listWakeRequestsByAgent,
  listQueuedWakeRequests,
  updateWakeRequestStatus,
  hasActiveWakeForAgent,
} from "./repositories/wake-repository.js";

export {
  createResourceClaim,
  getResourceClaim,
  releaseResourceClaim,
  listResourceClaims,
  listActiveResourceClaims,
} from "./repositories/resource-claim-repository.js";


export {
  createSyncGate,
  getSyncGate,
  updateSyncGateStatus,
  updateSyncGateAckedAgents,
  updateSyncGateDescription,
  updateSyncGatePolicyJson,
  listSyncGates,
  listActiveSyncGates,
  listGatesByRelatedClaimIds,
  createGateAck,
  getGateAck,
  listGateAcks,
  createGateVote,
  getGateVote,
  listGateVotes,
} from "./repositories/sync-gate-repository.js";


export {
  createOperation,
  getOperation,
  updateOperation,
  listOperations,
} from "./repositories/operation-repository.js";

export {
  createWritePermit,
  getWritePermit,
  updateWritePermit,
  listWritePermits,
} from "./repositories/write-permit-repository.js";

export {
  createCheckpointReview,
  getCheckpointReview,
  updateCheckpointReviewStatus,
  updateCheckpointReviewApprovedBy,
  updateCheckpointReviewRejectedBy,
  updateCheckpointReviewGateId,
  listCheckpointReviews,
  listActiveCheckpointReviews,
} from "./repositories/checkpoint-review-repository.js";

export {
  createRuntime,
  getRuntime,
  listRuntimes,
  updateRuntimeAgent,
  updateRuntimeStatus,
  touchRuntime,
  getAgentIdForRuntime,
} from "./repositories/runtime-repository.js";
