CREATE TABLE `content_checks` (
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`account_id` text NOT NULL,
	`digest` text NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`suggested_moods` text,
	`model` text,
	`attempts` integer NOT NULL,
	`hidden` text,
	`requested_at` integer NOT NULL,
	`checked_at` integer,
	CONSTRAINT `content_checks_pk` PRIMARY KEY(`target_kind`, `target_id`),
	CONSTRAINT `fk_content_checks_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`account_id` text PRIMARY KEY,
	`handle` text UNIQUE,
	`name` text NOT NULL,
	`city` text,
	`bio` text,
	`tone` text NOT NULL,
	`published` integer NOT NULL,
	`published_at` integer,
	`wardrobe_shown` integer NOT NULL,
	`house` integer DEFAULT false NOT NULL,
	`featured_at` integer,
	`search_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_profiles_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `boards` ADD `visibility` text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `moods` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `boards` ADD `featured_at` integer;--> statement-breakpoint
ALTER TABLE `boards` ADD `search_text` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `looks` ADD `shared_at` integer;--> statement-breakpoint
CREATE INDEX `boards_public` ON `boards` (`visibility`,`published_at`);--> statement-breakpoint
CREATE INDEX `content_checks_state` ON `content_checks` (`state`,`requested_at`);--> statement-breakpoint
CREATE INDEX `content_checks_account` ON `content_checks` (`account_id`);--> statement-breakpoint
CREATE INDEX `profiles_published` ON `profiles` (`published`,`featured_at`);