CREATE TABLE `try_on_pieces` (
	`try_on_id` text NOT NULL,
	`position` integer NOT NULL,
	`piece_id` text NOT NULL,
	CONSTRAINT `try_on_pieces_pk` PRIMARY KEY(`try_on_id`, `position`),
	CONSTRAINT `fk_try_on_pieces_try_on_id_try_ons_id_fk` FOREIGN KEY (`try_on_id`) REFERENCES `try_ons`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_try_on_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `try_ons` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`photo_id` text NOT NULL,
	`status` text NOT NULL,
	`started_at` integer,
	`result_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_try_ons_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_try_ons_photo_id_outfit_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `outfit_photos`(`id`) ON DELETE CASCADE,
	CONSTRAINT "try_ons_status" CHECK("status" IN ('admitting', 'drawing', 'done', 'refused', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `try_on_pieces_piece` ON `try_on_pieces` (`piece_id`);--> statement-breakpoint
CREATE INDEX `try_ons_account_created` ON `try_ons` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `try_ons_photo` ON `try_ons` (`photo_id`);--> statement-breakpoint
CREATE INDEX `try_ons_status_updated` ON `try_ons` (`status`,`updated_at`);