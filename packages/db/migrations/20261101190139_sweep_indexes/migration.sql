CREATE INDEX `captures_status_updated` ON `captures` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `oauth_assertions_expiry` ON `oauth_assertions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `operation_receipts_created` ON `operation_receipts` (`created_at`);--> statement-breakpoint
CREATE INDEX `piece_pictures_state_updated` ON `piece_pictures` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `piece_turns_state_updated` ON `piece_turns` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `pieces_status_updated` ON `pieces` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `generation_jobs_status_updated` ON `generation_jobs` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `outfit_photos_status_updated` ON `outfit_photos` (`status`,`updated_at`);