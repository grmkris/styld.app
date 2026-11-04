CREATE TABLE `styld_auth_oauthCredentials` (
	`module_id` text NOT NULL,
	`credential_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`identity_key` text NOT NULL,
	`credential_revision` text NOT NULL,
	`active` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_oauthIdentities` (
	`identity_key` text NOT NULL,
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`external_subject` text NOT NULL,
	`subject_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `styld_auth_oauthSignInFlows` (
	`module_id` text NOT NULL,
	`flow_id` text NOT NULL,
	`purpose` text NOT NULL,
	`generation` integer NOT NULL,
	`provider` text NOT NULL,
	`callback_id` text NOT NULL,
	`issuer` text NOT NULL,
	`response_issuer_mode` text NOT NULL,
	`subject_id` text,
	`state_digest` text NOT NULL,
	`binder_verifier` text NOT NULL,
	`binder_expires_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_oauthCredentials_key_0` ON `styld_auth_oauthCredentials` (`credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_oauthCredentials_key_1` ON `styld_auth_oauthCredentials` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_oauthIdentities_key_0` ON `styld_auth_oauthIdentities` (`identity_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_oauthSignInFlows_key_0` ON `styld_auth_oauthSignInFlows` (`module_id`,`flow_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `styld_auth_oauthSignInFlows_key_1` ON `styld_auth_oauthSignInFlows` (`state_digest`);