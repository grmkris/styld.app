CREATE TABLE `board_images` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_board_images_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_images_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `board_items` (
	`board_id` text NOT NULL,
	`id` text NOT NULL,
	`kind` text NOT NULL,
	`piece_id` text,
	`image_id` text,
	`text` text,
	`text_style` text,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`size` real NOT NULL,
	`turn` real NOT NULL,
	`z` integer NOT NULL,
	`flipped` integer NOT NULL,
	CONSTRAINT `board_items_pk` PRIMARY KEY(`board_id`, `id`),
	CONSTRAINT `fk_board_items_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_items_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_items_image_id_board_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `board_images`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`paper` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_boards_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `worn_pieces` (
	`account_id` text NOT NULL,
	`day` text NOT NULL,
	`piece_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `worn_pieces_pk` PRIMARY KEY(`account_id`, `day`, `piece_id`),
	CONSTRAINT `fk_worn_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_worn_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `board_images_board` ON `board_images` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_items_piece` ON `board_items` (`piece_id`);--> statement-breakpoint
CREATE INDEX `board_items_image` ON `board_items` (`image_id`);--> statement-breakpoint
CREATE INDEX `boards_account_updated` ON `boards` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `worn_pieces_piece` ON `worn_pieces` (`piece_id`);