CREATE TABLE `project_agent_config` (
	`project_id` text PRIMARY KEY,
	`agent` text,
	`model` text,
	`variant` text,
	`auto_accept` integer DEFAULT false NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_project_agent_config_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
