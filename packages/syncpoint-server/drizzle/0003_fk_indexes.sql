-- FK index migration: add missing indexes on foreign key columns
-- See HARDENING_TASKLIST.md task 1.1–1.7

CREATE INDEX IF NOT EXISTS `idx_rcr_claim` ON `resource_claim_resource` (`claim_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sgr_gate` ON `sync_gate_resource` (`gate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sgrc_gate` ON `sync_gate_related_claim` (`gate_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_opr_op` ON `operation_resource` (`operation_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_wpr_permit` ON `write_permit_resource` (`permit_id`);
