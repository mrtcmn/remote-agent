ALTER TABLE "kanban_tasks" ADD COLUMN "goal" text;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "verify_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "verify_output" text;--> statement-breakpoint
ALTER TABLE "kanban_tasks" ADD COLUMN "pr_url" text;