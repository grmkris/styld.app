CREATE TABLE `assistant_feedback` (
	`id` text PRIMARY KEY,
	`account_id` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`tool` text,
	`day` text NOT NULL,
	`count` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_assistant_feedback_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	CONSTRAINT "assistant_feedback_kind" CHECK("kind" IN ('problem', 'missing', 'idea')),
	CONSTRAINT "assistant_feedback_status" CHECK("status" IN ('open', 'handled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_feedback_once` ON `assistant_feedback` (`account_id`,`day`,`kind`,`message`);--> statement-breakpoint
CREATE INDEX `assistant_feedback_status_updated` ON `assistant_feedback` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `assistant_feedback_created` ON `assistant_feedback` (`created_at`);