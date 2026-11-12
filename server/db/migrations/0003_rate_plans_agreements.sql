CREATE TABLE "agreements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"kind" text NOT NULL,
	"value" integer NOT NULL,
	"cap_amount" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"group_id" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"vehicle_type" text DEFAULT 'all' NOT NULL,
	"mode" text DEFAULT 'per_minute' NOT NULL,
	"grace_mins" integer DEFAULT 0 NOT NULL,
	"daily_cap" integer,
	"first_block_minutes" integer,
	"block_minutes" integer,
	"valid_from" text,
	"valid_to" text,
	"status" text DEFAULT 'active' NOT NULL,
	"change_note" text,
	"created_by_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "rate_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"weekdays" text,
	"from_time" text NOT NULL,
	"to_time" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"price_per_minute" integer,
	"first_block_price" integer,
	"block_price" integer
);
--> statement-breakpoint
CREATE TABLE "ticket_validations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"agreement_id" integer NOT NULL,
	"validated_by" text DEFAULT 'merchant' NOT NULL,
	"staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "visitor_ticket_quotes" ADD COLUMN "rate_plan_id" integer;--> statement-breakpoint
ALTER TABLE "visitor_ticket_quotes" ADD COLUMN "breakdown_json" text;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "vehicle_type" text DEFAULT 'car' NOT NULL;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "rate_plan_id" integer;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "lost_ticket" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "lost_ticket_note" text;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "lost_ticket_evidence_path" text;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "lost_ticket_evidence_name" text;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "lost_ticket_by_staff_id" integer;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_plans" ADD CONSTRAINT "rate_plans_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_rules" ADD CONSTRAINT "rate_rules_plan_id_rate_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."rate_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_ticket_id_visitor_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."visitor_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_validations" ADD CONSTRAINT "ticket_validations_agreement_id_agreements_id_fk" FOREIGN KEY ("agreement_id") REFERENCES "public"."agreements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agreements_code" ON "agreements" USING btree ("code");--> statement-breakpoint
CREATE INDEX "idx_rate_plans_tenant_status" ON "rate_plans" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_rate_plans_group" ON "rate_plans" USING btree ("tenant_id","group_id","version");--> statement-breakpoint
CREATE INDEX "idx_rate_rules_plan" ON "rate_rules" USING btree ("plan_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ticket_validations_ticket_agreement" ON "ticket_validations" USING btree ("ticket_id","agreement_id");--> statement-breakpoint
CREATE INDEX "idx_ticket_validations_ticket" ON "ticket_validations" USING btree ("ticket_id");