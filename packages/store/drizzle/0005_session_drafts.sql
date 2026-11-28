CREATE TABLE "run_drafts" (
	"run_id" text PRIMARY KEY NOT NULL,
	"snapshot" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN "draft_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD COLUMN "draft_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "draft_version" integer;--> statement-breakpoint
ALTER TABLE "run_drafts" ADD CONSTRAINT "run_drafts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;