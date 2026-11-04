-- Tops by sleeve (Eva's review, 4 November: "I'd split tops and T-shirts into short, long and sleeveless"): the type
-- `tops` becomes shortSleeveTops, longSleeveTops and sleevelessTops in the type CHECKs of pieces, detections and
-- photo_garments. Every stored `tops` becomes shortSleeveTops, the type its old name led with ("Tops & T-shirts");
-- tools/retype-tops.ts then asks Clef each one's sleeves and moves the long-sleeved and sleeveless ones. The same
-- rebuild lets a photo garment's cutout_key be null, for a garment added to a photo by hand, which has no cut-out yet.
-- T-12's rebuild, with its fix (0eedb270): SQLite changes a CHECK only by rebuilding the table, and on D1 a dropped
-- table deletes every row that cascades from it (MigrationSafety.test.ts), so every row the drops touch is kept aside
-- first and put back: the rebuilt tables, then the links the drops set to null (a capture's gallery garment, a piece's
-- detection, a board's anchor piece), then the rows they deleted. Dropping pieces deletes only the rows that name a
-- piece (every kept dependent cascades on piece_id), so only those are put back: a board's label or picture stays
-- where it was. No PRAGMA: D1 enforces foreign keys throughout, and each statement leaves every link valid.
CREATE TABLE `__keep_pieces` AS SELECT * FROM `pieces`;--> statement-breakpoint
CREATE TABLE `__keep_detections` AS SELECT * FROM `detections`;--> statement-breakpoint
CREATE TABLE `__keep_photo_garments` AS SELECT * FROM `photo_garments`;--> statement-breakpoint
CREATE TABLE `__keep_piece_pictures` AS SELECT * FROM `piece_pictures`;--> statement-breakpoint
CREATE TABLE `__keep_piece_turns` AS SELECT * FROM `piece_turns`;--> statement-breakpoint
CREATE TABLE `__keep_look_pieces` AS SELECT * FROM `look_pieces`;--> statement-breakpoint
CREATE TABLE `__keep_board_items` AS SELECT * FROM `board_items`;--> statement-breakpoint
CREATE TABLE `__keep_board_pins` AS SELECT * FROM `board_pins`;--> statement-breakpoint
CREATE TABLE `__keep_board_outfit_pieces` AS SELECT * FROM `board_outfit_pieces`;--> statement-breakpoint
CREATE TABLE `__keep_saves` AS SELECT * FROM `saves`;--> statement-breakpoint
CREATE TABLE `__keep_worn_pieces` AS SELECT * FROM `worn_pieces`;--> statement-breakpoint
CREATE TABLE `__keep_generation_picks` AS SELECT * FROM `generation_picks`;--> statement-breakpoint
CREATE TABLE `__keep_imported_pieces` AS SELECT * FROM `imported_pieces`;--> statement-breakpoint
CREATE TABLE `__keep_captures` AS SELECT `id`, `garment_id` FROM `captures` WHERE `garment_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__keep_boards` AS SELECT `id`, `anchor_piece_id` FROM `boards` WHERE `anchor_piece_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `photo_garments`;--> statement-breakpoint
DROP TABLE `detections`;--> statement-breakpoint
DROP TABLE `pieces`;--> statement-breakpoint
CREATE TABLE `pieces` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text,
	`notes` text,
	`type` text NOT NULL,
	`colours` text NOT NULL,
	`seasons` text DEFAULT '[]' NOT NULL,
	`rainproof` integer DEFAULT false NOT NULL,
	`category` text,
	`occasions` text NOT NULL,
	`pattern` text,
	`brand` text,
	`shop_url` text,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`upload_id` text UNIQUE,
	`detection_id` text UNIQUE,
	`back_image_key` text,
	`rotation` integer DEFAULT 0 NOT NULL,
	`original_key` text NOT NULL,
	`image_key` text,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_pieces_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_pieces_upload_id_uploads_id_fk` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_pieces_detection_id_detections_id_fk` FOREIGN KEY (`detection_id`) REFERENCES `detections`(`id`) ON DELETE SET NULL,
	CONSTRAINT "pieces_type" CHECK("type" IN ('shortSleeveTops', 'longSleeveTops', 'sleevelessTops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'sportShoes', 'outdoorShoes', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'loafers', 'laceUps', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'gloves', 'socks', 'hairAccessories', 'jewellery', 'eyewear')),
	CONSTRAINT "pieces_seasons" CHECK(json_type("seasons") = 'array'),
	CONSTRAINT "pieces_pattern" CHECK("pattern" IN ('plain', 'striped', 'checked', 'printed')),
	CONSTRAINT "pieces_status" CHECK("status" IN ('processing', 'ready', 'failed')),
	CONSTRAINT "pieces_source" CHECK("source" IN ('website', 'assistant', 'import')),
	CONSTRAINT "pieces_rotation" CHECK("rotation" IN (0, 90, 180, 270)),
	CONSTRAINT "pieces_colours" CHECK(json_type("colours") = 'array'),
	CONSTRAINT "pieces_occasions" CHECK(json_type("occasions") = 'array')
);--> statement-breakpoint
CREATE TABLE `detections` (
	`id` text PRIMARY KEY,
	`capture_id` text NOT NULL,
	`account_id` text NOT NULL,
	`status` text NOT NULL,
	`cutout_key` text,
	`source_key` text NOT NULL,
	`back_cutout_key` text,
	`confidence` real,
	`preselected` integer NOT NULL,
	`suggested_type` text,
	`suggested_colours` text NOT NULL,
	`suggested_seasons` text DEFAULT '[]' NOT NULL,
	`suggested_rainproof` integer DEFAULT false NOT NULL,
	`suggested_category` text,
	`suggested_occasions` text NOT NULL,
	`suggested_pattern` text,
	`whole` real,
	`group_of` text,
	`duplicate_of` text,
	`matching` text,
	`match_claimed_at` integer,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_detections_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_detections_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_detections_group_of_detections_id_fk` FOREIGN KEY (`group_of`) REFERENCES `detections`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_detections_duplicate_of_pieces_id_fk` FOREIGN KEY (`duplicate_of`) REFERENCES `pieces`(`id`) ON DELETE SET NULL,
	CONSTRAINT "detections_status" CHECK("status" IN ('review', 'kept', 'discarded')),
	CONSTRAINT "detections_suggested_type" CHECK("suggested_type" IN ('shortSleeveTops', 'longSleeveTops', 'sleevelessTops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'sportShoes', 'outdoorShoes', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'loafers', 'laceUps', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'gloves', 'socks', 'hairAccessories', 'jewellery', 'eyewear')),
	CONSTRAINT "detections_suggested_seasons" CHECK(json_type("suggested_seasons") = 'array'),
	CONSTRAINT "detections_suggested_pattern" CHECK("suggested_pattern" IN ('plain', 'striped', 'checked', 'printed')),
	CONSTRAINT "detections_matching" CHECK("matching" IN ('waiting', 'claimed', 'done')),
	CONSTRAINT "detections_suggested_colours" CHECK(json_type("suggested_colours") = 'array'),
	CONSTRAINT "detections_suggested_occasions" CHECK(json_type("suggested_occasions") = 'array')
);--> statement-breakpoint
CREATE TABLE `photo_garments` (
	`id` text PRIMARY KEY,
	`photo_id` text NOT NULL,
	`account_id` text NOT NULL,
	`position` integer NOT NULL,
	`cutout_key` text,
	`type` text,
	`colours` text NOT NULL,
	`piece_id` text,
	`state` text NOT NULL,
	CONSTRAINT `fk_photo_garments_photo_id_outfit_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `outfit_photos`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE SET NULL,
	CONSTRAINT "photo_garments_type" CHECK("type" IN ('shortSleeveTops', 'longSleeveTops', 'sleevelessTops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'sportShoes', 'outdoorShoes', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'loafers', 'laceUps', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'gloves', 'socks', 'hairAccessories', 'jewellery', 'eyewear')),
	CONSTRAINT "photo_garments_state" CHECK("state" IN ('suggested', 'confirmed', 'unmatched', 'offered')),
	CONSTRAINT "photo_garments_colours" CHECK(json_type("colours") = 'array')
);--> statement-breakpoint
INSERT INTO `pieces` (`id`, `account_id`, `name`, `notes`, `type`, `colours`, `seasons`, `rainproof`, `category`, `occasions`, `pattern`, `brand`, `shop_url`, `status`, `source`, `upload_id`, `detection_id`, `back_image_key`, `rotation`, `original_key`, `image_key`, `content_type`, `created_at`, `updated_at`) SELECT `id`, `account_id`, `name`, `notes`, CASE `type` WHEN 'tops' THEN 'shortSleeveTops' ELSE `type` END, `colours`, `seasons`, `rainproof`, `category`, `occasions`, `pattern`, `brand`, `shop_url`, `status`, `source`, `upload_id`, NULL, `back_image_key`, `rotation`, `original_key`, `image_key`, `content_type`, `created_at`, `updated_at` FROM `__keep_pieces`;--> statement-breakpoint
INSERT INTO `photo_garments` (`id`, `photo_id`, `account_id`, `position`, `cutout_key`, `type`, `colours`, `piece_id`, `state`) SELECT `id`, `photo_id`, `account_id`, `position`, `cutout_key`, CASE `type` WHEN 'tops' THEN 'shortSleeveTops' ELSE `type` END, `colours`, `piece_id`, `state` FROM `__keep_photo_garments`;--> statement-breakpoint
UPDATE `captures` SET `garment_id` = (SELECT `garment_id` FROM `__keep_captures` WHERE `__keep_captures`.`id` = `captures`.`id`) WHERE `id` IN (SELECT `id` FROM `__keep_captures`);--> statement-breakpoint
INSERT INTO `detections` (`id`, `capture_id`, `account_id`, `status`, `cutout_key`, `source_key`, `back_cutout_key`, `confidence`, `preselected`, `suggested_type`, `suggested_colours`, `suggested_seasons`, `suggested_rainproof`, `suggested_category`, `suggested_occasions`, `suggested_pattern`, `whole`, `group_of`, `duplicate_of`, `matching`, `match_claimed_at`, `created_at`) SELECT `id`, `capture_id`, `account_id`, `status`, `cutout_key`, `source_key`, `back_cutout_key`, `confidence`, `preselected`, CASE `suggested_type` WHEN 'tops' THEN 'shortSleeveTops' ELSE `suggested_type` END, `suggested_colours`, `suggested_seasons`, `suggested_rainproof`, `suggested_category`, `suggested_occasions`, `suggested_pattern`, `whole`, `group_of`, `duplicate_of`, `matching`, `match_claimed_at`, `created_at` FROM `__keep_detections`;--> statement-breakpoint
UPDATE `pieces` SET `detection_id` = (SELECT `detection_id` FROM `__keep_pieces` WHERE `__keep_pieces`.`id` = `pieces`.`id`) WHERE `id` IN (SELECT `id` FROM `__keep_pieces` WHERE `detection_id` IS NOT NULL);--> statement-breakpoint
UPDATE `boards` SET `anchor_piece_id` = (SELECT `anchor_piece_id` FROM `__keep_boards` WHERE `__keep_boards`.`id` = `boards`.`id`) WHERE `id` IN (SELECT `id` FROM `__keep_boards`);--> statement-breakpoint
INSERT INTO `piece_pictures` SELECT * FROM `__keep_piece_pictures` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `piece_turns` SELECT * FROM `__keep_piece_turns` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `look_pieces` SELECT * FROM `__keep_look_pieces` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `board_items` SELECT * FROM `__keep_board_items` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `board_pins` SELECT * FROM `__keep_board_pins` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `board_outfit_pieces` SELECT * FROM `__keep_board_outfit_pieces` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `saves` SELECT * FROM `__keep_saves` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `worn_pieces` SELECT * FROM `__keep_worn_pieces` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `generation_picks` SELECT * FROM `__keep_generation_picks` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `imported_pieces` SELECT * FROM `__keep_imported_pieces` WHERE `piece_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `photo_garments_position` ON `photo_garments` (`photo_id`,`position`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `photo_garments_piece` ON `photo_garments` (`piece_id`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `pieces_account_created` ON `pieces` (`account_id`,`created_at`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `pieces_status_updated` ON `pieces` (`status`,`updated_at`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `detections_capture` ON `detections` (`capture_id`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `detections_account` ON `detections` (`account_id`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `detections_group` ON `detections` (`group_of`);--> statement-breakpoint--> statement-breakpoint
CREATE INDEX `detections_duplicate` ON `detections` (`duplicate_of`);--> statement-breakpoint
DROP TABLE `__keep_pieces`;--> statement-breakpoint
DROP TABLE `__keep_detections`;--> statement-breakpoint
DROP TABLE `__keep_photo_garments`;--> statement-breakpoint
DROP TABLE `__keep_piece_pictures`;--> statement-breakpoint
DROP TABLE `__keep_piece_turns`;--> statement-breakpoint
DROP TABLE `__keep_look_pieces`;--> statement-breakpoint
DROP TABLE `__keep_board_items`;--> statement-breakpoint
DROP TABLE `__keep_board_pins`;--> statement-breakpoint
DROP TABLE `__keep_board_outfit_pieces`;--> statement-breakpoint
DROP TABLE `__keep_saves`;--> statement-breakpoint
DROP TABLE `__keep_worn_pieces`;--> statement-breakpoint
DROP TABLE `__keep_generation_picks`;--> statement-breakpoint
DROP TABLE `__keep_imported_pieces`;--> statement-breakpoint
DROP TABLE `__keep_captures`;--> statement-breakpoint
DROP TABLE `__keep_boards`;
