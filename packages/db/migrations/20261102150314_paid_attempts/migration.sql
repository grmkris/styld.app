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
CREATE INDEX `paid_attempts_updated` ON `paid_attempts` (`updated_at`);