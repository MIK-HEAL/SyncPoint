import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { __setDb, _getDb } from "../../src/repositories/_shared.js";
import {
  createMessage,
  getMessage,
  listMessages,
  listThread,
  markRead,
  markRequestResponded,
  markRequestExpired,
  markRequestEscalated,
  incrementRetry,
  listTimedOutRequests,
} from "../../src/repositories/agent-message-repository.js";
import { runMigrations } from "../db.js";
import {
  AgentMessageKind,
  AgentMessageReadStatus,
  AgentMessageRequestStatus,
} from "syncpoint-adapters";

let rawDb: Database.Database;

beforeEach(() => {
  rawDb = new Database(":memory:");
  rawDb.pragma("foreign_keys = ON");
  const db = drizzle(rawDb, { schema });
  __setDb(db);
  runMigrations(rawDb);
});

afterEach(() => {
  __setDb(null);
  rawDb.close();
});

const nowIso = () => new Date().toISOString();

describe("createMessage + getMessage", () => {
  it("creates a plain message with defaults", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2" });
    expect(msg.fromAgent).toBe("a1");
    expect(msg.toAgent).toBe("a2");
    expect(msg.kind).toBe(AgentMessageKind.MESSAGE);
    expect(msg.readStatus).toBe(AgentMessageReadStatus.UNREAD);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.NONE);
    expect(msg.subject).toBe("");
    expect(msg.body).toBe("");
    expect(msg.retryCount).toBe(0);
  });

  it("creates a request with PENDING requestStatus", () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const msg = createMessage({
      fromAgent: "a1",
      toAgent: "a2",
      kind: AgentMessageKind.REQUEST,
      subject: "Review needed",
      body: "Please review",
      expiresAt: expires,
    });
    expect(msg.kind).toBe(AgentMessageKind.REQUEST);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.PENDING);
    expect(msg.expiresAt).toBe(expires);
    expect(msg.subject).toBe("Review needed");
  });

  it("creates a response with thread fields", () => {
    const root = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const reply = createMessage({
      fromAgent: "a2",
      toAgent: "a1",
      kind: AgentMessageKind.RESPONSE,
      threadRootId: root.id,
      replyToMessageId: root.id,
    });
    expect(reply.kind).toBe(AgentMessageKind.RESPONSE);
    expect(reply.threadRootId).toBe(root.id);
    expect(reply.replyToMessageId).toBe(root.id);
    // response is not a request, so requestStatus = NONE
    expect(reply.requestStatus).toBe(AgentMessageRequestStatus.NONE);
  });

  it("getMessage returns null for unknown id", () => {
    expect(getMessage("nonexistent")).toBeNull();
  });
});

describe("listMessages", () => {
  it("filters by toAgent", () => {
    createMessage({ fromAgent: "a1", toAgent: "a2" });
    createMessage({ fromAgent: "a1", toAgent: "a3" });
    const list = listMessages({ toAgent: "a2" });
    expect(list).toHaveLength(1);
    expect(list[0]!.toAgent).toBe("a2");
  });

  it("filters by unreadOnly", () => {
    const m1 = createMessage({ fromAgent: "a1", toAgent: "a2" });
    createMessage({ fromAgent: "a1", toAgent: "a3" });
    markRead(m1.id);
    const unread = listMessages({ unreadOnly: true });
    expect(unread).toHaveLength(1);
    expect(unread[0]!.toAgent).toBe("a3");
  });

  it("filters by kind", () => {
    createMessage({ fromAgent: "a1", toAgent: "a2" });
    createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const requests = listMessages({ kind: AgentMessageKind.REQUEST });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.kind).toBe(AgentMessageKind.REQUEST);
  });

  it("filters by requestStatus", () => {
    const m = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    markRequestExpired(m.id);
    const expired = listMessages({ requestStatus: AgentMessageRequestStatus.EXPIRED });
    expect(expired).toHaveLength(1);
  });

  it("respects limit", () => {
    for (let i = 0; i < 5; i++) {
      createMessage({ fromAgent: "a1", toAgent: "a2" });
    }
    expect(listMessages({ limit: 3 })).toHaveLength(3);
  });
});

describe("listThread", () => {
  it("returns all messages in a thread ordered by createdAt", () => {
    const root = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const reply = createMessage({
      fromAgent: "a2",
      toAgent: "a1",
      kind: AgentMessageKind.RESPONSE,
      threadRootId: root.id,
      replyToMessageId: root.id,
    });
    const thread = listThread(root.id);
    expect(thread).toHaveLength(2);
    expect(thread[0]!.id).toBe(root.id);
    expect(thread[1]!.id).toBe(reply.id);
  });
});

describe("markRead", () => {
  it("updates readStatus and readAt", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2" });
    expect(msg.readStatus).toBe(AgentMessageReadStatus.UNREAD);
    const updated = markRead(msg.id);
    expect(updated.readStatus).toBe(AgentMessageReadStatus.READ);
    expect(updated.readAt).toBeTruthy();
  });
});

describe("markRequestResponded", () => {
  it("updates requestStatus and respondedAt", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const updated = markRequestResponded(msg.id);
    expect(updated.requestStatus).toBe(AgentMessageRequestStatus.RESPONDED);
    expect(updated.respondedAt).toBeTruthy();
  });
});

describe("markRequestExpired", () => {
  it("updates requestStatus to EXPIRED", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const updated = markRequestExpired(msg.id);
    expect(updated.requestStatus).toBe(AgentMessageRequestStatus.EXPIRED);
  });
});

describe("markRequestEscalated", () => {
  it("updates requestStatus and escalatedAt", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    markRequestExpired(msg.id);
    const updated = markRequestEscalated(msg.id);
    expect(updated.requestStatus).toBe(AgentMessageRequestStatus.ESCALATED);
    expect(updated.escalatedAt).toBeTruthy();
  });
});

describe("incrementRetry", () => {
  it("increments retryCount and resets to PENDING", () => {
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    markRequestExpired(msg.id);
    const updated = incrementRetry(msg.id);
    expect(updated.retryCount).toBe(1);
    expect(updated.requestStatus).toBe(AgentMessageRequestStatus.PENDING);
    expect(updated.lastRetryAt).toBeTruthy();
  });
});

describe("listTimedOutRequests", () => {
  it("finds pending requests past their deadline", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, expiresAt: past });
    // not timed out — future deadline
    const future = new Date(Date.now() + 60_000).toISOString();
    createMessage({ fromAgent: "a1", toAgent: "a3", kind: AgentMessageKind.REQUEST, expiresAt: future });
    // plain message — no deadline
    createMessage({ fromAgent: "a1", toAgent: "a4" });

    const timedOut = listTimedOutRequests(nowIso());
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]!.toAgent).toBe("a2");
  });

  it("excludes already-expired requests (only PENDING)", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const msg = createMessage({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, expiresAt: past });
    markRequestExpired(msg.id);
    const timedOut = listTimedOutRequests(nowIso());
    expect(timedOut).toHaveLength(0);
  });
});
