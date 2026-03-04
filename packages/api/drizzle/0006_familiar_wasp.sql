CREATE TABLE IF NOT EXISTS "project_links" (
	"id" text PRIMARY KEY NOT NULL,
	"parent_project_id" text NOT NULL,
	"child_project_id" text NOT NULL,
	"alias" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "is_multi_project" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_links" ADD CONSTRAINT "project_links_parent_project_id_projects_id_fk" FOREIGN KEY ("parent_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_links" ADD CONSTRAINT "project_links_child_project_id_projects_id_fk" FOREIGN KEY ("child_project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
