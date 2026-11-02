CREATE TABLE `imported_pieces` (
	`account_id` text NOT NULL,
	`v1_id` text NOT NULL,
	`piece_id` text NOT NULL,
	CONSTRAINT `imported_pieces_pk` PRIMARY KEY(`account_id`, `v1_id`),
	CONSTRAINT `fk_imported_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_imported_pieces_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `imported_pieces_piece` ON `imported_pieces` (`piece_id`);