/**
 * Repository barrel — re-exports all domain repositories.
 * Backward-compatible: import * from "syncpoint-server/repositories" still works.
 */

export { __setDb, NotFoundError } from "./_shared.js";
export { createAgent, getAgent, listAgents, updateAgentStatus } from "./agent-repository.js";
export { createTask, getTask, listTasks, assignTask, updateTaskStatus } from "./task-repository.js";
export { createCheckpoint, listCheckpoints, createDiaryEntry, listDiaryEntries } from "./checkpoint-repository.js";
export { createHandoff, acceptHandoff, rejectHandoff, getLatestHandoffForReceiver } from "./handoff-repository.js";
export { createContract, getContract, getContractForTask, updateContractStatus } from "./contract-repository.js";
export { createContextSnapshot, listContextSnapshots, getLatestContextSnapshot } from "./context-snapshot-repository.js";
export { createPinnedMemory, getPinnedMemory, getPinnedMemoryByKey, listPinnedMemories, updatePinnedMemory, deletePinnedMemory, collectPinnedMemories } from "./memory-repository.js";
export { listEvents } from "./event-repository.js";
export { getResumeContext, enforceContextPolicy } from "./resume-context-repository.js";
export { createProjectMemory, getProjectMemory, updateProjectMemory, approveProjectMemory, deprecateProjectMemory, listProjectMemories, searchProjectMemories, collectProjectMemories } from "./project-memory-repository.js";
export {
  createSession, getSession, listSessions, updateSessionStatus,
  assignRole, listRoles, getRoleForAgent,
  createTaskAssignment, getTaskAssignment, listTaskAssignments, updateTaskAssignmentStatus,
  createReviewRequest, getReviewRequest, listReviewRequests, updateReviewRequestStatus,
  createReviewDecision, getReviewDecision, listReviewDecisions,
} from "./orchestration-repository.js";
export {
  createChecklistItem, getChecklistItem, listChecklistItems, updateChecklistItemStatus,
  createEvidence, listEvidence,
  createChangeRequest, getChangeRequest, listChangeRequests, updateChangeRequestStatus,
  createApprovalRecord, listApprovalRecords,
} from "./review-workflow-repository.js";
export {
  createWakeRequest, getWakeRequest, listWakeRequests, listWakeRequestsByAgent,
  listQueuedWakeRequests, updateWakeRequestStatus, hasActiveWakeForAgent,
} from "./wake-repository.js";
export {
  createResourceClaim, getResourceClaim, releaseResourceClaim,
  listResourceClaims, listActiveResourceClaims,
} from "./resource-claim-repository.js";

export {
  createSyncGate, getSyncGate, updateSyncGateStatus, updateSyncGateAckedAgents,
  updateSyncGateDescription, listSyncGates, listActiveSyncGates,
} from "./sync-gate-repository.js";
export {
  createOperation, getOperation, updateOperation,
  listOperations,
} from "./operation-repository.js";
export {
  createNegotiationSession, getNegotiationSession, getNegotiationSessionByGate,
  listNegotiationSessions, updateNegotiationSession,
  createNegotiationMessage, listNegotiationMessages,
} from "./negotiation-repository.js";
export {
  upsertAgentManifest, getAgentManifest, listAgentManifests, deleteAgentManifest,
} from "./agent-manifest-repository.js";
