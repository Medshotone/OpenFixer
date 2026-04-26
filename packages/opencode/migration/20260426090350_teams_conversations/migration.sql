CREATE TABLE `teams_conversation` (
	`conversation_id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_teams_conversation_project_id_teams_config_project_id_fk` FOREIGN KEY (`project_id`) REFERENCES `teams_config`(`project_id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `teams_conversation` (`conversation_id`, `project_id`, `time_created`, `time_updated`)
SELECT `conversation_id`, `project_id`, `time_created`, `time_updated` FROM `teams_config`;
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_teams_config` (
	`project_id` text PRIMARY KEY,
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
--> statement-breakpoint
INSERT INTO `__new_teams_config`(`project_id`, `service_url`, `tenant_id`, `trigger_mode`, `enabled`, `agent`, `model`, `variant`, `auto_accept`, `time_created`, `time_updated`) SELECT `project_id`, `service_url`, `tenant_id`, `trigger_mode`, `enabled`, `agent`, `model`, `variant`, `auto_accept`, `time_created`, `time_updated` FROM `teams_config`;--> statement-breakpoint
DROP TABLE `teams_config`;--> statement-breakpoint
ALTER TABLE `__new_teams_config` RENAME TO `teams_config`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
