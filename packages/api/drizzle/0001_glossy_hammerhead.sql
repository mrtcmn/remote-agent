CREATE TABLE `terminals` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`name` text DEFAULT 'Terminal' NOT NULL,
	`command` text NOT NULL,
	`cols` integer DEFAULT 80 NOT NULL,
	`rows` integer DEFAULT 24 NOT NULL,
	`persist` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`exit_code` integer,
	`scrollback` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `claude_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
