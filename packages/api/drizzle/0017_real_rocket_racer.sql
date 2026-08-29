ALTER TABLE "kanban_task_comments" ADD COLUMN "kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "plan_doc" text;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "plan_status" text DEFAULT 'none' NOT NULL;