ALTER TYPE "terminal_type" ADD VALUE 'ssh';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ssh_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"enc_password" text,
	"enc_private_key" text,
	"enc_passphrase" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ssh_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ssh_hosts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 22 NOT NULL,
	"username" text NOT NULL,
	"auth_type" text NOT NULL,
	"credential_id" text,
	"group_id" text,
	"tags" text,
	"known_host_fp" text,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ssh_log_events" (
	"id" text PRIMARY KEY NOT NULL,
	"host_id" text NOT NULL,
	"session_id" text,
	"type" text NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claude_sessions" ADD COLUMN "ssh_host_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_credentials" ADD CONSTRAINT "ssh_credentials_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_groups" ADD CONSTRAINT "ssh_groups_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_hosts" ADD CONSTRAINT "ssh_hosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_hosts" ADD CONSTRAINT "ssh_hosts_credential_id_ssh_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."ssh_credentials"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_hosts" ADD CONSTRAINT "ssh_hosts_group_id_ssh_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ssh_groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ssh_log_events" ADD CONSTRAINT "ssh_log_events_host_id_ssh_hosts_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ssh_hosts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
