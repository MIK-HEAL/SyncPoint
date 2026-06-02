import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../schema.js";
import { __setDb } from "../repositories/_shared.js";
import { runMigrations } from "../db.js";
import {
  msgSend,
  msgRead,
  msgReply,
  msgList,
  msgThread,
  msgCheckExpired,
} from "./agent-message-service.js";
import {
  AgentMessageKind,
  AgentMessageReadStatus,
  AgentMessageRequestStatus,
} from "syncpoint-core";

let rawDb: Database.Database;

beforeEach(() => {
  rawDb = new Database(":memory:");
  rawDb.pragma("foreign_keys = ON");
  __setDb(drizzle(rawDb, { schema }));
  runMigrations(rawDb);
});

afterEach(() => {
  __setDb(null);
  rawDb.close();
});

describe("msgSend", () => {
  it("creates a plain message and logs event", () => {
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2" });
    expect(msg.kind).toBe(AgentMessageKind.MESSAGE);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.NONE);
  });

  it("creates a request with PENDING requestStatus", () => {
    const expires = new Date(Date.now() + 60_000).toISOString();
    const msg = msgSend({
      fromAgent: "a1",
      toAgent: "a2",
      kind: AgentMessageKind.REQUEST,
      expiresAt: expires,
    });
    expect(msg.kind).toBe(AgentMessageKind.REQUEST);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.PENDING);
  });
});

describe("msgRead", () => {
  it("marks a message as read", () => {
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2" });
    const updated = msgRead(msg.id, "a2");
    expect(updated.readStatus).toBe(AgentMessageReadStatus.READ);
    expect(updated.readAt).toBeTruthy();
  });

  it("rejects non-recipient reading", () => {
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2" });
    expect(() => msgRead(msg.id, "a3")).toThrow("not the recipient");
  });

  it("is idempotent for already-read messages", () => {
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2" });
    msgRead(msg.id, "a2");
    const second = msgRead(msg.id, "a2");
    expect(second.readStatus).toBe(AgentMessageReadStatus.READ);
  });

  it("throws NotFoundError for missing message", () => {
    expect(() => msgRead("nonexistent", "a2")).toThrow("not found");
  });
});

describe("msgReply", () => {
  it("creates a response and transitions request to RESPONDED", () => {
    const request = msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const response = msgReply(request.id, "a2", "Done!");
    expect(response.kind).toBe(AgentMessageKind.RESPONSE);
    expect(response.replyToMessageId).toBe(request.id);
    expect(response.threadRootId).toBe(request.id);
    expect(response.toAgent).toBe("a1");
    expect(response.body).toBe("Done!");

    // Original request should now be RESPONDED
    const refreshed = msgList({ toAgent: "a2", kind: AgentMessageKind.REQUEST })[0]!;
    expect(refreshed.requestStatus).toBe(AgentMessageRequestStatus.RESPONDED);
  });

  it("threads correctly on nested reply", () => {
    const root = msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST });
    const reply1 = msgReply(root.id, "a2", "First reply");
    const reply2 = msgReply(reply1.id, "a1", "Second reply");
    // All should share the same threadRootId
    expect(reply1.threadRootId).toBe(root.id);
    expect(reply2.threadRootId).toBe(root.id);
  });

  it("rejects non-recipient reply", () => {
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2" });
    expect(() => msgReply(msg.id, "a3", "Nope")).toThrow("not the recipient");
  });
});

describe("msgList", () => {
  it("filters by toAgent and unreadOnly", () => {
    msgSend({ fromAgent: "a1", toAgent: "a2" });
    msgSend({ fromAgent: "a1", toAgent: "a3" });
    const unread = msgList({ toAgent: "a2", unreadOnly: true });
    expect(unread).toHaveLength(1);
  });
});

describe("msgThread", () => {
  it("returns all messages in thread order", () => {
    const root = msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, subject: "Review" });
    msgReply(root.id, "a2", "OK");
    const thread = msgThread(root.id);
    expect(thread).toHaveLength(2);
    expect(thread[0]!.subject).toBe("Review");
    expect(thread[1]!.subject).toBe("Re: Review");
  });
});

describe("msgCheckExpired", () => {
  it("reminds on first timeout (retry)", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, expiresAt: past });
    const actions = msgCheckExpired(3);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("reminder");
  });

  it("escalates after max retries", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const msg = msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, expiresAt: past });
    // Simulate 3 prior retries
    for (let i = 0; i < 3; i++) {
      msgCheckExpired(3);
      // Re-expire the message by setting a past deadline again
      // After incrementRetry, requestStatus is PENDING with a new retryCount
      // but expiresAt is still in the past, so it will be picked up again
    }
    // Now retryCount = 3, should escalate
    const actions = msgCheckExpired(3);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.action).toBe("escalate");
  });

  it("returns empty when no requests are timed out", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    msgSend({ fromAgent: "a1", toAgent: "a2", kind: AgentMessageKind.REQUEST, expiresAt: future });
    expect(msgCheckExpired(3)).toHaveLength(0);
  });
});
