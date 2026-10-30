CREATE TABLE `piece_pictures` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`shown` text,
	`clean_key` text,
	`version` integer NOT NULL,
	`key_colour` text,
	`provider` text,
	`model` text,
	`judge` text,
	`judge_confidence` real,
	`face` real,
	`same` real,
	`faithful` real,
	`hint` text,
	`hold` text,
	`claimed_at` integer,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_pictures_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_pictures_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `piece_turns` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`hold` text,
	`provider` text,
	`model` text,
	`operation` text,
	`video_key` text,
	`sheet_key` text,
	`layout` text,
	`colour` real,
	`print` real,
	`same` real,
	`error_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_turns_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_turns_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `piece_pictures_account` ON `piece_pictures` (`account_id`);--> statement-breakpoint
CREATE INDEX `piece_turns_account` ON `piece_turns` (`account_id`);