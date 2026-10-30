CREATE TABLE `board_pins` (
	`id` text PRIMARY KEY,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`piece_id` text,
	`image_id` text,
	`look_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_board_pins_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_pins_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_pins_image_id_board_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `board_images`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_pins_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `board_pins_board` ON `board_pins` (`board_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_board_piece` ON `board_pins` (`board_id`,`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_board_look` ON `board_pins` (`board_id`,`look_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_image` ON `board_pins` (`image_id`);--> statement-breakpoint
CREATE INDEX `board_pins_piece` ON `board_pins` (`piece_id`);--> statement-breakpoint
CREATE INDEX `board_pins_look` ON `board_pins` (`look_id`);--> statement-breakpoint
INSERT INTO `board_pins` (`id`, `board_id`, `kind`, `piece_id`, `image_id`, `look_id`, `created_at`)
SELECT 'pn_' || substr(min(i.`id`), 4), i.`board_id`, 'piece', i.`piece_id`, NULL, NULL, b.`created_at` + min(i.`z`)
FROM `board_items` i JOIN `boards` b ON b.`id` = i.`board_id`
WHERE i.`kind` = 'piece' AND i.`piece_id` IS NOT NULL
GROUP BY i.`board_id`, i.`piece_id`;--> statement-breakpoint
INSERT INTO `board_pins` (`id`, `board_id`, `kind`, `piece_id`, `image_id`, `look_id`, `created_at`)
SELECT 'pn_' || substr(m.`id`, 4), m.`board_id`, 'picture', NULL, m.`id`, NULL, m.`created_at`
FROM `board_images` m;
