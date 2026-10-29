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
	`created_at` integer NOT NULL
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
CREATE INDEX `oauth_grants_subject` ON `oauth_grants` (`subject_id`);--> statement-breakpoint
CREATE INDEX `oauth_grants_expiry` ON `oauth_grants` (`expires_at`);