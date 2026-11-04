CREATE TABLE `board_outfit_pieces` (
	`outfit_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `board_outfit_pieces_pk` PRIMARY KEY(`outfit_id`, `piece_id`),
	CONSTRAINT `fk_board_outfit_pieces_outfit_id_board_outfits_id_fk` FOREIGN KEY (`outfit_id`) REFERENCES `board_outfits`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_outfit_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `board_outfits` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`position` integer NOT NULL,
	`mode` text NOT NULL,
	`session` text NOT NULL,
	`season` text,
	`look_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_board_outfits_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_outfits_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_outfits_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE SET NULL,
	CONSTRAINT "board_outfits_mode" CHECK("mode" IN ('fast', 'thinking')),
	CONSTRAINT "board_outfits_season" CHECK("season" IN ('spring', 'summer', 'autumn', 'winter'))
);
--> statement-breakpoint
ALTER TABLE `board_items` ADD `outfit_id` text REFERENCES board_outfits(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `boards` ADD `template` text;--> statement-breakpoint
ALTER TABLE `boards` ADD `anchor_piece_id` text REFERENCES pieces(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `board_outfit_pieces_piece` ON `board_outfit_pieces` (`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_outfits_board_position` ON `board_outfits` (`board_id`,`position`);--> statement-breakpoint
CREATE INDEX `board_outfits_look` ON `board_outfits` (`look_id`);