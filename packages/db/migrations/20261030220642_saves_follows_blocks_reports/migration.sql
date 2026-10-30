CREATE TABLE `blocks` (
	`blocker_id` text NOT NULL,
	`blocked_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `blocks_pk` PRIMARY KEY(`blocker_id`, `blocked_id`),
	CONSTRAINT `fk_blocks_blocker_id_accounts_id_fk` FOREIGN KEY (`blocker_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_blocks_blocked_id_accounts_id_fk` FOREIGN KEY (`blocked_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`followee_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `follows_pk` PRIMARY KEY(`follower_id`, `followee_id`),
	CONSTRAINT `fk_follows_follower_id_accounts_id_fk` FOREIGN KEY (`follower_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_follows_followee_id_accounts_id_fk` FOREIGN KEY (`followee_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY,
	`reporter_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_reports_reporter_id_accounts_id_fk` FOREIGN KEY (`reporter_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_reports_owner_id_accounts_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `saves` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`piece_id` text,
	`look_id` text,
	`board_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_saves_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_saves_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_saves_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_saves_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `blocks_blocked` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE INDEX `follows_followee` ON `follows` (`followee_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reporter_target` ON `reports` (`reporter_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `reports_target` ON `reports` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_created` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_piece` ON `saves` (`account_id`,`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_look` ON `saves` (`account_id`,`look_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_board` ON `saves` (`account_id`,`board_id`);--> statement-breakpoint
CREATE INDEX `saves_account_created` ON `saves` (`account_id`,`created_at`);