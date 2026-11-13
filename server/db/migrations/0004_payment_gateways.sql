CREATE TABLE "payment_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"intent_id" integer NOT NULL,
	"kind" text NOT NULL,
	"external_id" text,
	"payload_json" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_intents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"public_id" text NOT NULL,
	"kind" text NOT NULL,
	"ticket_id" integer,
	"payment_id" integer,
	"provider" text NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'CLP' NOT NULL,
	"idempotency_key" text NOT NULL,
	"buy_order" text NOT NULL,
	"provider_token" text,
	"authorization_code" text,
	"card_last4" text,
	"quote_id" integer,
	"failure_reason" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"provider" text NOT NULL,
	"environment" text DEFAULT 'integration' NOT NULL,
	"commerce_code" text,
	"api_secret_encrypted" text,
	"enabled" integer DEFAULT 0 NOT NULL,
	"exit_window_mins" integer DEFAULT 15 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "public_token" text;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD COLUMN "exit_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_intent_id_payment_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."payment_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_ticket_id_visitor_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."visitor_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settings" ADD CONSTRAINT "payment_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_events_external" ON "payment_events" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "idx_payment_events_intent" ON "payment_events" USING btree ("intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intents_public_id" ON "payment_intents" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intents_tenant_idem" ON "payment_intents" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_intents_token" ON "payment_intents" USING btree ("provider","provider_token");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_ticket" ON "payment_intents" USING btree ("ticket_id","status");--> statement-breakpoint
CREATE INDEX "idx_payment_intents_payment" ON "payment_intents" USING btree ("payment_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payment_settings_tenant_provider" ON "payment_settings" USING btree ("tenant_id","provider");