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
  listAgents,
  updateAgentStatus,
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
  createCapsule,
  listCapsules,
  getLatestCapsule,
} from "./repositories/capsule-repository.js";

export {
  createPinnedMemory,
  getPinnedMemory,
  getPinnedMemoryByKey,
  listPinnedMemories,
  updatePinnedMemory,
  deletePinnedMemory,
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
} from "./repositories/project-memory-repository.js";

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
  createFileClaim,
  getFileClaim,
  releaseFileClaim,
  listFileClaims,
  listActiveFileClaims,
} from "./repositories/file-claim-repository.js";

export {
  createSyncGate,
  getSyncGate,
  updateSyncGateStatus,
  updateSyncGateAckedAgents,
  listSyncGates,
  listActiveSyncGates,
} from "./repositories/sync-gate-repository.js";

export {
  createPatchProposal,
  getPatchProposal,
  updatePatchProposal,
  listPatchProposals,
} from "./repositories/patch-proposal-repository.js";

export {
  createSyncTransaction,
  getSyncTransaction,
  updateSyncTransactionStatus,
  updateSyncTransactionApprovedBy,
  updateSyncTransactionRejectedBy,
  updateSyncTransactionGateId,
  listSyncTransactions,
  listActiveSyncTransactions,
} from "./repositories/sync-transaction-repository.js";
