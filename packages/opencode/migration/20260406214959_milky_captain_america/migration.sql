CREATE TABLE `jira_config` (
	`project_id` text PRIMARY KEY,
	`url` text NOT NULL,
	`email` text NOT NULL,
	`token` text NOT NULL,
	`project_key` text NOT NULL,
	`interval` integer DEFAULT 30 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_jira_config_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
