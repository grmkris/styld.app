ALTER TABLE `captures` ADD `import_id` text;--> statement-breakpoint
ALTER TABLE `detections` ADD `whole` real;--> statement-breakpoint
ALTER TABLE `detections` ADD `group_of` text;--> statement-breakpoint
ALTER TABLE `detections` ADD `duplicate_of` text REFERENCES pieces(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `detections` ADD `matching` text;--> statement-breakpoint
ALTER TABLE `detections` ADD `match_claimed_at` integer;--> statement-breakpoint
CREATE INDEX `captures_account_import` ON `captures` (`account_id`,`import_id`);--> statement-breakpoint
CREATE INDEX `detections_group` ON `detections` (`group_of`);