CREATE TABLE IF NOT EXISTS "github_app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"github_app_id" text NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"repository_selection" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"app_id" integer NOT NULL,
	"app_slug" text NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"private_key" text NOT NULL,
	"webhook_secret" text,
	"html_url" text NOT NULL,
	"permissions" text,
	"events" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_app_installation_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_github_app_id_github_apps_id_fk" FOREIGN KEY ("github_app_id") REFERENCES "public"."github_apps"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "github_apps" ADD CONSTRAINT "github_apps_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_github_app_installation_id_github_app_installations_id_fk" FOREIGN KEY ("github_app_installation_id") REFERENCES "public"."github_app_installations"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
