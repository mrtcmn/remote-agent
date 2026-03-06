DO $$ BEGIN
 CREATE TYPE "public"."code_editor_status" AS ENUM('starting', 'running', 'stopped');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_editors" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"port" integer NOT NULL,
	"status" "code_editor_status" DEFAULT 'starting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"stopped_at" timestamp,
	CONSTRAINT "code_editors_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "code_editors" ADD CONSTRAINT "code_editors_session_id_claude_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
