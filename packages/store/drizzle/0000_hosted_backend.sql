CREATE TABLE "run_events" (
	"run_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" uuid,
	"spec" jsonb NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trigger_run_id" text,
	"cancel_requested" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_owner_created_idx" ON "runs" USING btree ("owner_id","created_at");