/**
 * Unit tests for SyncTransaction — status transitions, approval logic.
 */

import { describe, it, expect } from "vitest";
import {
  SyncTransactionStatus,
  SYNC_TX_TRANSITIONS,
  validateSyncTxTransition,
  parseTxIdList,
  allApproved,
  hasRejection,
  pendingApprovers,
  isTxTerminal,
  isTxBlocking,
} from "./sync-transaction.js";
import type { SyncTransaction } from "./sync-transaction.js";

function makeTx(overrides: Partial<SyncTransaction> = {}): SyncTransaction {
  return {
    id: "tx1",
    sessionId: "s1",
    taskId: "t1",
    checkpointId: "cp1",
    requestingAgentId: "a1",
    requiredApproverIds: "a2,a3",
    approvedByIds: "",
    rejectedByIds: "",
    gateId: "g1",
    status: SyncTransactionStatus.WAITING_APPROVAL,
    decisionSummary: "",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

// ── transitions ─────────────────────────────────────

describe("SyncTransaction transitions", () => {
  it("OPEN → WAITING_APPROVAL is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.OPEN, SyncTransactionStatus.WAITING_APPROVAL)).toBe(true);
  });

  it("WAITING_APPROVAL → APPROVED is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.WAITING_APPROVAL, SyncTransactionStatus.APPROVED)).toBe(true);
  });

  it("WAITING_APPROVAL → REJECTED is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.WAITING_APPROVAL, SyncTransactionStatus.REJECTED)).toBe(true);
  });

  it("APPROVED → RESOLVED is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.APPROVED, SyncTransactionStatus.RESOLVED)).toBe(true);
  });

  it("REJECTED → RESOLVED is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.REJECTED, SyncTransactionStatus.RESOLVED)).toBe(true);
  });

  it("RESOLVED is terminal", () => {
    expect(SYNC_TX_TRANSITIONS[SyncTransactionStatus.RESOLVED]).toHaveLength(0);
  });

  it("CANCELLED is terminal", () => {
    expect(SYNC_TX_TRANSITIONS[SyncTransactionStatus.CANCELLED]).toHaveLength(0);
  });

  it("any non-terminal → CANCELLED is valid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.OPEN, SyncTransactionStatus.CANCELLED)).toBe(true);
    expect(validateSyncTxTransition(SyncTransactionStatus.WAITING_APPROVAL, SyncTransactionStatus.CANCELLED)).toBe(true);
    expect(validateSyncTxTransition(SyncTransactionStatus.APPROVED, SyncTransactionStatus.CANCELLED)).toBe(true);
    expect(validateSyncTxTransition(SyncTransactionStatus.REJECTED, SyncTransactionStatus.CANCELLED)).toBe(true);
  });

  it("backward transitions are invalid", () => {
    expect(validateSyncTxTransition(SyncTransactionStatus.APPROVED, SyncTransactionStatus.OPEN)).toBe(false);
    expect(validateSyncTxTransition(SyncTransactionStatus.RESOLVED, SyncTransactionStatus.WAITING_APPROVAL)).toBe(false);
  });
});

// ── parseTxIdList ───────────────────────────────────

describe("parseTxIdList", () => {
  it("splits comma-separated IDs", () => {
    expect(parseTxIdList("a1,a2,a3")).toEqual(["a1", "a2", "a3"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseTxIdList("")).toEqual([]);
  });
});

// ── allApproved ─────────────────────────────────────

describe("allApproved", () => {
  it("false when no approvals", () => {
    expect(allApproved(makeTx())).toBe(false);
  });

  it("false when partial approval", () => {
    expect(allApproved(makeTx({ approvedByIds: "a2" }))).toBe(false);
  });

  it("true when all required approved", () => {
    expect(allApproved(makeTx({ approvedByIds: "a2,a3" }))).toBe(true);
  });
});

// ── hasRejection ────────────────────────────────────

describe("hasRejection", () => {
  it("false when no rejections", () => {
    expect(hasRejection(makeTx())).toBe(false);
  });

  it("true when any rejection", () => {
    expect(hasRejection(makeTx({ rejectedByIds: "a2" }))).toBe(true);
  });
});

// ── pendingApprovers ────────────────────────────────

describe("pendingApprovers", () => {
  it("returns all when none decided", () => {
    expect(pendingApprovers(makeTx())).toEqual(["a2", "a3"]);
  });

  it("returns remaining after partial decision", () => {
    expect(pendingApprovers(makeTx({ approvedByIds: "a2" }))).toEqual(["a3"]);
  });

  it("accounts for both approvals and rejections", () => {
    expect(pendingApprovers(makeTx({ approvedByIds: "a2", rejectedByIds: "a3" }))).toEqual([]);
  });
});

// ── isTxTerminal / isTxBlocking ─────────────────────

describe("isTxTerminal", () => {
  it("RESOLVED is terminal", () => {
    expect(isTxTerminal(SyncTransactionStatus.RESOLVED)).toBe(true);
  });

  it("CANCELLED is terminal", () => {
    expect(isTxTerminal(SyncTransactionStatus.CANCELLED)).toBe(true);
  });

  it("WAITING_APPROVAL is not terminal", () => {
    expect(isTxTerminal(SyncTransactionStatus.WAITING_APPROVAL)).toBe(false);
  });
});

describe("isTxBlocking", () => {
  it("OPEN blocks", () => {
    expect(isTxBlocking(SyncTransactionStatus.OPEN)).toBe(true);
  });

  it("WAITING_APPROVAL blocks", () => {
    expect(isTxBlocking(SyncTransactionStatus.WAITING_APPROVAL)).toBe(true);
  });

  it("REJECTED blocks", () => {
    expect(isTxBlocking(SyncTransactionStatus.REJECTED)).toBe(true);
  });

  it("APPROVED does not block", () => {
    expect(isTxBlocking(SyncTransactionStatus.APPROVED)).toBe(false);
  });

  it("RESOLVED does not block", () => {
    expect(isTxBlocking(SyncTransactionStatus.RESOLVED)).toBe(false);
  });

  it("CANCELLED does not block", () => {
    expect(isTxBlocking(SyncTransactionStatus.CANCELLED)).toBe(false);
  });
});
