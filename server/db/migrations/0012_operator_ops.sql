CREATE TABLE "operator_ops" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"client_uuid" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"ticket_id" integer,
	"staff_id" integer,
	"device_time" text,
	"applied_time" text,
	"warnings_json" text,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "operator_ops" ADD CONSTRAINT "operator_ops_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_ops" ADD CONSTRAINT "operator_ops_ticket_id_visitor_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."visitor_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_operator_ops_client" ON "operator_ops" USING btree ("tenant_id","client_uuid");--> statement-breakpoint
CREATE INDEX "idx_operator_ops_ticket" ON "operator_ops" USING btree ("ticket_id");