CREATE TABLE `thinking_days` (
	`account_id` text NOT NULL,
	`day` text NOT NULL,
	`asked` integer NOT NULL,
	CONSTRAINT `thinking_days_pk` PRIMARY KEY(`account_id`, `day`),
	CONSTRAINT `fk_thinking_days_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
