CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"slot" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"result_json" text,
	"error" text,
	"instance" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_runs_slot" ON "job_runs" USING btree ("job_name","slot");--> statement-breakpoint
CREATE INDEX "idx_job_runs_started" ON "job_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_job_runs_job" ON "job_runs" USING btree ("job_name","started_at");