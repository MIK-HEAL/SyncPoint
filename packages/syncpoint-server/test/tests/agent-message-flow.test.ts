/**
 * E2E: Agent Message tRPC router — send, list, read, reply, thread.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startE2E, type E2EContext } from "../../src/tests/e2e-helper.js";

let ctx: E2EContext;

beforeAll(async () => { ctx = await startE2E(); });
afterAll(async () => { await ctx.cleanup(); });

describe("Agent Message tRPC flow", () => {
  const fromAgent = "sAgentSender001";
  const toAgent = "sAgentRecip001";

  it("sends a plain message", async () => {
    const msg = (await ctx.rpc("agentMessage.send", {
      fromAgent,
      toAgent,
      kind: "message",
      subject: "Hello",
      body: "World",
    })) as any;
    expect(msg.id).toBeTruthy();
    expect(msg.kind).toBe("message");
    expect(msg.requestStatus).toBe("none");
    expect(msg.readStatus).toBe("unread");
  });

  it("sends a request message", async () => {
    const msg = (await ctx.rpc("agentMessage.send", {
      fromAgent,
      toAgent,
      kind: "request",
      subject: "Review needed",
      body: "Please review",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })) as any;
    expect(msg.kind).toBe("request");
    expect(msg.requestStatus).toBe("pending");
  });

  it("lists messages for recipient", async () => {
    const result = (await ctx.rpc("agentMessage.list", {
      toAgent,
    }, "GET")) as any;
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("lists unread messages only", async () => {
    const result = (await ctx.rpc("agentMessage.list", {
      toAgent,
      unreadOnly: true,
    }, "GET")) as any;
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const m of result) {
      expect(m.readStatus).toBe("unread");
    }
  });

  let messageId: string;

  it("marks a message as read", async () => {
    // Get first unread message
    const list = (await ctx.rpc("agentMessage.list", {
      toAgent,
      unreadOnly: true,
      limit: 1,
    }, "GET")) as any;
    messageId = list[0]!.id;

    const updated = (await ctx.rpc("agentMessage.read", {
      messageId,
      agentId: toAgent,
    })) as any;
    expect(updated.readStatus).toBe("read");
    expect(updated.readAt).toBeTruthy();
  });

  it("replies to a message", async () => {
    // Send a fresh message to reply to
    const msg = (await ctx.rpc("agentMessage.send", {
      fromAgent,
      toAgent,
      kind: "request",
      subject: "Need approval",
    })) as any;

    const reply = (await ctx.rpc("agentMessage.reply", {
      messageId: msg.id,
      agentId: toAgent,
      body: "Approved!",
    })) as any;
    expect(reply.kind).toBe("response");
    expect(reply.replyToMessageId).toBe(msg.id);
    expect(reply.threadRootId).toBe(msg.id);
    expect(reply.body).toBe("Approved!");
  });

  it("fetches a thread", async () => {
    // Send a request + reply to create a thread
    const root = (await ctx.rpc("agentMessage.send", {
      fromAgent,
      toAgent,
      kind: "request",
      subject: "Thread test",
    })) as any;

    await ctx.rpc("agentMessage.reply", {
      messageId: root.id,
      agentId: toAgent,
      body: "Reply 1",
    });

    const thread = (await ctx.rpc("agentMessage.thread", {
      threadRootId: root.id,
    }, "GET")) as any;
    expect(thread.length).toBe(2);
    expect(thread[0]!.id).toBe(root.id);
  });
});
