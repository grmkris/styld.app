-- The receipts table is rebuilt so a receipt may be pending (no result yet). Nothing refers to it, and its rows keep
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
CREATE INDEX `operation_receipts_created` ON `operation_receipts` (`created_at`);