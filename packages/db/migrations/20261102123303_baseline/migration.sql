CREATE TABLE `accounts` (
	`id` text PRIMARY KEY,
	`enabled` integer DEFAULT true NOT NULL,
	`security_revision` text NOT NULL,
	`display_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_attempt_buckets` (
	`key` text PRIMARY KEY,
	`tokens` real NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_assertions` (
	`namespace` text NOT NULL,
	`receipt` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `oauth_assertions_pk` PRIMARY KEY(`namespace`, `receipt`)
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`application_type` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "oauth_clients_application_type" CHECK("application_type" IN ('web', 'native'))
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`namespace` text NOT NULL,
	`id` text NOT NULL,
	`version` text NOT NULL,
	`record` text NOT NULL,
	`subject_id` text,
	`expires_at` integer NOT NULL,
	CONSTRAINT `oauth_grants_pk` PRIMARY KEY(`namespace`, `id`)
);
--> statement-breakpoint
CREATE TABLE `operation_receipts` (
	`account_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`command` text NOT NULL,
	`input_digest` text NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `operation_receipts_pk` PRIMARY KEY(`account_id`, `operation_id`),
	CONSTRAINT `fk_operation_receipts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `pieces` (
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
	CONSTRAINT "pieces_colours" CHECK(json_type("colours") = 'array'),
	CONSTRAINT "pieces_occasions" CHECK(json_type("occasions") = 'array')
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`token_digest` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`object_key` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	CONSTRAINT `fk_uploads_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "uploads_content_type" CHECK("content_type" IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'video/mp4', 'video/quicktime')),
	CONSTRAINT "uploads_status" CHECK("status" IN ('pending', 'received', 'used'))
);
--> statement-breakpoint
CREATE TABLE `capture_frames` (
	`capture_id` text NOT NULL,
	`idx` integer NOT NULL,
	`upload_id` text NOT NULL UNIQUE,
	`object_key` text NOT NULL,
	`at_ms` integer NOT NULL,
	`sharpness` text NOT NULL,
	CONSTRAINT `capture_frames_pk` PRIMARY KEY(`capture_id`, `idx`),
	CONSTRAINT `fk_capture_frames_capture_id_captures_id_fk` FOREIGN KEY (`capture_id`) REFERENCES `captures`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_capture_frames_upload_id_uploads_id_fk` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`),
	CONSTRAINT "capture_frames_sharpness" CHECK(json_type("sharpness") = 'array')
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`upload_id` text UNIQUE,
	`garment_id` text UNIQUE,
	`original_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`side` text,
	`pairs_with` text,
	`route` text,
	`provider` text,
	`provider_file_id` text,
	`frame_count` integer,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`credits` integer NOT NULL,
	`attempt` integer NOT NULL,
	`import_id` text,
	`tracking_started_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_captures_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_captures_upload_id_uploads_id_fk` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`),
	CONSTRAINT `fk_captures_garment_id_photo_garments_id_fk` FOREIGN KEY (`garment_id`) REFERENCES `photo_garments`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_captures_pairs_with_captures_id_fk` FOREIGN KEY (`pairs_with`) REFERENCES `captures`(`id`) ON DELETE SET NULL,
	CONSTRAINT "captures_kind" CHECK("kind" IN ('photo', 'video')),
	CONSTRAINT "captures_source" CHECK("source" IN ('picker', 'camera', 'video', 'link', 'photos')),
	CONSTRAINT "captures_status" CHECK("status" IN ('processing', 'review', 'done', 'failed', 'unknown')),
	CONSTRAINT "captures_side" CHECK("side" IN ('front', 'back', 'unclear')),
	CONSTRAINT "captures_route" CHECK("route" IN ('none', 'one', 'several')),
	CONSTRAINT "captures_origin" CHECK(("source" = 'photos') = ("upload_id" IS NULL))
);
--> statement-breakpoint
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
	`suggested_season` text,
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
	CONSTRAINT "detections_suggested_type" CHECK("suggested_type" IN ('tops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'jewellery', 'eyewear')),
	CONSTRAINT "detections_suggested_season" CHECK("suggested_season" IN ('warm', 'cold', 'allYear')),
	CONSTRAINT "detections_suggested_pattern" CHECK("suggested_pattern" IN ('plain', 'striped', 'checked', 'printed')),
	CONSTRAINT "detections_matching" CHECK("matching" IN ('waiting', 'claimed', 'done')),
	CONSTRAINT "detections_suggested_colours" CHECK(json_type("suggested_colours") = 'array'),
	CONSTRAINT "detections_suggested_occasions" CHECK(json_type("suggested_occasions") = 'array')
);
--> statement-breakpoint
CREATE TABLE `piece_pictures` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`shown` text,
	`clean_key` text,
	`version` integer NOT NULL,
	`key_colour` text,
	`provider` text,
	`face` real,
	`hint` text,
	`redraws` integer NOT NULL,
	`paid` integer NOT NULL,
	`claimed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_pictures_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_pictures_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "piece_pictures_state" CHECK("state" IN ('queued', 'generating', 'checking', 'ready', 'proposed', 'rejected', 'retake', 'kept-real', 'failed')),
	CONSTRAINT "piece_pictures_shown" CHECK("shown" IN ('clean', 'photo')),
	CONSTRAINT "piece_pictures_key_colour" CHECK("key_colour" IN ('green', 'magenta'))
);
--> statement-breakpoint
CREATE TABLE `piece_turns` (
	`piece_id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`state` text NOT NULL,
	`attempt` integer NOT NULL,
	`operation` text,
	`layout` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_piece_turns_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_piece_turns_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "piece_turns_state" CHECK("state" IN ('requested', 'anchoring', 'generating', 'video-ready', 'ready', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `outfit_photos` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`original_key` text NOT NULL,
	`content_type` text NOT NULL,
	`status` text NOT NULL,
	`favourite` integer NOT NULL,
	`look_id` text,
	`cutout_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_outfit_photos_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_outfit_photos_upload_id_uploads_id_fk` FOREIGN KEY (`upload_id`) REFERENCES `uploads`(`id`),
	CONSTRAINT `fk_outfit_photos_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE SET NULL,
	CONSTRAINT "outfit_photos_status" CHECK("status" IN ('finding', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE TABLE `photo_garments` (
	`id` text PRIMARY KEY,
	`photo_id` text NOT NULL,
	`account_id` text NOT NULL,
	`position` integer NOT NULL,
	`cutout_key` text NOT NULL,
	`type` text,
	`colours` text NOT NULL,
	`piece_id` text,
	`state` text NOT NULL,
	CONSTRAINT `fk_photo_garments_photo_id_outfit_photos_id_fk` FOREIGN KEY (`photo_id`) REFERENCES `outfit_photos`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_photo_garments_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE SET NULL,
	CONSTRAINT "photo_garments_type" CHECK("type" IN ('tops', 'shirts', 'bodysuits', 'knitwear', 'hoodies', 'blazers', 'jackets', 'coats', 'gilets', 'dresses', 'jumpsuits', 'jeans', 'trousers', 'shorts', 'skirts', 'sportswear', 'swimwear', 'loungewear', 'trainers', 'boots', 'heels', 'flats', 'sandals', 'bags', 'belts', 'scarves', 'hats', 'jewellery', 'eyewear')),
	CONSTRAINT "photo_garments_state" CHECK("state" IN ('suggested', 'confirmed', 'unmatched', 'offered')),
	CONSTRAINT "photo_garments_colours" CHECK(json_type("colours") = 'array')
);
--> statement-breakpoint
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
	`shared_at` integer,
	CONSTRAINT `fk_looks_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `board_images` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`object_key` text NOT NULL,
	`content_type` text NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_board_images_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_board_images_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "board_images_origin" CHECK("origin" IN ('upload', 'generated', 'photo'))
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
	CONSTRAINT `fk_board_items_image_id_board_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `board_images`(`id`) ON DELETE CASCADE,
	CONSTRAINT "board_items_kind" CHECK("kind" IN ('piece', 'text', 'image')),
	CONSTRAINT "board_items_text_style" CHECK("text_style" IN ('label', 'headline')),
	CONSTRAINT "board_items_target" CHECK(("kind" = 'piece') = ("piece_id" IS NOT NULL) AND ("kind" = 'image') = ("image_id" IS NOT NULL) AND ("kind" = 'text') = ("text" IS NOT NULL AND "text_style" IS NOT NULL))
);
--> statement-breakpoint
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
	CONSTRAINT `fk_board_pins_look_id_looks_id_fk` FOREIGN KEY (`look_id`) REFERENCES `looks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "board_pins_kind" CHECK("kind" IN ('piece', 'picture', 'look')),
	CONSTRAINT "board_pins_target" CHECK(("kind" = 'piece') = ("piece_id" IS NOT NULL) AND ("kind" = 'picture') = ("image_id" IS NOT NULL) AND ("kind" = 'look') = ("look_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `boards` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`paper` text NOT NULL,
	`version` integer NOT NULL,
	`visibility` text NOT NULL,
	`moods` text NOT NULL,
	`published_at` integer,
	`featured_at` integer,
	`search_text` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_boards_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "boards_paper" CHECK("paper" IN ('paper', 'stock', 'sand', 'sage', 'slate', 'clay')),
	CONSTRAINT "boards_visibility" CHECK("visibility" IN ('private', 'public')),
	CONSTRAINT "boards_moods" CHECK(json_type("moods") = 'array')
);
--> statement-breakpoint
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
CREATE TABLE `profiles` (
	`account_id` text PRIMARY KEY,
	`handle` text UNIQUE,
	`name` text NOT NULL,
	`city` text,
	`bio` text,
	`tone` text NOT NULL,
	`published` integer NOT NULL,
	`published_at` integer,
	`featured_at` integer,
	`search_text` text NOT NULL,
	`house` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_profiles_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "profiles_tone" CHECK("tone" IN ('sand', 'sage', 'slate', 'clay', 'stone', 'plum', 'olive', 'ink'))
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
	CONSTRAINT `fk_reports_owner_id_accounts_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "reports_target_kind" CHECK("target_kind" IN ('profile', 'board', 'look', 'piece')),
	CONSTRAINT "reports_reason" CHECK("reason" IN ('spam', 'nudity', 'harassment', 'hate', 'violence', 'selfHarm', 'ip', 'other'))
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
	CONSTRAINT `fk_saves_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "saves_kind" CHECK("kind" IN ('piece', 'look', 'board')),
	CONSTRAINT "saves_target" CHECK(("kind" = 'piece') = ("piece_id" IS NOT NULL) AND ("kind" = 'look') = ("look_id" IS NOT NULL) AND ("kind" = 'board') = ("board_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE `content_checks` (
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`account_id` text NOT NULL,
	`digest` text NOT NULL,
	`state` text NOT NULL,
	`reason` text,
	`model` text,
	`hidden` text,
	`requested_at` integer NOT NULL,
	CONSTRAINT `content_checks_pk` PRIMARY KEY(`target_kind`, `target_id`),
	CONSTRAINT `fk_content_checks_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "content_checks_target_kind" CHECK("target_kind" IN ('profile', 'board', 'piece', 'picture', 'look')),
	CONSTRAINT "content_checks_state_value" CHECK("state" IN ('pending', 'passed', 'unsure', 'failed')),
	CONSTRAINT "content_checks_reason" CHECK("reason" IN ('sexual', 'minor', 'violence', 'hate', 'selfHarm', 'spam', 'instructions', 'other')),
	CONSTRAINT "content_checks_hidden" CHECK("hidden" IN ('reports', 'admin'))
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
CREATE TABLE `generation_jobs` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`board_id` text NOT NULL,
	`kind` text NOT NULL,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`collage_version` integer NOT NULL,
	`moods` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_generation_jobs_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_jobs_board_id_boards_id_fk` FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON DELETE CASCADE,
	CONSTRAINT "generation_jobs_kind" CHECK("kind" IN ('sticker', 'moodBoard')),
	CONSTRAINT "generation_jobs_status" CHECK("status" IN ('planning', 'drawing', 'arranging', 'done', 'refused', 'failed')),
	CONSTRAINT "generation_jobs_reason" CHECK("reason" IN ('unclear', 'refused', 'unavailable')),
	CONSTRAINT "generation_jobs_moods" CHECK(json_type("moods") = 'array')
);
--> statement-breakpoint
CREATE TABLE `generation_picks` (
	`job_id` text NOT NULL,
	`position` integer NOT NULL,
	`piece_id` text NOT NULL,
	CONSTRAINT `generation_picks_pk` PRIMARY KEY(`job_id`, `position`),
	CONSTRAINT `fk_generation_picks_job_id_generation_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_picks_piece_id_pieces_id_fk` FOREIGN KEY (`piece_id`) REFERENCES `pieces`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `generation_pictures` (
	`job_id` text PRIMARY KEY,
	`prompt` text NOT NULL,
	`status` text NOT NULL,
	`image_id` text,
	`started_at` integer,
	CONSTRAINT `fk_generation_pictures_job_id_generation_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `generation_jobs`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_generation_pictures_image_id_board_images_id_fk` FOREIGN KEY (`image_id`) REFERENCES `board_images`(`id`) ON DELETE SET NULL,
	CONSTRAINT "generation_pictures_status" CHECK("status" IN ('waiting', 'drawing', 'drawn', 'refused', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE `thinking_days` (
	`account_id` text NOT NULL,
	`day` text NOT NULL,
	`asked` integer NOT NULL,
	CONSTRAINT `thinking_days_pk` PRIMARY KEY(`account_id`, `day`),
	CONSTRAINT `fk_thinking_days_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `stylist_turns` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT `fk_stylist_turns_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `styld_auth_credentials` (
	`credential_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`revision` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_email_credentials` (
	`module_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`identifier_namespace` text NOT NULL,
	`identifier_value` text NOT NULL,
	`credential_revision` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_identifiers` (
	`namespace` text NOT NULL,
	`value` text NOT NULL,
	`module_id` text,
	`credential_id` text,
	`subject_id` text NOT NULL,
	`revision` text NOT NULL,
	`verified_at` integer,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_passwords` (
	`module_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`credential_revision` text NOT NULL,
	`verifier_version` text NOT NULL,
	`verifier` text NOT NULL,
	`normalization` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_pending` (
	`module_id` text NOT NULL,
	`kind` text NOT NULL,
	`digest` text NOT NULL,
	`version` text NOT NULL,
	`flow_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`binding_digest` text NOT NULL,
	`snapshot` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempt_limit` integer NOT NULL,
	`failed_attempts` integer NOT NULL,
	`consumed` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_proofs` (
	`module_id` text NOT NULL,
	`purpose` text NOT NULL,
	`series_key` text NOT NULL,
	`proof_id` text NOT NULL,
	`binding` text NOT NULL,
	`verifier_key_id` text NOT NULL,
	`verifier_digest` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`failed_attempts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_sessions` (
	`session_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`digest` text NOT NULL,
	`security_revision` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_attempt_buckets_expiry` ON `auth_attempt_buckets` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_assertions_expiry` ON `oauth_assertions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `oauth_grants_subject` ON `oauth_grants` (`subject_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_expiry` ON `oauth_grants` (`expires_at`);--> statement-breakpoint
CREATE INDEX `operation_receipts_created` ON `operation_receipts` (`created_at`);--> statement-breakpoint
CREATE INDEX `pieces_account_created` ON `pieces` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pieces_status_updated` ON `pieces` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `uploads_account` ON `uploads` (`account_id`);--> statement-breakpoint
CREATE INDEX `uploads_status_expiry` ON `uploads` (`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `captures_account_created` ON `captures` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `captures_status_updated` ON `captures` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `captures_account_import` ON `captures` (`account_id`,`import_id`);--> statement-breakpoint
CREATE INDEX `captures_pairs_with` ON `captures` (`pairs_with`);--> statement-breakpoint
CREATE INDEX `detections_capture` ON `detections` (`capture_id`);--> statement-breakpoint
CREATE INDEX `detections_account` ON `detections` (`account_id`);--> statement-breakpoint
CREATE INDEX `detections_group` ON `detections` (`group_of`);--> statement-breakpoint
CREATE INDEX `detections_duplicate` ON `detections` (`duplicate_of`);--> statement-breakpoint
CREATE INDEX `piece_pictures_account` ON `piece_pictures` (`account_id`);--> statement-breakpoint
CREATE INDEX `piece_pictures_state_updated` ON `piece_pictures` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `piece_turns_account` ON `piece_turns` (`account_id`);--> statement-breakpoint
CREATE INDEX `piece_turns_state_updated` ON `piece_turns` (`state`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `outfit_photos_upload` ON `outfit_photos` (`upload_id`);--> statement-breakpoint
CREATE INDEX `outfit_photos_account_created` ON `outfit_photos` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `outfit_photos_status_updated` ON `outfit_photos` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `outfit_photos_look` ON `outfit_photos` (`look_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `photo_garments_position` ON `photo_garments` (`photo_id`,`position`);--> statement-breakpoint
CREATE INDEX `photo_garments_piece` ON `photo_garments` (`piece_id`);--> statement-breakpoint
CREATE INDEX `look_pieces_piece` ON `look_pieces` (`piece_id`);--> statement-breakpoint
CREATE INDEX `looks_account_created` ON `looks` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `looks_shared` ON `looks` (`shared_at`);--> statement-breakpoint
CREATE INDEX `board_images_board` ON `board_images` (`board_id`);--> statement-breakpoint
CREATE INDEX `board_items_piece` ON `board_items` (`piece_id`);--> statement-breakpoint
CREATE INDEX `board_items_image` ON `board_items` (`image_id`);--> statement-breakpoint
CREATE INDEX `board_pins_board` ON `board_pins` (`board_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_board_piece` ON `board_pins` (`board_id`,`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_board_look` ON `board_pins` (`board_id`,`look_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `board_pins_image` ON `board_pins` (`image_id`);--> statement-breakpoint
CREATE INDEX `board_pins_piece` ON `board_pins` (`piece_id`);--> statement-breakpoint
CREATE INDEX `board_pins_look` ON `board_pins` (`look_id`);--> statement-breakpoint
CREATE INDEX `boards_account_updated` ON `boards` (`account_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `boards_public` ON `boards` (`visibility`,`published_at`);--> statement-breakpoint
CREATE INDEX `blocks_blocked` ON `blocks` (`blocked_id`);--> statement-breakpoint
CREATE INDEX `follows_followee` ON `follows` (`followee_id`);--> statement-breakpoint
CREATE INDEX `profiles_published` ON `profiles` (`published`,`featured_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `reports_reporter_target` ON `reports` (`reporter_id`,`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `reports_target` ON `reports` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `reports_reporter_created` ON `reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `reports_owner` ON `reports` (`owner_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_piece` ON `saves` (`account_id`,`piece_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_look` ON `saves` (`account_id`,`look_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `saves_account_board` ON `saves` (`account_id`,`board_id`);--> statement-breakpoint
CREATE INDEX `saves_account_created` ON `saves` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `saves_piece` ON `saves` (`piece_id`);--> statement-breakpoint
CREATE INDEX `saves_look` ON `saves` (`look_id`);--> statement-breakpoint
CREATE INDEX `saves_board` ON `saves` (`board_id`);--> statement-breakpoint
CREATE INDEX `content_checks_state` ON `content_checks` (`state`,`requested_at`);--> statement-breakpoint
CREATE INDEX `content_checks_account` ON `content_checks` (`account_id`);--> statement-breakpoint
CREATE INDEX `worn_pieces_piece` ON `worn_pieces` (`piece_id`);--> statement-breakpoint
CREATE INDEX `generation_jobs_account` ON `generation_jobs` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_board` ON `generation_jobs` (`board_id`);--> statement-breakpoint
CREATE INDEX `generation_jobs_status_updated` ON `generation_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `generation_picks_piece` ON `generation_picks` (`piece_id`);--> statement-breakpoint
CREATE INDEX `generation_pictures_image` ON `generation_pictures` (`image_id`);--> statement-breakpoint
CREATE INDEX `thinking_days_day` ON `thinking_days` (`day`);--> statement-breakpoint
CREATE INDEX `stylist_turns_created` ON `stylist_turns` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_credentials_key_0` ON `styld_auth_credentials` (`credential_id`);--> statement-breakpoint
CREATE INDEX `styld_auth_credentials_index_0` ON `styld_auth_credentials` (`subject_id`,`active`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_email_credentials_credential` ON `styld_auth_email_credentials` (`module_id`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_email_credentials_address` ON `styld_auth_email_credentials` (`module_id`,`identifier_namespace`,`identifier_value`);--> statement-breakpoint
CREATE INDEX `styld_auth_email_credentials_subject` ON `styld_auth_email_credentials` (`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_identifiers_key_0` ON `styld_auth_identifiers` (`namespace`,`value`);--> statement-breakpoint
CREATE INDEX `styld_auth_identifiers_index_0` ON `styld_auth_identifiers` (`subject_id`,`namespace`,`value`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_passwords_key_0` ON `styld_auth_passwords` (`module_id`,`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_passwords_key_1` ON `styld_auth_passwords` (`module_id`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_pending_key_0` ON `styld_auth_pending` (`digest`);--> statement-breakpoint
CREATE INDEX `styld_auth_pending_index_0` ON `styld_auth_pending` (`module_id`,`expires_at`,`digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_proofs_series` ON `styld_auth_proofs` (`module_id`,`purpose`,`series_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_proofs_proof` ON `styld_auth_proofs` (`module_id`,`proof_id`);--> statement-breakpoint
CREATE INDEX `styld_auth_proofs_expiry` ON `styld_auth_proofs` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_sessions_key_0` ON `styld_auth_sessions` (`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_sessions_key_1` ON `styld_auth_sessions` (`digest`);--> statement-breakpoint
CREATE INDEX `styld_auth_sessions_index_0` ON `styld_auth_sessions` (`subject_id`,`security_revision`,`session_id`);