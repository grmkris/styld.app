CREATE TABLE `account_deletions` (
	`account_id` text PRIMARY KEY,
	`requested_at` integer NOT NULL,
	`purged_at` integer
);
--> statement-breakpoint
CREATE TABLE `provider_files` (
	`file_id` text PRIMARY KEY,
	`provider` text NOT NULL,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "provider_files_provider" CHECK("provider" IN ('meta-sam'))
);
--> statement-breakpoint
CREATE INDEX `account_deletions_requested` ON `account_deletions` (`requested_at`);--> statement-breakpoint
CREATE INDEX `provider_files_created` ON `provider_files` (`created_at`);--> statement-breakpoint
CREATE INDEX `provider_files_account` ON `provider_files` (`account_id`);