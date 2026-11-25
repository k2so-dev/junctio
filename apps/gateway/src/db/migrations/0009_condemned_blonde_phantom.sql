ALTER TABLE `endpoints` ADD `tool_mode` text DEFAULT 'compact' NOT NULL;--> statement-breakpoint
UPDATE `endpoints` SET `tool_mode` = 'full';--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`) SELECT 'default_tool_mode', 'full' WHERE EXISTS (SELECT 1 FROM `settings`);