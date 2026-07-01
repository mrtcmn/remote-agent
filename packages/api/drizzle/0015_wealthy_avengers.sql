CREATE TABLE IF NOT EXISTS "run_flow_edges" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"target_node_id" text NOT NULL,
	"ready_delay_ms" integer DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_flow_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"flow_id" text NOT NULL,
	"run_config_id" text NOT NULL,
	"x" integer DEFAULT 0 NOT NULL,
	"y" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "run_flows" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"viewport" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flow_edges" ADD CONSTRAINT "run_flow_edges_flow_id_run_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."run_flows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flow_edges" ADD CONSTRAINT "run_flow_edges_source_node_id_run_flow_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."run_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flow_edges" ADD CONSTRAINT "run_flow_edges_target_node_id_run_flow_nodes_id_fk" FOREIGN KEY ("target_node_id") REFERENCES "public"."run_flow_nodes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flow_nodes" ADD CONSTRAINT "run_flow_nodes_flow_id_run_flows_id_fk" FOREIGN KEY ("flow_id") REFERENCES "public"."run_flows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flow_nodes" ADD CONSTRAINT "run_flow_nodes_run_config_id_run_configs_id_fk" FOREIGN KEY ("run_config_id") REFERENCES "public"."run_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flows" ADD CONSTRAINT "run_flows_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "run_flows" ADD CONSTRAINT "run_flows_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
