/**
 * Agent Message Service — orchestrates send / read / reply / timeout lifecycle.
 *
 * API:
 *   msgSend(input)           — create message + log SENT event
 *   msgRead(messageId, actorAgentId) — mark read + log READ event
 *   msgReply(messageId, actorAgentId, body) — create response + update request + log REPLIED event
 *   msgList(filter)          — list messages for an agent
 *   msgThread(threadRootId)  — list thread messages
 *   msgCheckExpired()        — timeout checker: expired → reminder / escalation
 */

import { AgentMessageKind, AgentMessageReadStatus, AgentMessageRequestStatus, isRequestTimedOut, shouldRetry, validateAgentMessageRequestTransition } from "syncpoint-adapters";
import { EventType } from "syncpoint-kernel";
import type { AgentMessage, AgentMessageCreate } from "syncpoint-adapters";
import * as repo from "../repositories/agent-message-repository.js";
import type { ListMessagesFilter } from "../repositories/agent-message-repository.js";
import { createWakeRequest, hasActiveWakeForAgent } from "../repositories/wake-repository.js";
import { logEvent, NotFoundError } from "../repositories/_shared.js";

const DEFAULT_MAX_RETRIES = 3;

// ── Send ─────────────────────────────────────────────

export function msgSend(input: AgentMessageCreate): AgentMessage {
  const msg = repo.createMessage(input);
  logEvent(EventType.AGENT_MESSAGE_SENT, "agent_message", msg.id,
    `${msg.fromAgent} → ${msg.toAgent} [${msg.kind}]`);
  return msg;
}

// ── Read ─────────────────────────────────────────────

export function msgRead(messageId: string, actorAgentId: string): AgentMessage {
  const msg = repo.getMessage(messageId);
  if (!msg) throw new NotFoundError("agent_message", messageId);
  if (msg.toAgent !== actorAgentId) {
    throw new Error(`Agent ${actorAgentId} is not the recipient of message ${messageId}`);
  }
  if (msg.readStatus === AgentMessageReadStatus.READ) return msg;

  const updated = repo.markRead(messageId);
  logEvent(EventType.AGENT_MESSAGE_READ, "agent_message", messageId,
    `${actorAgentId} read message`);
  return updated;
}

// ── Reply ────────────────────────────────────────────

export function msgReply(messageId: string, actorAgentId: string, body: string): AgentMessage {
  const original = repo.getMessage(messageId);
  if (!original) throw new NotFoundError("agent_message", messageId);
  if (original.toAgent !== actorAgentId) {
    throw new Error(`Agent ${actorAgentId} is not the recipient of message ${messageId}`);
  }

  // Create the response message
  const threadRootId = original.threadRootId ?? original.id;
  const response = repo.createMessage({
    fromAgent: actorAgentId,
    toAgent: original.fromAgent,
    kind: AgentMessageKind.RESPONSE,
    subject: `Re: ${original.subject}`,
    body,
    threadRootId,
    replyToMessageId: messageId,
  });

  // If original is a request, transition its request status to RESPONDED
  if (original.kind === AgentMessageKind.REQUEST &&
      original.requestStatus !== AgentMessageRequestStatus.RESPONDED) {
    if (validateAgentMessageRequestTransition(original.requestStatus, AgentMessageRequestStatus.RESPONDED)) {
      repo.markRequestResponded(messageId);
    }
  }

  logEvent(EventType.AGENT_MESSAGE_REPLIED, "agent_message", response.id,
    `${actorAgentId} replied to ${messageId}`);
  return response;
}

// ── List / Thread ───────────────────────────────────

export function msgList(filter: ListMessagesFilter): AgentMessage[] {
  return repo.listMessages(filter);
}

export function msgThread(threadRootId: string): AgentMessage[] {
  return repo.listThread(threadRootId);
}

// ── Timeout checker ─────────────────────────────────

export interface ExpiredRequestAction {
  messageId: string;
  action: "reminder" | "escalate";
}

/**
 * Check all pending requests for timeout.
 * Returns actions taken: each expired request either gets a reminder (retry)
 * or is escalated (retries exhausted). Escalated messages automatically
 * create a Wake request targeting the recipient agent, with dedup protection
 * via hasActiveWakeForAgent.
 */
export function msgCheckExpired(maxRetries = DEFAULT_MAX_RETRIES, sessionId?: string): ExpiredRequestAction[] {
  const nowIso = new Date().toISOString();
  const timedOut = repo.listTimedOutRequests(nowIso);
  const actions: ExpiredRequestAction[] = [];

  for (const msg of timedOut) {
    // Transition PENDING → EXPIRED
    repo.markRequestExpired(msg.id);

    if (shouldRetry(msg.retryCount, maxRetries)) {
      // Retry: increment counter, reset to PENDING
      repo.incrementRetry(msg.id);
      logEvent(EventType.AGENT_MESSAGE_REMINDER, "agent_message", msg.id,
        `reminder retry #${msg.retryCount + 1} for ${msg.fromAgent} → ${msg.toAgent}`);
      actions.push({ messageId: msg.id, action: "reminder" });
    } else {
      // Escalate: retries exhausted
      repo.markRequestEscalated(msg.id);
      logEvent(EventType.AGENT_MESSAGE_ESCALATED, "agent_message", msg.id,
        `escalated after ${msg.retryCount} retries: ${msg.fromAgent} → ${msg.toAgent}`);

      // Create wake request to nudge the non-responsive agent (dedup)
      if (sessionId && !hasActiveWakeForAgent(sessionId, msg.toAgent, "message_timeout")) {
        createWakeRequest({
          sessionId,
          targetAgentId: msg.toAgent,
          targetRole: "",
          action: "message_timeout",
          reason: `message_timeout: ${msg.fromAgent} → ${msg.toAgent} (msg ${msg.id})`,
          triggerEventType: EventType.AGENT_MESSAGE_ESCALATED as string,
          triggerEntityId: msg.id,
          taskId: null,
          reviewRequestId: null,
          promptHint: `You have an unresponded message from ${msg.fromAgent}: "${msg.subject}". Please respond.`,
          mcpToolHint: "syncpoint_message_list",
          cliHint: "syncpoint message list --unread",
          runnerMode: "mcp",
        });
      }

      actions.push({ messageId: msg.id, action: "escalate" });
    }
  }

  return actions;
}
