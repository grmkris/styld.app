CREATE TABLE `media_deletions` (
	`prefix` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`owner` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_media_deletions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "media_deletions_owner" CHECK("owner" IN ('piece', 'photo'))
);
--> statement-breakpoint
CREATE INDEX `media_deletions_created` ON `media_deletions` (`created_at`);