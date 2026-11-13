CREATE TABLE "privacy_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" integer,
	"subject_identifier" text NOT NULL,
	"purpose" text NOT NULL,
	"policy_version" text NOT NULL,
	"granted" integer DEFAULT 1 NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "privacy_consents" ADD CONSTRAINT "privacy_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_privacy_consents_tenant_subject" ON "privacy_consents" USING btree ("tenant_id","subject_identifier","created_at");--> statement-breakpoint
CREATE INDEX "idx_privacy_consents_purpose" ON "privacy_consents" USING btree ("tenant_id","purpose");