CREATE TABLE `piece_provenance` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`origin` text NOT NULL,
	`manifest_id` text NOT NULL,
	`model` text,
	`prompt_digest` text,
	`described_type` text,
	`described_whole` real,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_provenance_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_provenance_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "piece_provenance_origin" CHECK("origin" IN ('generated', 'photo')),
	CONSTRAINT "piece_provenance_described_type" CHECK("described_type" IN ('shortSleeveTops', 'longSleeveTops', 'sleevelessTops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'sportShoes', 'outdoorShoes', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'loafers', 'laceUps', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'gloves', 'socks', 'hairAccessories', 'jewellery', 'eyewear'))
);
--> statement-breakpoint
CREATE TABLE `board_tags` (
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT `board_tags_pk` PRIMARY KEY(`board_id`, `kind`, `value`),
	CONSTRAINT `fk_board_tags_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "board_tags_kind" CHECK("kind" IN ('audience', 'season', 'template', 'occasion', 'aesthetic'))
);
--> statement-breakpoint
CREATE TABLE `board_translations` (
	`board_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`labels` text NOT NULL,
	`source_digest` text NOT NULL,
	`review` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `board_translations_pk` PRIMARY KEY(`board_id`, `locale`),
	CONSTRAINT `fk_board_translations_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "board_translations_locale" CHECK("locale" IN ('sl')),
	CONSTRAINT "board_translations_review" CHECK("review" IN ('pending', 'approved')),
	CONSTRAINT "board_translations_labels" CHECK(json_type("labels") = 'object')
);
--> statement-breakpoint
CREATE TABLE `profile_translations` (
	`account_id` text NOT NULL,
	`locale` text NOT NULL,
	`name` text NOT NULL,
	`bio` text NOT NULL,
	`source_digest` text NOT NULL,
	`review` text DEFAULT 'pending' NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `profile_translations_pk` PRIMARY KEY(`account_id`, `locale`),
	CONSTRAINT `fk_profile_translations_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "profile_translations_locale" CHECK("locale" IN ('sl')),
	CONSTRAINT "profile_translations_review" CHECK("review" IN ('pending', 'approved'))
);
--> statement-breakpoint
CREATE TABLE `viewer_preferences` (
	`account_id` text PRIMARY KEY,
	`show_me` text,
	`show_me_asked_at` integer,
	CONSTRAINT `fk_viewer_preferences_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "viewer_preferences_show_me" CHECK("show_me" IN ('women', 'men', 'all'))
);
--> statement-breakpoint
CREATE TABLE `seeded_boards` (
	`account_id` text NOT NULL,
	`seed_id` text NOT NULL,
	`board_id` text NOT NULL,
	`version` integer NOT NULL,
	`digest` text NOT NULL,
	CONSTRAINT `seeded_boards_pk` PRIMARY KEY(`account_id`, `seed_id`),
	CONSTRAINT `fk_seeded_boards_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_seeded_boards_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `piece_provenance_manifest` ON `piece_provenance` (`account_id`,`manifest_id`);--> statement-breakpoint
CREATE INDEX `board_tags_kind_value` ON `board_tags` (`kind`,`value`,`board_id`);--> statement-breakpoint
CREATE INDEX `seeded_boards_board` ON `seeded_boards` (`board_id`);