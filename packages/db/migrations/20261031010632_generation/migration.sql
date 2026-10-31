CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`held` integer NOT NULL,
	`collage_version` integer NOT NULL,
	`picks` text NOT NULL,
	`moods` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_generation_jobs_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_jobs_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `generation_pictures` (
	`job_id` text NOT NULL,
	`index` integer NOT NULL,
	`prompt` text NOT NULL,
	`references` text NOT NULL,
	`status` text NOT NULL,
	`image_id` text,
	`started_at` integer,
	CONSTRAINT `generation_pictures_pk` PRIMARY KEY(`job_id`, `index`),
	CONSTRAINT `fk_generation_pictures_job_id_generation_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_pictures_image_id_board_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `board_images`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
ALTER TABLE `board_images` ADD `origin` text DEFAULT 'upload' NOT NULL;--> statement-breakpoint
ALTER TABLE `board_images` ADD `job_id` text;--> statement-breakpoint
ALTER TABLE `board_images` ADD `model` text;--> statement-breakpoint
CREATE INDEX `generation_jobs_account` ON `generation_jobs` (`account_id`,`created_at`);