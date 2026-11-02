CREATE TABLE `paid_attempts` (
	`work` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`hold_id` text,
	`claimed_at` integer,
	`result` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_paid_attempts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pending_settlements` (
	`hold_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`ending` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pending_settlements_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "pending_settlements_ending" CHECK("ending" IN ('succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `imported_pieces` (
	`account_id` text NOT NULL,
	`v1_id` text NOT NULL,
	`piece_id` text NOT NULL,
	CONSTRAINT `imported_pieces_pk` PRIMARY KEY(`account_id`, `v1_id`),
	CONSTRAINT `fk_imported_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_imported_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- operation_receipts is rebuilt so a receipt may be pending (no result yet). Nothing refers to it and its rows keep
-- their accounts, so foreign keys stay on (D1 cannot turn them off).
CREATE TABLE `__new_operation_receipts` (
	`account_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`command` text NOT NULL,
	`input_digest` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `operation_receipts_pk` PRIMARY KEY(`account_id`, `operation_id`),
	CONSTRAINT `fk_operation_receipts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_operation_receipts`(`account_id`, `operation_id`, `command`, `input_digest`, `result`, `created_at`) SELECT `account_id`, `operation_id`, `command`, `input_digest`, `result`, `created_at` FROM `operation_receipts`;--> statement-breakpoint
DROP TABLE `operation_receipts`;--> statement-breakpoint
ALTER TABLE `__new_operation_receipts` RENAME TO `operation_receipts`;--> statement-breakpoint
CREATE INDEX `operation_receipts_created` ON `operation_receipts` (`created_at`);--> statement-breakpoint
CREATE INDEX `paid_attempts_updated` ON `paid_attempts` (`updated_at`);--> statement-breakpoint
CREATE INDEX `pending_settlements_updated` ON `pending_settlements` (`updated_at`);--> statement-breakpoint
CREATE INDEX `imported_pieces_piece` ON `imported_pieces` (`piece_id`);