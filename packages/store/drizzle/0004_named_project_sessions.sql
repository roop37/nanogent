CREATE TABLE "project_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"commit_sha" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_sessions_project_created_idx" ON "project_sessions" USING btree ("project_id","created_at");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_session_id_project_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."project_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_session_created_idx" ON "runs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_active_session_idx" ON "runs" USING btree ("session_id") WHERE "runs"."session_id" is not null and "runs"."state" in ('queued', 'running', 'awaiting_approval');