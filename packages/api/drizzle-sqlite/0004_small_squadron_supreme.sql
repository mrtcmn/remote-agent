ALTER TABLE `kanban_task_comments` ADD `kind` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `plan_doc` text;--> statement-breakpoint
ALTER TABLE `kanban_tasks` ADD `plan_status` text DEFAULT 'none' NOT NULL;