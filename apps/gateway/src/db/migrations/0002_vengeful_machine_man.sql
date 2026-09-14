UPDATE `servers` SET `args` = (
	SELECT json_group_array(value) FROM (
		SELECT 0 AS ord, '-y' AS value
		UNION ALL SELECT 1, `servers`.`command`
		UNION ALL SELECT 2 + `key`, `value` FROM json_each(`servers`.`args`)
		ORDER BY ord
	)
) WHERE `transport` = 'stdio' AND `runtime` = 'npx' AND `command` <> '';--> statement-breakpoint
UPDATE `servers` SET `args` = (
	SELECT json_group_array(value) FROM (
		SELECT 0 AS ord, 'run' AS value
		UNION ALL SELECT 1 + `key`, `value` FROM json_each(`servers`.`args`)
		ORDER BY ord
	)
) WHERE `transport` = 'stdio' AND `runtime` = 'uv';--> statement-breakpoint
UPDATE `servers` SET `args` = (
	SELECT json_group_array(value) FROM (
		SELECT 0 AS ord, `servers`.`command` AS value
		UNION ALL SELECT 1 + `key`, `value` FROM json_each(`servers`.`args`)
		ORDER BY ord
	)
) WHERE `transport` = 'stdio' AND `runtime` IN ('bunx', 'uvx', 'node', 'custom') AND `command` <> '';--> statement-breakpoint
ALTER TABLE `servers` DROP COLUMN `command`;
