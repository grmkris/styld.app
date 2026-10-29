CREATE TABLE `capture_frames` (
	`capture_id` text NOT NULL,
	`idx` integer NOT NULL,
	`upload_id` text NOT NULL UNIQUE,
	`object_key` text NOT NULL,
	`at_ms` integer NOT NULL,
	`sharpness` text NOT NULL,
	CONSTRAINT `capture_frames_pk` PRIMARY KEY(`capture_id`, `idx`),
	CONSTRAINT `fk_capture_frames_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`upload_id` text NOT NULL UNIQUE,
	`original_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`side` text,
	`pairs_with` text,
	`route` text,
	`route_confidence` real,
	`provider` text,
	`provider_file_id` text,
	`frame_count` integer,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`credits` integer NOT NULL,
	`settlement` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_captures_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `detections` (
	`id` text PRIMARY KEY,
	`capture_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`cutout_key` text,
	`source_key` text NOT NULL,
	`back_cutout_key` text,
	`track` text,
	`confidence` real,
	`preselected` integer NOT NULL,
	`suggested_category` text,
	`suggested_subcategory` text,
	`suggested_colours` text NOT NULL,
	`piece_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_detections_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_detections_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `pieces` ADD `detection_id` text;--> statement-breakpoint
ALTER TABLE `pieces` ADD `back_image_key` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pieces` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text,
	`notes` text,
	`category` text NOT NULL,
	`subcategory` text,
	`colours` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`upload_id` text UNIQUE,
	`detection_id` text UNIQUE,
	`back_image_key` text,
	`original_key` text NOT NULL,
	`image_key` text,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_pieces`(`id`, `account_id`, `name`, `notes`, `category`, `subcategory`, `colours`, `status`, `source`, `upload_id`, `original_key`, `image_key`, `content_type`, `bytes`, `created_at`, `updated_at`) SELECT `id`, `account_id`, `name`, `notes`, `category`, `subcategory`, `colours`, `status`, `source`, `upload_id`, `original_key`, `image_key`, `content_type`, `bytes`, `created_at`, `updated_at` FROM `pieces`;--> statement-breakpoint
DROP TABLE `pieces`;--> statement-breakpoint
ALTER TABLE `__new_pieces` RENAME TO `pieces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pieces_account_created` ON `pieces` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `captures_account_created` ON `captures` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `detections_capture` ON `detections` (`capture_id`);--> statement-breakpoint
CREATE INDEX `detections_account` ON `detections` (`account_id`);