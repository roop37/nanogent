CREATE TABLE "github_connections" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"login" text NOT NULL,
	"credentials" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"full_name" text NOT NULL,
	"branch" text NOT NULL,
	"commit_sha" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_owner_repository_idx" ON "projects" USING btree ("owner_id","repository_id");