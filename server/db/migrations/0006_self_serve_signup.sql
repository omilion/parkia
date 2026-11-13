CREATE TABLE "auth_email_verifications" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "email_verified" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_email_verifications" ADD CONSTRAINT "auth_email_verifications_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_email_verifications_staff" ON "auth_email_verifications" USING btree ("staff_id","expires_at");