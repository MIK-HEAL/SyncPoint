/**
 * Agent Message repository — CRUD + read/reply/timeout mutations.
 */

import { eq, and, lt, desc, asc, or } from "drizzle-orm";
import * as s from "../schema.js";
import {
  AgentMessageKind,
  AgentMessageReadStatus,
  AgentMessageRequestStatus,
} from "syncpoint-adapters";
import type { AgentMessage, AgentMessageCreate } from "syncpoint-adapters";
import { _getDb, now, createId, NotFoundError } from "./_shared.js";

// ── Row → domain type ────────────────────────────────

function rowToAgentMessage(row: typeof s.agentMessages.$inferSelect): AgentMessage {
  return {
    id: row.id,
    fromAgent: row.fromAgent,
    toAgent: row.toAgent,
    kind: row.kind as AgentMessageKind,
    subject: row.subject,
    body: row.body,
    threadRootId: row.threadRootId ?? null,
    replyToMessageId: row.replyToMessageId ?? null,
    readStatus: row.readStatus as AgentMessageReadStatus,
    readAt: row.readAt ?? null,
    requestStatus: row.requestStatus as AgentMessageRequestStatus,
    respondedAt: row.respondedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    retryCount: row.retryCount,
    lastRetryAt: row.lastRetryAt ?? null,
    escalatedAt: row.escalatedAt ?? null,
    createdAt: row.createdAt,
  };
}

// ── Create ───────────────────────────────────────────

export function createMessage(input: AgentMessageCreate): AgentMessage {
  const db = _getDb();
  const id = createId();
  const ts = now();

  const kind = input.kind ?? AgentMessageKind.MESSAGE;
  const requestStatus = kind === AgentMessageKind.REQUEST
    ? AgentMessageRequestStatus.PENDING
    : AgentMessageRequestStatus.NONE;

  db.insert(s.agentMessages).values({
    id,
    fromAgent: input.fromAgent,
    toAgent: input.toAgent,
    kind,
    subject: input.subject ?? "",
    body: input.body ?? "",
    threadRootId: input.threadRootId ?? null,
    replyToMessageId: input.replyToMessageId ?? null,
    readStatus: AgentMessageReadStatus.UNREAD,
    requestStatus,
    expiresAt: input.expiresAt ?? null,
    retryCount: 0,
    createdAt: ts,
  }).run();

  return getMessageOrThrow(id);
}

// ── Read ─────────────────────────────────────────────

export function getMessage(messageId: string): AgentMessage | null {
  const db = _getDb();
  const row = db.select().from(s.agentMessages)
    .where(eq(s.agentMessages.id, messageId))
    .get();
  return row ? rowToAgentMessage(row) : null;
}

function getMessageOrThrow(messageId: string): AgentMessage {
  const msg = getMessage(messageId);
  if (!msg) throw new NotFoundError("agent_message", messageId);
  return msg;
}

// ── List ─────────────────────────────────────────────

export interface ListMessagesFilter {
  toAgent?: string;
  fromAgent?: string;
  unreadOnly?: boolean;
  kind?: AgentMessageKind;
  requestStatus?: AgentMessageRequestStatus;
  limit?: number;
}

export function listMessages(filter: ListMessagesFilter = {}): AgentMessage[] {
  const db = _getDb();
  const conditions = [];

  if (filter.toAgent) conditions.push(eq(s.agentMessages.toAgent, filter.toAgent));
  if (filter.fromAgent) conditions.push(eq(s.agentMessages.fromAgent, filter.fromAgent));
  if (filter.unreadOnly) conditions.push(eq(s.agentMessages.readStatus, AgentMessageReadStatus.UNREAD));
  if (filter.kind) conditions.push(eq(s.agentMessages.kind, filter.kind));
  if (filter.requestStatus) conditions.push(eq(s.agentMessages.requestStatus, filter.requestStatus));

  const rows = db.select().from(s.agentMessages)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(s.agentMessages.createdAt))
    .limit(filter.limit ?? 1000)
    .all();

  return rows.map(rowToAgentMessage);
}

// ── Thread ───────────────────────────────────────────

export function listThread(threadRootId: string): AgentMessage[] {
  const db = _getDb();
  return db.select().from(s.agentMessages)
    .where(or(
      eq(s.agentMessages.id, threadRootId),
      eq(s.agentMessages.threadRootId, threadRootId),
    ))
    .orderBy(asc(s.agentMessages.createdAt))
    .all()
    .map(rowToAgentMessage);
}

// ── Status mutations ─────────────────────────────────

export function markRead(messageId: string): AgentMessage {
  const db = _getDb();
  const ts = now();
  db.update(s.agentMessages)
    .set({ readStatus: AgentMessageReadStatus.READ, readAt: ts })
    .where(eq(s.agentMessages.id, messageId))
    .run();
  return getMessageOrThrow(messageId);
}

export function markRequestResponded(messageId: string): AgentMessage {
  const db = _getDb();
  const ts = now();
  db.update(s.agentMessages)
    .set({ requestStatus: AgentMessageRequestStatus.RESPONDED, respondedAt: ts })
    .where(eq(s.agentMessages.id, messageId))
    .run();
  return getMessageOrThrow(messageId);
}

export function markRequestExpired(messageId: string): AgentMessage {
  const db = _getDb();
  db.update(s.agentMessages)
    .set({ requestStatus: AgentMessageRequestStatus.EXPIRED })
    .where(eq(s.agentMessages.id, messageId))
    .run();
  return getMessageOrThrow(messageId);
}

export function markRequestEscalated(messageId: string): AgentMessage {
  const db = _getDb();
  const ts = now();
  db.update(s.agentMessages)
    .set({ requestStatus: AgentMessageRequestStatus.ESCALATED, escalatedAt: ts })
    .where(eq(s.agentMessages.id, messageId))
    .run();
  return getMessageOrThrow(messageId);
}

export function incrementRetry(messageId: string): AgentMessage {
  const db = _getDb();
  const ts = now();
  const msg = getMessageOrThrow(messageId);
  const nextRetry = msg.retryCount + 1;
  db.update(s.agentMessages)
    .set({ retryCount: nextRetry, lastRetryAt: ts, requestStatus: AgentMessageRequestStatus.PENDING })
    .where(eq(s.agentMessages.id, messageId))
    .run();
  return getMessageOrThrow(messageId);
}

// ── Timeout query ───────────────────────────────────

/**
 * Find requests that have passed their deadline but are still pending.
 * Used by the timeout checker to detect expired → reminder / escalation.
 */
export function listTimedOutRequests(nowIso: string, limit = 100): AgentMessage[] {
  const db = _getDb();
  return db.select().from(s.agentMessages)
    .where(
      and(
        eq(s.agentMessages.kind, AgentMessageKind.REQUEST),
        eq(s.agentMessages.requestStatus, AgentMessageRequestStatus.PENDING),
        lt(s.agentMessages.expiresAt, nowIso),
      )
    )
    .limit(limit)
    .all()
    .map(rowToAgentMessage);
}
