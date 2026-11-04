CREATE TABLE `style_notes` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_style_notes_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `taste_answers` (
	`account_id` text PRIMARY KEY,
	`occasions` text NOT NULL,
	`first_run_at` integer,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_taste_answers_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "taste_answers_occasions" CHECK(json_type("occasions") = 'array')
);
--> statement-breakpoint
CREATE INDEX `style_notes_account_created` ON `style_notes` (`account_id`,`created_at`);