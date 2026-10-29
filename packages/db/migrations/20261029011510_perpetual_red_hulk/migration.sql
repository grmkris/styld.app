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
CREATE UNIQUE INDEX `styld_auth_email_credentials_credential` ON `styld_auth_email_credentials` (`module_id`,`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_email_credentials_address` ON `styld_auth_email_credentials` (`module_id`,`identifier_namespace`,`identifier_value`);--> statement-breakpoint
CREATE INDEX `styld_auth_email_credentials_subject` ON `styld_auth_email_credentials` (`subject_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_proofs_series` ON `styld_auth_proofs` (`module_id`,`purpose`,`series_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_proofs_proof` ON `styld_auth_proofs` (`module_id`,`proof_id`);--> statement-breakpoint
CREATE INDEX `styld_auth_proofs_expiry` ON `styld_auth_proofs` (`expires_at`);