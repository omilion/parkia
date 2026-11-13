ALTER TABLE "subscriptions" ADD COLUMN "grace_until" date;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_notice_at" timestamp with time zone;