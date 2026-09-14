CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`endpoint_id` text,
	`expires_at` integer,
	`last_used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`endpoint_id`) REFERENCES `endpoints`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_keys_prefix_idx` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE TABLE `endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`namespace_id` text NOT NULL,
	`auth_mode` text DEFAULT 'api_key' NOT NULL,
	`protocol_min` text DEFAULT '2025-06-18' NOT NULL,
	`rate_limit` text DEFAULT '{"perMinute":0}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`namespace_id`) REFERENCES `namespaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `endpoints_slug_unique` ON `endpoints` (`slug`);--> statement-breakpoint
CREATE TABLE `namespace_servers` (
	`namespace_id` text NOT NULL,
	`server_id` text NOT NULL,
	`prefix` text,
	`enabled` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`namespace_id`, `server_id`),
	FOREIGN KEY (`namespace_id`) REFERENCES `namespaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `namespaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `namespaces_name_unique` ON `namespaces` (`name`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `request_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`endpoint_id` text,
	`server_id` text,
	`method` text NOT NULL,
	`tool` text,
	`duration_ms` integer NOT NULL,
	`status` text NOT NULL,
	`error_code` text
);
--> statement-breakpoint
CREATE INDEX `request_log_ts_idx` ON `request_log` (`ts`);--> statement-breakpoint
CREATE INDEX `request_log_endpoint_idx` ON `request_log` (`endpoint_id`);--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`transport` text NOT NULL,
	`runtime` text DEFAULT 'custom' NOT NULL,
	`command` text DEFAULT '' NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`cwd` text,
	`url` text,
	`headers_enc` text,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`oauth_scope` text,
	`enabled` integer DEFAULT true NOT NULL,
	`warm` integer DEFAULT false NOT NULL,
	`idle_timeout_sec` integer DEFAULT 900 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `servers_name_unique` ON `servers` (`name`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_id_idx` ON `sessions` (`id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_overrides` (
	`namespace_id` text NOT NULL,
	`server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`display_name` text,
	`description` text,
	`annotations` text,
	PRIMARY KEY(`namespace_id`, `server_id`, `tool_name`),
	FOREIGN KEY (`namespace_id`) REFERENCES `namespaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upstream_oauth` (
	`server_id` text PRIMARY KEY NOT NULL,
	`issuer` text,
	`authorization_server_url` text,
	`client_id` text,
	`client_secret_enc` text,
	`access_token_enc` text,
	`refresh_token_enc` text,
	`expires_at` integer,
	`token_ttl_sec` integer,
	`scope` text,
	`resource` text,
	`as_metadata` text,
	`status` text DEFAULT 'needs_reauth' NOT NULL,
	`last_refresh_at` integer,
	`last_error` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
