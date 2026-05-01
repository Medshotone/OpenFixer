CREATE TABLE `teams_dm_state` (
	`conversation_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_teams_dm_state_project_id_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `teams_dm_user` (
	`project_id` text NOT NULL,
	`aad_user_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `teams_dm_user_pk` PRIMARY KEY(`project_id`, `aad_user_id`),
	CONSTRAINT `fk_teams_dm_user_project_id_teams_config_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `teams_config`(`project_id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `teams_reply` ADD `project_id` text;