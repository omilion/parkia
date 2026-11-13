CREATE TABLE "mail_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"template" text NOT NULL,
	"text_body" text,
	"html_body" text,
	"tenant_ref" integer,
	"dedupe_key" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now(),
	"last_error" text,
	"provider_id" text,
	"transport" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_mail_outbox_dedupe" ON "mail_outbox" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_mail_outbox_due" ON "mail_outbox" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_mail_outbox_recipient" ON "mail_outbox" USING btree ("to_email","template","created_at");