CREATE TABLE `wishes` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`source_piece_id` text,
	`name` text,
	`category` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_wishes_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_wishes_source_piece_id_pieces_id_fk` FOREIGN KEY (`source_piece_id`) REFERENCES `pieces`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wishes_account_piece` ON `wishes` (`account_id`,`source_piece_id`);--> statement-breakpoint
CREATE INDEX `wishes_account_created` ON `wishes` (`account_id`,`created_at`);