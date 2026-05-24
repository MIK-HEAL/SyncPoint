CREATE TABLE `agent_manifest` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`capabilities_json` text DEFAULT '[]' NOT NULL,
	`escalation_preference_json` text DEFAULT '{}' NOT NULL,
	`availability` text DEFAULT 'online' NOT NULL,
	`can_handle_human_escalation` integer DEFAULT false NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'IDLE' NOT NULL,
	`current_task_id` text,
	`runtime_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `approval_record` (
	`id` text PRIMARY KEY NOT NULL,
	`review_request_id` text NOT NULL,
	`decision` text NOT NULL,
	`summary` text NOT NULL,
	`requested_changes` text DEFAULT '' NOT NULL,
	`waiver_reason` text DEFAULT '' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_request_id`) REFERENCES `review_request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `change_request` (
	`id` text PRIMARY KEY NOT NULL,
	`review_request_id` text NOT NULL,
	`summary` text NOT NULL,
	`items` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`evidence_id` text,
	`requested_by` text DEFAULT '' NOT NULL,
	`addressed_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_request_id`) REFERENCES `review_request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `checkpoint_review_approver` (
	`id` text PRIMARY KEY NOT NULL,
	`review_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`role` text DEFAULT 'required' NOT NULL,
	`decided_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`review_id`) REFERENCES `checkpoint_review`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_review_approver` ON `checkpoint_review_approver` (`review_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `checkpoint_review` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`requesting_agent_id` text NOT NULL,
	`gate_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`decision_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `checkpoint` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`summary` text NOT NULL,
	`progress` text DEFAULT '' NOT NULL,
	`current_understanding` text DEFAULT '' NOT NULL,
	`changed_files` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`blockers` text DEFAULT '' NOT NULL,
	`next_steps` text DEFAULT '' NOT NULL,
	`need_sync` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `context_snapshot_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`locator` text NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `context_snapshot`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `context_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`kind` text DEFAULT 'checkpoint' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoint`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `diary_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`entry_type` text DEFAULT 'NOTE' NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`paths` text NOT NULL,
	`mode` text DEFAULT 'exclusive' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `handoff` (
	`id` text PRIMARY KEY NOT NULL,
	`from_agent_id` text NOT NULL,
	`to_agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`context_summary` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`from_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `negotiation_message` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`round` integer DEFAULT 0 NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `negotiation_participant` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `negotiation_session`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_neg_participant` ON `negotiation_participant` (`session_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `negotiation_session` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`current_round` integer DEFAULT 0 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`round_started_at` text,
	`deadline_at` text,
	`resolved_by_agent_id` text,
	`resolution_summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operation_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`locator` text NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `operation`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `operation` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`actor_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`payload_ref` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`check_result` text DEFAULT '' NOT NULL,
	`decision_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `orchestration_session` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PLANNING' NOT NULL,
	`relationship_mode` text DEFAULT 'manager-delegate' NOT NULL,
	`architect_id` text,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `peer_contract` (
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
CREATE TABLE `pinned_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	`task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pinned_memory_key_unique` ON `pinned_memory` (`key`);--> statement-breakpoint
CREATE TABLE `project_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_type` text DEFAULT 'human' NOT NULL,
	`source_ref` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`confidence` text DEFAULT 'medium' NOT NULL,
	`task_id` text,
	`kind` text DEFAULT 'fact' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_project_memory_status` ON `project_memory` (`status`);--> statement-breakpoint
CREATE INDEX `idx_project_memory_category` ON `project_memory` (`category`);--> statement-breakpoint
CREATE INDEX `idx_project_memory_scope` ON `project_memory` (`scope`);--> statement-breakpoint
CREATE INDEX `idx_project_memory_task` ON `project_memory` (`task_id`);--> statement-breakpoint
CREATE TABLE `project_memory_projection` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`projection_target` text,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `project_memory_scope` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`field` text NOT NULL,
	`pattern` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_memory_scope` ON `project_memory_scope` (`memory_id`,`field`,`pattern`);--> statement-breakpoint
CREATE INDEX `idx_project_memory_scope_field` ON `project_memory_scope` (`field`);--> statement-breakpoint
CREATE TABLE `project_memory_tag` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`tag` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_memory_tag` ON `project_memory_tag` (`memory_id`,`tag`);--> statement-breakpoint
CREATE TABLE `project_memory_validation_action` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`action` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_project_memory_validation_action` ON `project_memory_validation_action` (`memory_id`,`action`);--> statement-breakpoint
CREATE TABLE `project_memory_validation` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`severity` text DEFAULT 'info' NOT NULL,
	`validity_status` text DEFAULT 'fresh' NOT NULL,
	`stale_reason` text DEFAULT '' NOT NULL,
	`validator_type` text DEFAULT '' NOT NULL,
	`validator_message` text DEFAULT '' NOT NULL,
	`validator_payload` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_project_memory_validation_type` ON `project_memory_validation` (`validator_type`);--> statement-breakpoint
CREATE TABLE `project_memory_version` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text DEFAULT '' NOT NULL,
	`supersedes_memory_id` text,
	`superseded_by_memory_id` text,
	FOREIGN KEY (`memory_id`) REFERENCES `project_memory`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_project_memory_version_fingerprint` ON `project_memory_version` (`fingerprint`);--> statement-breakpoint
CREATE TABLE `resource_claim_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`claim_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`locator` text NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `resource_claim`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `resource_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`resource_type` text NOT NULL,
	`mode` text DEFAULT 'exclusive' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text NOT NULL,
	`released_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `review_checklist_item` (
	`id` text PRIMARY KEY NOT NULL,
	`review_request_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`review_request_id`) REFERENCES `review_request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_decision` (
	`id` text PRIMARY KEY NOT NULL,
	`review_request_id` text NOT NULL,
	`verdict` text NOT NULL,
	`summary` text NOT NULL,
	`requested_changes` text DEFAULT '' NOT NULL,
	`decided_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_request_id`) REFERENCES `review_request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`review_request_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`metadata_json` text DEFAULT '' NOT NULL,
	`created_by` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`review_request_id`) REFERENCES `review_request`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `review_request` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`reviewer_agent_id` text NOT NULL,
	`requested_by` text DEFAULT '' NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `orchestration_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `role_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`role` text NOT NULL,
	`capabilities` text DEFAULT '' NOT NULL,
	`assigned_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `orchestration_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runtime` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'local-mcp' NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`host` text DEFAULT '' NOT NULL,
	`workspace_root` text DEFAULT '' NOT NULL,
	`agent_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`last_seen_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_gate_ack` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`gate_id`) REFERENCES `sync_gate`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gate_ack_agent` ON `sync_gate_ack` (`gate_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `sync_gate_related_claim` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`claim_id` text NOT NULL,
	FOREIGN KEY (`gate_id`) REFERENCES `sync_gate`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_gate_required_agent` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`agent_id` text NOT NULL,
	FOREIGN KEY (`gate_id`) REFERENCES `sync_gate`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gate_req_agent` ON `sync_gate_required_agent` (`gate_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `sync_gate_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`locator` text NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`gate_id`) REFERENCES `sync_gate`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_gate_vote` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`vote` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`gate_id`) REFERENCES `sync_gate`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gate_vote_agent` ON `sync_gate_vote` (`gate_id`,`agent_id`);--> statement-breakpoint
CREATE TABLE `sync_gate` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`task_id` text NOT NULL,
	`requested_by_agent_id` text NOT NULL,
	`reason` text DEFAULT 'manual_request' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`related_checkpoint_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'NEEDS_SYNC' NOT NULL,
	`decision_summary` text DEFAULT '' NOT NULL,
	`policy_json` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_assignment` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`assignee_agent_id` text NOT NULL,
	`assigned_by` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `orchestration_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`owner_agent_id` text,
	`parent_task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wake_request` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`target_agent_id` text NOT NULL,
	`target_role` text NOT NULL,
	`action` text NOT NULL,
	`reason` text NOT NULL,
	`trigger_event_type` text NOT NULL,
	`trigger_entity_id` text NOT NULL,
	`task_id` text,
	`review_request_id` text,
	`prompt_hint` text DEFAULT '' NOT NULL,
	`mcp_tool_hint` text DEFAULT '' NOT NULL,
	`cli_hint` text DEFAULT '' NOT NULL,
	`runner_mode` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`result_summary` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `orchestration_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_agent_id`) REFERENCES `agent`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `write_permit_resource` (
	`id` text PRIMARY KEY NOT NULL,
	`permit_id` text NOT NULL,
	`resource_type` text NOT NULL,
	`locator` text NOT NULL,
	`base_hash` text DEFAULT '' NOT NULL,
	`metadata` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`permit_id`) REFERENCES `write_permit`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `write_permit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`task_id` text NOT NULL,
	`session_id` text DEFAULT '' NOT NULL,
	`intent` text NOT NULL,
	`operation_id` text DEFAULT '' NOT NULL,
	`guarded_root` text DEFAULT '' NOT NULL,
	`expires_at` text NOT NULL,
	`single_use` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`decision_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`consumed_at` text DEFAULT '' NOT NULL
);
