ALTER TABLE "staff" ADD COLUMN "totp_recovery_codes" text;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "totp_last_step" integer;