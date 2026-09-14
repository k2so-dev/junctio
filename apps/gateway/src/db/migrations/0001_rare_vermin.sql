CREATE TABLE `oauth_auth_codes` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`scopes` text DEFAULT '[]' NOT NULL,
	`resource` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_auth_codes_client_idx` ON `oauth_auth_codes` (`client_id`);--> statement-breakpoint
CREATE TABLE `oauth_auth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`state` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`resource` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`client_id` text PRIMARY KEY NOT NULL,
	`client_name` text,
	`client_secret_enc` text,
	`client_secret_expires_at` integer,
	`redirect_uris` text NOT NULL,
	`info` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`access_token_hash` text NOT NULL,
	`refresh_token_hash` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`resource` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`client_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_access_idx` ON `oauth_tokens` (`access_token_hash`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_refresh_idx` ON `oauth_tokens` (`refresh_token_hash`);