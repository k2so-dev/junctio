PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_endpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`namespace_id` text NOT NULL,
	`auth_mode` text DEFAULT 'api_key' NOT NULL,
	`protocol_min` text DEFAULT '2026-07-28' NOT NULL,
	`rate_limit` text DEFAULT '{"perMinute":0}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`namespace_id`) REFERENCES `namespaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_endpoints`("id", "slug", "namespace_id", "auth_mode", "protocol_min", "rate_limit", "enabled", "created_at") SELECT "id", "slug", "namespace_id", "auth_mode", "protocol_min", "rate_limit", "enabled", "created_at" FROM `endpoints`;--> statement-breakpoint
DROP TABLE `endpoints`;--> statement-breakpoint
ALTER TABLE `__new_endpoints` RENAME TO `endpoints`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `endpoints_slug_unique` ON `endpoints` (`slug`);--> statement-breakpoint
ALTER TABLE `request_log` ADD `protocol` text;