CREATE TABLE `operation_receipts` (
	`account_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`command` text NOT NULL,
	`input_digest` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `operation_receipts_pk` PRIMARY KEY(`account_id`, `operation_id`),
	CONSTRAINT `fk_operation_receipts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pieces` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text,
	`notes` text,
	`category` text NOT NULL,
	`subcategory` text,
	`colours` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`upload_id` text NOT NULL UNIQUE,
	`original_key` text NOT NULL,
	`image_key` text,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_uploads_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `pieces_account_created` ON `pieces` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `uploads_account` ON `uploads` (`account_id`);--> statement-breakpoint
CREATE INDEX `uploads_expiry` ON `uploads` (`expires_at`);