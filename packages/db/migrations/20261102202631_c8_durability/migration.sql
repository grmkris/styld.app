CREATE TABLE `import_copies` (
	`object_key` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text DEFAULT 'copying' NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "import_copies_state" CHECK("state" IN ('copying', 'discarding'))
);
--> statement-breakpoint
CREATE TABLE `__new_pending_settlements` (
	`hold_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`ending` text,
	`updated_at` integer NOT NULL,
	CONSTRAINT "pending_settlements_ending" CHECK("ending" IN ('succeeded', 'failed', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_pending_settlements`(`hold_id`, `account_id`, `ending`, `updated_at`) SELECT `hold_id`, `account_id`, `ending`, `updated_at` FROM `pending_settlements`;--> statement-breakpoint
DROP TABLE `pending_settlements`;--> statement-breakpoint
ALTER TABLE `__new_pending_settlements` RENAME TO `pending_settlements`;--> statement-breakpoint
CREATE TABLE `__new_generation_jobs` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`collage_version` integer NOT NULL,
	`moods` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_generation_jobs_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_jobs_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "generation_jobs_kind" CHECK("kind" IN ('sticker', 'moodBoard')),
	CONSTRAINT "generation_jobs_status" CHECK("status" IN ('admitting', 'planning', 'drawing', 'arranging', 'done', 'refused', 'failed')),
	CONSTRAINT "generation_jobs_reason" CHECK("reason" IN ('unclear', 'refused', 'unavailable')),
	CONSTRAINT "generation_jobs_moods" CHECK(json_type("moods") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_generation_jobs`(`id`, `account_id`, `board_id`, `kind`, `prompt`, `status`, `reason`, `collage_version`, `moods`, `created_at`, `updated_at`) SELECT `id`, `account_id`, `board_id`, `kind`, `prompt`, `status`, `reason`, `collage_version`, `moods`, `created_at`, `updated_at` FROM `generation_jobs`;--> statement-breakpoint
-- D1 keeps foreign keys enabled even inside a migration. Preserve children before the parent drop cascades.
CREATE TABLE `__c8_generation_picks` AS SELECT `job_id`, `position`, `piece_id` FROM `generation_picks`;--> statement-breakpoint
CREATE TABLE `__c8_generation_pictures` AS SELECT `job_id`, `prompt`, `status`, `image_id`, `started_at` FROM `generation_pictures`;--> statement-breakpoint
DROP TABLE `generation_jobs`;--> statement-breakpoint
ALTER TABLE `__new_generation_jobs` RENAME TO `generation_jobs`;--> statement-breakpoint
INSERT INTO `generation_picks` (`job_id`, `position`, `piece_id`) SELECT `job_id`, `position`, `piece_id` FROM `__c8_generation_picks`;--> statement-breakpoint
INSERT INTO `generation_pictures` (`job_id`, `prompt`, `status`, `image_id`, `started_at`) SELECT `job_id`, `prompt`, `status`, `image_id`, `started_at` FROM `__c8_generation_pictures`;--> statement-breakpoint
DROP TABLE `__c8_generation_picks`;--> statement-breakpoint
DROP TABLE `__c8_generation_pictures`;--> statement-breakpoint
CREATE INDEX `pending_settlements_updated` ON `pending_settlements` (`updated_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_account` ON `generation_jobs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_board` ON `generation_jobs` (`board_id`);--> statement-breakpoint
CREATE INDEX `generation_jobs_status_updated` ON `generation_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `import_copies_created` ON `import_copies` (`created_at`);