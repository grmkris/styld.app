CREATE TABLE `stylist_turns` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_stylist_turns_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `stylist_turns_created` ON `stylist_turns` (`created_at`);