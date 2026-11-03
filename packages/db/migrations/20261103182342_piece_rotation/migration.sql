ALTER TABLE `pieces` ADD `rotation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pieces` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text,
	`notes` text,
	`type` text NOT NULL,
	`colours` text NOT NULL,
	`season` text,
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
	CONSTRAINT "pieces_type" CHECK("type" IN ('tops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'jewellery', 'eyewear')),
	CONSTRAINT "pieces_season" CHECK("season" IN ('warm', 'cold', 'allYear')),
	CONSTRAINT "pieces_pattern" CHECK("pattern" IN ('plain', 'striped', 'checked', 'printed')),
	CONSTRAINT "pieces_status" CHECK("status" IN ('processing', 'ready', 'failed')),
	CONSTRAINT "pieces_source" CHECK("source" IN ('website', 'assistant', 'import')),
	CONSTRAINT "pieces_rotation" CHECK("rotation" IN (0, 90, 180, 270)),
	CONSTRAINT "pieces_colours" CHECK(json_type("colours") = 'array'),
	CONSTRAINT "pieces_occasions" CHECK(json_type("occasions") = 'array')
);
--> statement-breakpoint
INSERT INTO `__new_pieces`(`id`, `account_id`, `name`, `notes`, `type`, `colours`, `season`, `occasions`, `pattern`, `brand`, `shop_url`, `status`, `source`, `upload_id`, `detection_id`, `back_image_key`, `original_key`, `image_key`, `content_type`, `created_at`, `updated_at`) SELECT `id`, `account_id`, `name`, `notes`, `type`, `colours`, `season`, `occasions`, `pattern`, `brand`, `shop_url`, `status`, `source`, `upload_id`, `detection_id`, `back_image_key`, `original_key`, `image_key`, `content_type`, `created_at`, `updated_at` FROM `pieces`;--> statement-breakpoint
DROP TABLE `pieces`;--> statement-breakpoint
ALTER TABLE `__new_pieces` RENAME TO `pieces`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `pieces_account_created` ON `pieces` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pieces_status_updated` ON `pieces` (`status`,`updated_at`);