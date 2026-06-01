/**
 * CLI message command tests — exercises the application functions that CLI message commands call.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "syncpoint-server";
import * as repo from "syncpoint-server/repositories";
import {
  msgSend,
  msgRead,
  msgReply,
  msgList,
  msgThread,
} from "syncpoint-server/application";
import { AgentMessageKind, AgentMessageRequestStatus } from "syncpoint-core";

let tmpDir: string;
let agent1Id: string;
let agent2Id: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-msg-cli-test-"));
  process.env.SYNCPOINT_DB_DIR = tmpDir;
  getDb();
  const a1 = repo.createAgent({ name: "msg-cli-1", provider: "other", role: "backend" });
  const a2 = repo.createAgent({ name: "msg-cli-2", provider: "other", role: "frontend" });
  agent1Id = a1.id;
  agent2Id = a2.id;
});

afterAll(() => {
  closeDb();
  delete process.env.SYNCPOINT_DB_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("CLI message send", () => {
  it("sends a plain message via msgSend", () => {
    const msg = msgSend({ fromAgent: agent1Id, toAgent: agent2Id, subject: "CLI test", body: "Hello" });
    expect(msg.kind).toBe(AgentMessageKind.MESSAGE);
    expect(msg.subject).toBe("CLI test");
    expect(msg.readStatus).toBe("unread");
  });

  it("sends a request via msgSend", () => {
    const msg = msgSend({
      fromAgent: agent1Id,
      toAgent: agent2Id,
      kind: AgentMessageKind.REQUEST,
      subject: "Need review",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(msg.kind).toBe(AgentMessageKind.REQUEST);
    expect(msg.requestStatus).toBe(AgentMessageRequestStatus.PENDING);
  });
});

describe("CLI message list", () => {
  it("lists messages for recipient", () => {
    const messages = msgList({ toAgent: agent2Id });
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("lists unread only", () => {
    const messages = msgList({ toAgent: agent2Id, unreadOnly: true });
    for (const m of messages) {
      expect(m.readStatus).toBe("unread");
    }
  });
});

describe("CLI message read", () => {
  it("marks message as read", () => {
    const msg = msgSend({ fromAgent: agent1Id, toAgent: agent2Id, subject: "Read test" });
    const updated = msgRead(msg.id, agent2Id);
    expect(updated.readStatus).toBe("read");
  });
});

describe("CLI message reply", () => {
  it("replies and transitions request to RESPONDED", () => {
    const request = msgSend({ fromAgent: agent1Id, toAgent: agent2Id, kind: AgentMessageKind.REQUEST, subject: "Reply test" });
    const response = msgReply(request.id, agent2Id, "Done!");
    expect(response.kind).toBe(AgentMessageKind.RESPONSE);
    expect(response.replyToMessageId).toBe(request.id);
    expect(response.threadRootId).toBe(request.id);
  });
});

describe("CLI message thread", () => {
  it("shows full thread", () => {
    const root = msgSend({ fromAgent: agent1Id, toAgent: agent2Id, kind: AgentMessageKind.REQUEST, subject: "Thread CLI" });
    msgReply(root.id, agent2Id, "Reply in thread");
    const thread = msgThread(root.id);
    expect(thread.length).toBe(2);
  });
});
