CREATE TABLE `session_containers` (
	`session_id` text NOT NULL,
	`container_name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`session_id`, `container_name`),
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
