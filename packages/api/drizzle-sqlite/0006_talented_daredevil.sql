ALTER TABLE `kanban_tasks` ADD `goal` text;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `verify_status` text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `verify_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `verify_output` text;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `pr_url` text;