CREATE TABLE `look_pieces` (
	`look_id` text NOT NULL,
	`piece_id` text NOT NULL,
	`position` integer NOT NULL,
	CONSTRAINT `look_pieces_pk` PRIMARY KEY(`look_id`, `piece_id`),
	CONSTRAINT `fk_look_pieces_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_look_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `looks` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`occasion` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_looks_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `look_pieces_piece` ON `look_pieces` (`piece_id`);--> statement-breakpoint
CREATE INDEX `looks_account_created` ON `looks` (`account_id`,`created_at`);