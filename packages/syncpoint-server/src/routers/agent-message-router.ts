/**
 * Agent Message Router — tRPC endpoints for inter-agent messaging.
 *
 * Provides:
 *   send    — send a message (plain / request / response)
 *   list    — list messages with filters
 *   read    — mark a message as read
 *   reply   — reply to a message
 *   thread  — list all messages in a thread
 */
import { z } from "zod";
import {
  msgSend, msgRead, msgReply, msgList, msgThread,
} from "../application/agent-message-service.js";
import { AgentMessageKind, AgentMessageRequestStatus } from "syncpoint-adapters";
import { t, publicProcedure, protectedProcedure } from "./_trpc.js";

export const agentMessageRouter = t.router({

  send: protectedProcedure
    .input(z.object({
      fromAgent: z.string().min(1),
      toAgent: z.string().min(1),
      kind: z.nativeEnum(AgentMessageKind).default(AgentMessageKind.MESSAGE),
      subject: z.string().default(""),
      body: z.string().default(""),
      threadRootId: z.string().nullable().default(null),
      replyToMessageId: z.string().nullable().default(null),
      expiresAt: z.string().nullable().default(null),
    }))
    .mutation(({ input }) => msgSend(input)),

  list: publicProcedure
    .input(z.object({
      toAgent: z.string().optional(),
      fromAgent: z.string().optional(),
      unreadOnly: z.boolean().optional(),
      kind: z.nativeEnum(AgentMessageKind).optional(),
      requestStatus: z.nativeEnum(AgentMessageRequestStatus).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    }))
    .query(({ input }) => msgList(input)),

  read: protectedProcedure
    .input(z.object({
      messageId: z.string(),
      agentId: z.string(),
    }))
    .mutation(({ input }) => msgRead(input.messageId, input.agentId)),

  reply: protectedProcedure
    .input(z.object({
      messageId: z.string(),
      agentId: z.string(),
      body: z.string(),
    }))
    .mutation(({ input }) => msgReply(input.messageId, input.agentId, input.body)),

  thread: publicProcedure
    .input(z.object({
      threadRootId: z.string(),
    }))
    .query(({ input }) => msgThread(input.threadRootId)),

});
