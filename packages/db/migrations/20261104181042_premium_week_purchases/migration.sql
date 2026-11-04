CREATE TABLE `premium` (
	`account_id` text PRIMARY KEY,
	`until` integer NOT NULL,
	CONSTRAINT `fk_premium_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `purchases` (
	`payment_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`product_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text NOT NULL,
	`premium_until_after` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_purchases_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "purchases_status" CHECK("status" IN ('succeeded', 'refunded', 'disputed'))
);
--> statement-breakpoint
CREATE INDEX `purchases_account` ON `purchases` (`account_id`);