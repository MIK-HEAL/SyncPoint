/**
 * CLI Message commands — send, list, read, reply, thread.
 */

import { Command } from "commander";
import {
  msgSend,
  msgRead,
  msgReply,
  msgList,
  msgThread,
} from "syncpoint-server/application";
import { AgentMessageKind } from "syncpoint-core";

export function registerMessageCommands(program: Command): void {
  const message = new Command("message")
    .description("Inter-agent messaging: send, list, read, reply");

  // syncpoint message send
  message
    .command("send")
    .description("Send a message to another agent")
    .requiredOption("--from <agentId>", "Sender agent ID")
    .requiredOption("--to <agentId>", "Recipient agent ID")
    .option("--kind <kind>", "Message kind: message, request, response", "message")
    .option("--subject <subject>", "Subject line", "")
    .option("--body <body>", "Message body", "")
    .option("--expires <iso>", "Expiration timestamp (for requests)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const kind = opts.kind as AgentMessageKind;
      const msg = msgSend({
        fromAgent: opts.from,
        toAgent: opts.to,
        kind,
        subject: opts.subject,
        body: opts.body,
        expiresAt: opts.expires ?? null,
      });
      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(`Message sent: ${msg.id}`);
        console.log(`  ${msg.fromAgent} → ${msg.toAgent} [${msg.kind}]`);
        if (msg.subject) console.log(`  Subject: ${msg.subject}`);
        if (msg.requestStatus !== "none") console.log(`  Request status: ${msg.requestStatus}`);
      }
    });

  // syncpoint message list
  message
    .command("list")
    .description("List messages with optional filters")
    .option("--to <agentId>", "Filter by recipient")
    .option("--from <agentId>", "Filter by sender")
    .option("--unread", "Only show unread messages")
    .option("--kind <kind>", "Filter by kind (message, request, response)")
    .option("--limit <n>", "Max results", "50")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const messages = msgList({
        toAgent: opts.to,
        fromAgent: opts.from,
        unreadOnly: opts.unread || undefined,
        kind: opts.kind as AgentMessageKind | undefined,
        limit: parseInt(opts.limit, 10),
      });
      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else if (messages.length === 0) {
        console.log("No messages found.");
      } else {
        for (const m of messages) {
          const readFlag = m.readStatus === "unread" ? "●" : "○";
          console.log(`${readFlag} ${m.id}  ${m.fromAgent}→${m.toAgent}  [${m.kind}]  ${m.subject || "(no subject)"}`);
          if (m.requestStatus !== "none") console.log(`     request: ${m.requestStatus}`);
        }
        console.log(`\n${messages.length} message(s)`);
      }
    });

  // syncpoint message read
  message
    .command("read <messageId>")
    .description("Mark a message as read")
    .requiredOption("--agent <agentId>", "Agent ID (must be the recipient)")
    .option("--json", "Output as JSON")
    .action(async (messageId, opts) => {
      const msg = msgRead(messageId, opts.agent);
      if (opts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(`Marked as read: ${msg.id} by ${opts.agent}`);
      }
    });

  // syncpoint message reply
  message
    .command("reply <messageId>")
    .description("Reply to a message")
    .requiredOption("--agent <agentId>", "Agent ID (must be the recipient)")
    .requiredOption("--body <body>", "Reply body")
    .option("--json", "Output as JSON")
    .action(async (messageId, opts) => {
      const response = msgReply(messageId, opts.agent, opts.body);
      if (opts.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        console.log(`Reply sent: ${response.id} (thread: ${response.threadRootId})`);
      }
    });

  // syncpoint message thread
  message
    .command("thread <threadRootId>")
    .description("View all messages in a thread")
    .option("--json", "Output as JSON")
    .action(async (threadRootId, opts) => {
      const messages = msgThread(threadRootId);
      if (opts.json) {
        console.log(JSON.stringify(messages, null, 2));
      } else if (messages.length === 0) {
        console.log("No messages in thread.");
      } else {
        for (const m of messages) {
          const indent = m.threadRootId === m.id ? "" : "  ↳ ";
          console.log(`${indent}${m.fromAgent}→${m.toAgent} [${m.kind}] ${m.subject || ""}`);
          if (m.body) console.log(`${indent}  ${m.body}`);
        }
      }
    });

  program.addCommand(message);
}
