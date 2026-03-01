DO $$ BEGIN
 CREATE TYPE "public"."run_config_adapter_type" AS ENUM('npm_script', 'custom_command', 'browser_preview');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "terminal_type" ADD VALUE 'process';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_config_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"run_config_id" text NOT NULL,
	"terminal_id" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"adapter_type" "run_config_adapter_type" NOT NULL,
	"command" text NOT NULL,
	"cwd" text,
	"env" text,
	"auto_restart" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_config_instances" ADD CONSTRAINT "run_config_instances_run_config_id_run_configs_id_fk" FOREIGN KEY ("run_config_id") REFERENCES "public"."run_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_config_instances" ADD CONSTRAINT "run_config_instances_terminal_id_terminals_id_fk" FOREIGN KEY ("terminal_id") REFERENCES "public"."terminals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_configs" ADD CONSTRAINT "run_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_configs" ADD CONSTRAINT "run_configs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
