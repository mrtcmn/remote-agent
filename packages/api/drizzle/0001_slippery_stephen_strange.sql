DO $$ BEGIN
 CREATE TYPE "public"."line_side" AS ENUM('additions', 'deletions');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."review_comment_status" AS ENUM('pending', 'running', 'resolved');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "review_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"batch_id" text,
	"file_path" text NOT NULL,
	"line_number" integer NOT NULL,
	"line_side" "line_side" NOT NULL,
	"line_content" text NOT NULL,
	"file_sha" text,
	"comment" text NOT NULL,
	"status" "review_comment_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "review_comments" ADD CONSTRAINT "review_comments_session_id_claude_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
