-- Agent Message table: asynchronous inter-agent messaging with read receipts
-- and request timeout / escalation lifecycle.

CREATE TABLE `agent_message` (
	`id` text PRIMARY KEY NOT NULL,
	`from_agent` text NOT NULL,
	`to_agent` text NOT NULL,
	`kind` text DEFAULT 'message' NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`thread_root_id` text,
	`reply_to_message_id` text,
	`read_status` text DEFAULT 'unread' NOT NULL,
	`read_at` text,
	`request_status` text DEFAULT 'none' NOT NULL,
	`responded_at` text,
	`expires_at` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`last_retry_at` text,
	`escalated_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_am_to_agent_created` ON `agent_message` (`to_agent`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_am_request_expires` ON `agent_message` (`request_status`,`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_am_reply_to` ON `agent_message` (`reply_to_message_id`);
--> statement-breakpoint
CREATE INDEX `idx_am_thread_root` ON `agent_message` (`thread_root_id`);
