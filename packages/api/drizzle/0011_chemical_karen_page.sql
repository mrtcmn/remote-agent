CREATE TABLE IF NOT EXISTS "worktrees" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"path" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD COLUMN IF NOT EXISTS "worktree_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worktrees" ADD CONSTRAINT "worktrees_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "claude_sessions" ADD CONSTRAINT "claude_sessions_worktree_id_worktrees_id_fk" FOREIGN KEY ("worktree_id") REFERENCES "public"."worktrees"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
