CREATE TABLE IF NOT EXISTS `peer_contract` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`participants` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`responsibilities` text DEFAULT '' NOT NULL,
	`interface_spec` text DEFAULT '' NOT NULL,
	`file_boundaries` text DEFAULT '' NOT NULL,
	`dependencies` text DEFAULT '' NOT NULL,
	`test_plan` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `peer_contract` RENAME TO `peer_contract__old`;
--> statement-breakpoint
CREATE TABLE `peer_contract` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`test_plan` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_contract_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`position` integer NOT NULL,
	`participant` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `peer_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_contract_responsibility` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`position` integer NOT NULL,
	`responsibility` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `peer_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_contract_interface_spec` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`position` integer NOT NULL,
	`spec` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `peer_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_contract_file_boundary` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`position` integer NOT NULL,
	`boundary` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `peer_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `peer_contract_dependency` (
	`id` text PRIMARY KEY NOT NULL,
	`contract_id` text NOT NULL,
	`position` integer NOT NULL,
	`dependency` text NOT NULL,
	FOREIGN KEY (`contract_id`) REFERENCES `peer_contract`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_peer_contract_participant_contract` ON `peer_contract_participant` (`contract_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_peer_contract_participant_position` ON `peer_contract_participant` (`contract_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_peer_contract_responsibility_contract` ON `peer_contract_responsibility` (`contract_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_peer_contract_responsibility_position` ON `peer_contract_responsibility` (`contract_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_peer_contract_interface_spec_contract` ON `peer_contract_interface_spec` (`contract_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_peer_contract_interface_spec_position` ON `peer_contract_interface_spec` (`contract_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_peer_contract_file_boundary_contract` ON `peer_contract_file_boundary` (`contract_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_peer_contract_file_boundary_position` ON `peer_contract_file_boundary` (`contract_id`,`position`);
--> statement-breakpoint
CREATE INDEX `idx_peer_contract_dependency_contract` ON `peer_contract_dependency` (`contract_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_peer_contract_dependency_position` ON `peer_contract_dependency` (`contract_id`,`position`);
--> statement-breakpoint
INSERT INTO `peer_contract` (`id`, `task_id`, `title`, `scope`, `test_plan`, `risks`, `status`, `created_at`, `updated_at`)
SELECT `id`, `task_id`, `title`, `scope`, `test_plan`, `risks`, `status`, `created_at`, `updated_at`
FROM `peer_contract__old`;
--> statement-breakpoint
INSERT INTO `peer_contract_participant` (`id`, `contract_id`, `position`, `participant`)
SELECT lower(hex(randomblob(16))), legacy.`id`, CAST(items.`key` AS integer), CAST(items.`value` AS text)
FROM `peer_contract__old` AS legacy,
	json_each(
		CASE
			WHEN trim(legacy.`participants`) = '' THEN '[]'
			WHEN json_valid(legacy.`participants`) = 0 THEN '[]'
			WHEN json_type(legacy.`participants`) = 'array' THEN legacy.`participants`
			ELSE '[]'
		END
	) AS items;
--> statement-breakpoint
INSERT INTO `peer_contract_responsibility` (`id`, `contract_id`, `position`, `responsibility`)
SELECT lower(hex(randomblob(16))), legacy.`id`, CAST(items.`key` AS integer), CAST(items.`value` AS text)
FROM `peer_contract__old` AS legacy,
	json_each(
		CASE
			WHEN trim(legacy.`responsibilities`) = '' THEN '[]'
			WHEN json_valid(legacy.`responsibilities`) = 0 THEN '[]'
			WHEN json_type(legacy.`responsibilities`) = 'array' THEN legacy.`responsibilities`
			ELSE '[]'
		END
	) AS items;
--> statement-breakpoint
INSERT INTO `peer_contract_interface_spec` (`id`, `contract_id`, `position`, `spec`)
SELECT lower(hex(randomblob(16))), legacy.`id`, CAST(items.`key` AS integer), CAST(items.`value` AS text)
FROM `peer_contract__old` AS legacy,
	json_each(
		CASE
			WHEN trim(legacy.`interface_spec`) = '' THEN '[]'
			WHEN json_valid(legacy.`interface_spec`) = 0 THEN '[]'
			WHEN json_type(legacy.`interface_spec`) = 'array' THEN legacy.`interface_spec`
			ELSE '[]'
		END
	) AS items;
--> statement-breakpoint
INSERT INTO `peer_contract_file_boundary` (`id`, `contract_id`, `position`, `boundary`)
SELECT lower(hex(randomblob(16))), legacy.`id`, CAST(items.`key` AS integer), CAST(items.`value` AS text)
FROM `peer_contract__old` AS legacy,
	json_each(
		CASE
			WHEN trim(legacy.`file_boundaries`) = '' THEN '[]'
			WHEN json_valid(legacy.`file_boundaries`) = 0 THEN '[]'
			WHEN json_type(legacy.`file_boundaries`) = 'array' THEN legacy.`file_boundaries`
			ELSE '[]'
		END
	) AS items;
--> statement-breakpoint
INSERT INTO `peer_contract_dependency` (`id`, `contract_id`, `position`, `dependency`)
SELECT lower(hex(randomblob(16))), legacy.`id`, CAST(items.`key` AS integer), CAST(items.`value` AS text)
FROM `peer_contract__old` AS legacy,
	json_each(
		CASE
			WHEN trim(legacy.`dependencies`) = '' THEN '[]'
			WHEN json_valid(legacy.`dependencies`) = 0 THEN '[]'
			WHEN json_type(legacy.`dependencies`) = 'array' THEN legacy.`dependencies`
			ELSE '[]'
		END
	) AS items;
--> statement-breakpoint
DROP TABLE `peer_contract__old`;
