CREATE TABLE "contract_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"index_type" text NOT NULL,
	"period_key" text NOT NULL,
	"previous_fee" integer NOT NULL,
	"new_fee" integer NOT NULL,
	"factor_pct" double precision NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ipc_rates" (
	"period" text PRIMARY KEY NOT NULL,
	"variation_pct" double precision NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"space_id" integer,
	"client_id" integer,
	"plate" text NOT NULL,
	"visitor_name" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"qr_token" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "adjustment_index" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "base_uf_value" double precision;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "last_adjusted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_adjustments" ADD CONSTRAINT "contract_adjustments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_contract_adjustments_period" ON "contract_adjustments" USING btree ("tenant_id","contract_id","index_type","period_key");--> statement-breakpoint
CREATE INDEX "idx_reservations_tenant_status" ON "reservations" USING btree ("tenant_id","status","starts_at");--> statement-breakpoint
CREATE INDEX "idx_reservations_space_window" ON "reservations" USING btree ("tenant_id","space_id","starts_at","ends_at");