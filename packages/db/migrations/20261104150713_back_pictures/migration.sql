CREATE TABLE `piece_back_pictures` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`source_key` text NOT NULL,
	`clean_key` text,
	`version` integer NOT NULL,
	`key_colour` text,
	`provider` text,
	`face` real,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_back_pictures_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_back_pictures_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "piece_back_pictures_state" CHECK("state" IN ('queued', 'generating', 'checking', 'ready', 'proposed', 'rejected', 'retake', 'kept-real', 'failed')),
	CONSTRAINT "piece_back_pictures_key_colour" CHECK("key_colour" IN ('green', 'magenta'))
);
--> statement-breakpoint
CREATE INDEX `piece_back_pictures_account` ON `piece_back_pictures` (`account_id`);--> statement-breakpoint
CREATE INDEX `piece_back_pictures_state_updated` ON `piece_back_pictures` (`state`,`updated_at`);