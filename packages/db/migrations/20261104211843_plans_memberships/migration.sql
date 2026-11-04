CREATE TABLE `memberships` (
	`account_id` text PRIMARY KEY,
	`plan` text NOT NULL,
	`until` integer,
	`status` text NOT NULL,
	`subscription_id` text,
	`customer_id` text,
	`subscription_event_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_memberships_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "memberships_plan" CHECK("plan" IN ('week', 'monthly', 'yearly', 'lifetime')),
	CONSTRAINT "memberships_status" CHECK("status" IN ('active', 'cancelled', 'ended'))
);
--> statement-breakpoint
ALTER TABLE `purchases` ADD `plan` text DEFAULT 'week' NOT NULL;--> statement-breakpoint
CREATE INDEX `memberships_subscription` ON `memberships` (`subscription_id`);--> statement-breakpoint
-- A Premium Week bought before plans (4 November 2026) is a week membership until the same end.
INSERT INTO `memberships` (`account_id`, `plan`, `until`, `status`, `updated_at`) SELECT `account_id`, 'week', `until`, 'active', cast(strftime('%s', 'now') as integer) * 1000 FROM `premium`;--> statement-breakpoint
DROP TABLE `premium`;--> statement-breakpoint
ALTER TABLE `purchases` DROP COLUMN `premium_until_after`;