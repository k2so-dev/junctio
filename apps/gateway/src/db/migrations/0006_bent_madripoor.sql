CREATE TABLE `audit_ignores` (
	`server_id` text NOT NULL,
	`advisory_id` text NOT NULL,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`server_id`, `advisory_id`),
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_results` (
	`server_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`ecosystem` text,
	`target` text DEFAULT '[]' NOT NULL,
	`resolved` text DEFAULT '[]' NOT NULL,
	`findings` text DEFAULT '[]' NOT NULL,
	`engine` text,
	`error` text,
	`reason` text,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`duration_ms` integer,
	`checked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `servers` ADD `quarantined_at` integer;--> statement-breakpoint
ALTER TABLE `servers` ADD `quarantine_reason` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `disabled_reason` text;