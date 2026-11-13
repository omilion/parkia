ALTER TABLE "auth_sessions" ADD COLUMN "impersonated_by_staff_id" integer;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "impersonated_tenant_id" integer;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "impersonation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD COLUMN "impersonation_reason" text;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_impersonated_by_staff_id_staff_id_fk" FOREIGN KEY ("impersonated_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_impersonated_tenant_id_tenants_id_fk" FOREIGN KEY ("impersonated_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;