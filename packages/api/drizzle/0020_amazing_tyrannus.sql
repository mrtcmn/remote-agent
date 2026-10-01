CREATE TABLE IF NOT EXISTS "session_containers" (
	"session_id" text NOT NULL,
	"container_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_containers_session_id_container_name_pk" PRIMARY KEY("session_id","container_name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "session_containers" ADD CONSTRAINT "session_containers_session_id_claude_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."claude_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
