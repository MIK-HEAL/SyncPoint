import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  msgSend,
  msgRead,
  msgReply,
  msgList,
  msgThread,
} from "syncpoint-server/application";
import { fail, ok } from "./_shared.js";

export function registerAgentMessageTools(server: McpServer): void {
  // Agent Message Tools
  // ═══════════════════════════════════════════════════════

  server.registerTool(
    "syncpoint_message_send",
    {
      title: "Send Message",
      description: "Send a message to another agent. Use kind='request' for messages that require a response (with optional timeout).",
      inputSchema: {
        fromAgent: z.string().describe("Sender agent ID"),
        toAgent: z.string().describe("Recipient agent ID"),
        kind: z.enum(["message", "request", "response"]).default("message").describe("Message kind: plain message, request (expects response), or response"),
        subject: z.string().default("").describe("Subject line"),
        body: z.string().default("").describe("Message body"),
        expiresAt: z.string().nullable().default(null).describe("ISO timestamp when request expires (only for kind=request)"),
      },
    },
    async (input) => {
      try {
        const msg = msgSend({ ...input, kind: input.kind as import("syncpoint-core").AgentMessageKind });
        return ok({ id: msg.id, kind: msg.kind, requestStatus: msg.requestStatus });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_message_list",
    {
      title: "List Messages",
      description: "List messages with optional filters. Commonly used to check unread messages for an agent.",
      inputSchema: {
        toAgent: z.string().optional().describe("Filter by recipient agent ID"),
        fromAgent: z.string().optional().describe("Filter by sender agent ID"),
        unreadOnly: z.boolean().optional().describe("Only show unread messages"),
        kind: z.enum(["message", "request", "response"]).optional().describe("Filter by message kind"),
        limit: z.number().int().min(1).max(100).optional().describe("Max results (default 50)"),
      },
    },
    async (input) => {
      try {
        const messages = msgList({ ...input, kind: input.kind as import("syncpoint-core").AgentMessageKind | undefined });
        return ok({ count: messages.length, messages });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_message_read",
    {
      title: "Read Message",
      description: "Mark a message as read. Only the recipient agent can mark a message as read.",
      inputSchema: {
        messageId: z.string().describe("Message ID to mark as read"),
        agentId: z.string().describe("Agent ID (must be the recipient)"),
      },
    },
    async ({ messageId, agentId }) => {
      try {
        const msg = msgRead(messageId, agentId);
        return ok({ id: msg.id, readStatus: msg.readStatus, readAt: msg.readAt });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_message_reply",
    {
      title: "Reply to Message",
      description: "Reply to a message. Creates a response message in the same thread. If replying to a request, transitions the request to RESPONDED.",
      inputSchema: {
        messageId: z.string().describe("Message ID to reply to"),
        agentId: z.string().describe("Agent ID (must be the recipient of the original message)"),
        body: z.string().describe("Reply body"),
      },
    },
    async ({ messageId, agentId, body }) => {
      try {
        const response = msgReply(messageId, agentId, body);
        return ok({ id: response.id, threadRootId: response.threadRootId, replyToMessageId: response.replyToMessageId });
      } catch (e) { return fail(e); }
    }
  );

  server.registerTool(
    "syncpoint_message_thread",
    {
      title: "View Message Thread",
      description: "View all messages in a thread, ordered chronologically.",
      inputSchema: {
        threadRootId: z.string().describe("Thread root message ID"),
      },
    },
    async ({ threadRootId }) => {
      try {
        const messages = msgThread(threadRootId);
        return ok({ count: messages.length, messages });
      } catch (e) { return fail(e); }
    }
  );
}
