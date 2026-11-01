ALTER TABLE `piece_pictures` ADD `redraws` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `piece_pictures` ADD `paid` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `piece_turns` ADD `attempt` integer DEFAULT 0 NOT NULL;