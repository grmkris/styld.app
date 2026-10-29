ALTER TABLE `captures` ADD `hold` text;--> statement-breakpoint
ALTER TABLE `captures` ADD `attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `captures` ADD `tracking_started_at` integer;