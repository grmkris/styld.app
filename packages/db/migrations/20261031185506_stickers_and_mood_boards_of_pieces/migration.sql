ALTER TABLE `generation_pictures` DROP COLUMN `references`;--> statement-breakpoint
UPDATE `generation_jobs` SET `kind` = 'sticker' WHERE `kind` = 'picture';
