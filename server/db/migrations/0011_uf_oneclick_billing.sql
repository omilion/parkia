CREATE TABLE "oneclick_inscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"tbk_user" text,
	"authorization_code" text,
	"card_type" text,
	"card_last4" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"subscription_id" integer,
	"plan_id" integer,
	"period_start" date,
	"period_end" date,
	"uf_date" date NOT NULL,
	"uf_value_clp" double precision NOT NULL,
	"amount_uf_centis" integer NOT NULL,
	"amount_clp" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"buy_order" text NOT NULL,
	"authorization_code" text,
	"dte_document_id" integer,
	"dte_folio" integer,
	"dte_status" text,
	"error_message" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_invoices_buy_order_unique" UNIQUE("buy_order")
);
--> statement-breakpoint
CREATE TABLE "uf_rates" (
	"rate_date" date PRIMARY KEY NOT NULL,
	"value_clp" double precision NOT NULL,
	"source" text DEFAULT 'mindicador.cl' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "price_uf_centis" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "oneclick_inscriptions" ADD CONSTRAINT "oneclick_inscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_oneclick_inscriptions_tenant_status" ON "oneclick_inscriptions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "idx_oneclick_inscriptions_token" ON "oneclick_inscriptions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_subscription_invoices_tenant_created" ON "subscription_invoices" USING btree ("tenant_id","created_at");