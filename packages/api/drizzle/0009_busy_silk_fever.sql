DO $$ BEGIN
 CREATE TYPE "public"."artifact_type" AS ENUM('screenshot', 'file', 'log');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"terminal_id" text,
	"type" "artifact_type" NOT NULL,
	"tool_name" text,
	"filename" text NOT NULL,
	"filepath" text NOT NULL,
	"mimetype" text NOT NULL,
	"size" integer NOT NULL,
	"metadata" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_session_id_claude_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
