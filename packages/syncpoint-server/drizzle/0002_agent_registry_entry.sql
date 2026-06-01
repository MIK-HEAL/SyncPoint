CREATE TABLE `agent_registry_entry` (
	`manifest_path` text PRIMARY KEY NOT NULL,
	`agent_id` text,
	`source_format` text DEFAULT '' NOT NULL,
	`content_hash` text DEFAULT '' NOT NULL,
	`manifest_json` text DEFAULT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`last_sync_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_agent_registry_entry_agent` ON `agent_registry_entry` (`agent_id`);
