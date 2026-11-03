CREATE TABLE `stylist_chats` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_stylist_chats_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
DROP INDEX IF EXISTS `stylist_turns_created`;--> statement-breakpoint
CREATE INDEX `stylist_chats_account_updated` ON `stylist_chats` (`account_id`,`updated_at`);--> statement-breakpoint
DROP TABLE `stylist_turns`;