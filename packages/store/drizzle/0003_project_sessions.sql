ALTER TABLE "runs" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_owner_project_created_idx" ON "runs" USING btree ("owner_id","project_id","created_at");