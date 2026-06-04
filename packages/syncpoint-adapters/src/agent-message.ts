/**
 * Agent Message — asynchronous inter-agent messaging with read receipts
 * and request timeout / escalation.
 *
 * Kind model:
 *   message  — plain async message (no request lifecycle)
 *   request  — expects a response; has timeout / retry / escalation
 *   response — reply to a request; transitions the request to "responded"
 *
 * Read status and request status are deliberately separated so that
 * "has the recipient read this?" and "has the request been answered?"
 * are independent axes.
 */

import { z } from "zod";

// ── Kinds ──────────────────────────────────────────────

export enum AgentMessageKind {
  MESSAGE = "message",
  REQUEST = "request",
  RESPONSE = "response",
}

// ── Read status ────────────────────────────────────────

export enum AgentMessageReadStatus {
  UNREAD = "unread",
  READ = "read",
}

// ── Request status ─────────────────────────────────────

export enum AgentMessageRequestStatus {
  /** Plain message — no request lifecycle */
  NONE = "none",
  /** Request sent, waiting for response */
  PENDING = "pending",
  /** Recipient responded */
  RESPONDED = "responded",
  /** Deadline passed without response */
  EXPIRED = "expired",
  /** Escalated via Wake after retries exhausted */
  ESCALATED = "escalated",
}

// ── Request status transitions ─────────────────────────

export const AGENT_MESSAGE_REQUEST_TRANSITIONS: Record<
  Exclude<AgentMessageRequestStatus, AgentMessageRequestStatus.NONE>,
  AgentMessageRequestStatus[]
> = {
  [AgentMessageRequestStatus.PENDING]: [
    AgentMessageRequestStatus.RESPONDED,
    AgentMessageRequestStatus.EXPIRED,
  ],
  [AgentMessageRequestStatus.EXPIRED]: [
    AgentMessageRequestStatus.PENDING,   // retry
    AgentMessageRequestStatus.ESCALATED,  // retries exhausted
  ],
  [AgentMessageRequestStatus.RESPONDED]: [],
  [AgentMessageRequestStatus.ESCALATED]: [],
};

export function validateAgentMessageRequestTransition(
  from: AgentMessageRequestStatus,
  to: AgentMessageRequestStatus,
): boolean {
  if (from === AgentMessageRequestStatus.NONE) return false;
  return AGENT_MESSAGE_REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Schemas ────────────────────────────────────────────

const nanoid12 = z.string().min(1).max(24);
const isoDate = z.string().datetime({ offset: true });

export const AgentMessageSchema = z.object({
  id: nanoid12,
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  kind: z.nativeEnum(AgentMessageKind).default(AgentMessageKind.MESSAGE),
  subject: z.string().default(""),
  body: z.string().default(""),

  // Threading
  threadRootId: z.string().nullable().default(null),
  replyToMessageId: z.string().nullable().default(null),

  // Read receipt
  readStatus: z.nativeEnum(AgentMessageReadStatus).default(AgentMessageReadStatus.UNREAD),
  readAt: isoDate.nullable().default(null),

  // Request lifecycle (only meaningful when kind = request)
  requestStatus: z.nativeEnum(AgentMessageRequestStatus).default(AgentMessageRequestStatus.NONE),
  respondedAt: isoDate.nullable().default(null),
  expiresAt: isoDate.nullable().default(null),
  retryCount: z.number().int().min(0).default(0),
  lastRetryAt: isoDate.nullable().default(null),
  escalatedAt: isoDate.nullable().default(null),

  createdAt: isoDate,
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentMessageCreateSchema = z.object({
  fromAgent: z.string().min(1),
  toAgent: z.string().min(1),
  kind: z.nativeEnum(AgentMessageKind).default(AgentMessageKind.MESSAGE),
  subject: z.string().default(""),
  body: z.string().default(""),

  // Threading
  threadRootId: z.string().nullable().default(null),
  replyToMessageId: z.string().nullable().default(null),

  // Request fields (only used when kind = request)
  expiresAt: isoDate.nullable().default(null),
});

export type AgentMessageCreate = z.input<typeof AgentMessageCreateSchema>;

// ── Pure helper functions ──────────────────────────────

/**
 * Is this message a request that is still awaiting a response?
 */
export function isRequestPending(msg: Pick<AgentMessage, "kind" | "requestStatus">): boolean {
  return msg.kind === AgentMessageKind.REQUEST && msg.requestStatus === AgentMessageRequestStatus.PENDING;
}

/**
 * Is this message a request whose deadline has passed but hasn't been escalated yet?
 */
export function isRequestExpired(msg: Pick<AgentMessage, "kind" | "requestStatus">): boolean {
  return msg.kind === AgentMessageKind.REQUEST && msg.requestStatus === AgentMessageRequestStatus.EXPIRED;
}

/**
 * Is this message a request that has been escalated?
 */
export function isRequestEscalated(msg: Pick<AgentMessage, "kind" | "requestStatus">): boolean {
  return msg.kind === AgentMessageKind.REQUEST && msg.requestStatus === AgentMessageRequestStatus.ESCALATED;
}

/**
 * Check whether a request message has passed its deadline.
 * Returns false for non-request messages or requests without a deadline.
 */
export function isRequestTimedOut(
  msg: Pick<AgentMessage, "kind" | "requestStatus" | "expiresAt">,
  now = new Date(),
): boolean {
  if (msg.kind !== AgentMessageKind.REQUEST) return false;
  if (msg.requestStatus !== AgentMessageRequestStatus.PENDING && msg.requestStatus !== AgentMessageRequestStatus.EXPIRED) return false;
  if (!msg.expiresAt) return false;
  return new Date(msg.expiresAt) <= now;
}

/**
 * Should a request be retried (vs escalated)?
 * Returns true when retryCount < maxRetries.
 */
export function shouldRetry(retryCount: number, maxRetries: number): boolean {
  return retryCount < maxRetries;
}
