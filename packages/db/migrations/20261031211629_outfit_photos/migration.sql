CREATE TABLE `outfit_photos` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`original_key` text NOT NULL,
	`content_type` text NOT NULL,
	`status` text NOT NULL,
	`favourite` integer DEFAULT false NOT NULL,
	`look_id` text,
	`cutout_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_outfit_photos_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_outfit_photos_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `photo_garments` (
	`id` text PRIMARY KEY,
	`photo_id` text NOT NULL,
	`account_id` text NOT NULL,
	`position` integer NOT NULL,
	`cutout_key` text NOT NULL,
	`type` text,
	`colours` text NOT NULL,
	`piece_id` text,
	`state` text NOT NULL,
	`capture_id` text,
	CONSTRAINT `fk_photo_garments_photo_id_outfit_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `outfit_photos`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_photo_garments_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outfit_photos_upload` ON `outfit_photos` (`upload_id`);--> statement-breakpoint
CREATE INDEX `outfit_photos_account_created` ON `outfit_photos` (`account_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_garments_position` ON `photo_garments` (`photo_id`,`position`);--> statement-breakpoint
CREATE INDEX `photo_garments_piece` ON `photo_garments` (`piece_id`);