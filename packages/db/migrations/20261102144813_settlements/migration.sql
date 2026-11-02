CREATE TABLE `pending_settlements` (
	`hold_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`ending` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pending_settlements_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "pending_settlements_ending" CHECK("ending" IN ('succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX `pending_settlements_updated` ON `pending_settlements` (`updated_at`);