CREATE TABLE `teams_reply` (
	`message_id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`worktree` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL
);
