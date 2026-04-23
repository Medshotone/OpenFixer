CREATE TABLE `teams_config` (
	`project_id` text PRIMARY KEY,
	`conversation_id` text NOT NULL UNIQUE,
	`service_url` text NOT NULL,
	`tenant_id` text,
	`trigger_mode` text DEFAULT 'always' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`agent` text,
	`model` text,
	`variant` text,
	`auto_accept` integer,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_teams_config_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
