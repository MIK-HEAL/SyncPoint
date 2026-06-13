/**
 * Snapshot types used by the CLI formatter.
 *
 * These mirror the output of sync-status-service and are consumed
 * by the formatting functions in formatter.ts and formatter-helpers.ts.
 */

import type { UnifiedBlocker } from "syncpoint-server/application";

// ── Snapshot types (mirror sync-status-service output) ──

export interface SnapshotAgent {
  id: string;
  name: string;
  status: string;
  provider: string;
  role: string;
  blocked: boolean;
  blockingGateIds: string[];
  constraintBlocked: boolean;
  constraintBlockerCount: number;
  constraintWarningCount: number;
  activeAssignments: Array<{ id: string; taskId: string; taskTitle: string; status: string }>;
  claimedResources: Array<{ claimId: string; resources: any[]; mode: string; taskId: string }>;
  pendingWakeCount: number;
}

export interface SnapshotSession {
  id: string;
  title: string;
  status: string;
  relationshipMode: string;
  agents: Array<{ agentId: string; agentName: string; role: string }>;
}

export interface SnapshotConflict {
  overlappingLocator: string;
  claimA: { id: string; actorId: string; actorName: string; mode: string };
  claimB: { id: string; actorId: string; actorName: string; mode: string };
}

export interface SnapshotClaim {
  id: string;
  actorId: string;
  actorName: string;
  taskId: string;
  taskTitle: string;
  resources: Array<{ type: string; locator: string; metadata: string }>;
  mode: string;
}

export interface SnapshotOperation {
  id: string;
  title: string;
  actorId: string;
  actorName: string;
  status: string;
  taskId: string;
  taskTitle: string;
  needsAction: string;
}

export interface SnapshotWake {
  id: string;
  targetAgentId: string;
  targetAgentName: string;
  sourceEvent: string;
  reason: string;
  status: string;
  createdAt: string;
}

export interface SnapshotEvent {
  id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  detail: string;
  createdAt: string;
}

export interface Snapshot {
  timestamp: string;
  sessions: SnapshotSession[];
  agents: SnapshotAgent[];
  resourceOwnership: {
    activeClaims: SnapshotClaim[];
    conflicts: SnapshotConflict[];
    stats: {
      totalClaims: number;
      exclusiveClaims: number;
      sharedClaims: number;
      hardConflicts: number;
      softConflicts: number;
    };
  };
  blockers: UnifiedBlocker[];
  blockerCount: number;
  operations: SnapshotOperation[];
  wakeQueue: SnapshotWake[];
  recentEvents?: SnapshotEvent[];
  gateStats: { total: number; active: number; resolved: number; cancelled: number };
  summary: {
    activeSessionCount: number;
    agentCount: number;
    blockedAgentCount: number;
    activeClaimCount: number;
    hardConflictCount: number;
    pendingOperationCount: number;
    pendingWakeCount: number;
    blockerCount: number;
    constraintBlockedAgents: number;
    constraintBlockedTasks: number;
  };
}
