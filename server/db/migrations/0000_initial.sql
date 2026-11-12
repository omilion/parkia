CREATE TABLE "access_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"client_id" integer,
	"visitor_id" integer,
	"space_id" integer,
	"access_type" text NOT NULL,
	"status" text DEFAULT 'authorized' NOT NULL,
	"method" text DEFAULT 'qr' NOT NULL,
	"reason" text,
	"authorized_by" text,
	"plate" text,
	"resolved_by_access_log_id" integer,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"timestamp" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "access_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"type" text NOT NULL,
	"rate_per_hour" integer NOT NULL,
	"rate_per_minute" integer,
	"grace_period_mins" integer DEFAULT 15 NOT NULL,
	"billing_mode" text DEFAULT 'per_minute' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"staff_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_login_attempts" (
	"attempt_key" text PRIMARY KEY NOT NULL,
	"ip_address" text NOT NULL,
	"email" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"reset_at" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_password_resets" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bank_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"date" date NOT NULL,
	"description" text,
	"rut" text,
	"amount" integer NOT NULL,
	"notes" text,
	"status" text DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"commune" text,
	"city" text,
	"phone" text,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"cash_session_id" integer NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"method" text NOT NULL,
	"direction" text DEFAULT 'in' NOT NULL,
	"amount" integer NOT NULL,
	"created_by_staff_id" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_session_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"cash_session_id" integer NOT NULL,
	"closed_by_staff_id" integer,
	"snapshot_json" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"staff_id" integer,
	"shift_log_id" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"opening_cash" integer DEFAULT 0 NOT NULL,
	"expected_cash" integer DEFAULT 0 NOT NULL,
	"counted_cash" integer,
	"counted_transfer" integer,
	"counted_card" integer,
	"difference_cash" integer,
	"opened_at" timestamp with time zone DEFAULT now(),
	"closed_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"rut" text,
	"type" text DEFAULT 'natural' NOT NULL,
	"financial_status" text DEFAULT 'up-to-date' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"address" text,
	"commune" text,
	"city" text,
	"business_activity" text,
	"legal_representative_name" text,
	"legal_representative_rut" text,
	"billing_contact_name" text,
	"billing_contact_email" text,
	"billing_contact_phone" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collection_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"staff_id" integer,
	"channel" text NOT NULL,
	"note" text NOT NULL,
	"next_action_at" date,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"client_id" integer,
	"space_id" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"monthly_fee" integer NOT NULL,
	"billing_day" integer DEFAULT 5 NOT NULL,
	"deposit_amount" integer DEFAULT 0 NOT NULL,
	"billing_document_type" text DEFAULT 'boleta' NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"label" text NOT NULL,
	"document_type" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"expires_at" date,
	"notes" text,
	"assigned_staff_id" integer,
	"next_action_at" date,
	"reviewed_by_staff_id" integer,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_cafs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"environment" text NOT NULL,
	"dte_type" integer NOT NULL,
	"folio_from" integer NOT NULL,
	"folio_to" integer NOT NULL,
	"next_folio" integer NOT NULL,
	"caf_xml_encrypted" text NOT NULL,
	"authorized_at" text NOT NULL,
	"expires_at" text,
	"status" text DEFAULT 'active' NOT NULL,
	"uploaded_by_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_certificates" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"pfx_encrypted" text NOT NULL,
	"password_encrypted" text NOT NULL,
	"subject_rut" text,
	"subject_name" text,
	"issuer" text,
	"serial_number" text,
	"fingerprint" text NOT NULL,
	"valid_from" text NOT NULL,
	"valid_to" text NOT NULL,
	"active" integer DEFAULT 1 NOT NULL,
	"uploaded_by_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"environment" text NOT NULL,
	"dte_type" integer NOT NULL,
	"folio" integer NOT NULL,
	"caf_id" integer,
	"issued_at" text NOT NULL,
	"client_id" integer,
	"receptor_rut" text,
	"receptor_razon" text,
	"receptor_giro" text,
	"receptor_direccion" text,
	"receptor_comuna" text,
	"neto" integer DEFAULT 0 NOT NULL,
	"exento" integer DEFAULT 0 NOT NULL,
	"iva" integer DEFAULT 0 NOT NULL,
	"total" integer NOT NULL,
	"items_json" text NOT NULL,
	"references_json" text,
	"dte_xml" text,
	"ted_xml" text,
	"pdf_key" text,
	"source_type" text,
	"source_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"status_detail" text,
	"envio_id" integer,
	"track_id" text,
	"created_by_staff_id" integer,
	"send_attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_envios" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"environment" text NOT NULL,
	"kind" text NOT NULL,
	"xml_signed" text NOT NULL,
	"document_count" integer NOT NULL,
	"track_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"sii_status_code" text,
	"sii_response_json" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"document_id" integer,
	"envio_id" integer,
	"event_type" text NOT NULL,
	"status" text,
	"message" text,
	"payload_json" text,
	"staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dte_settings" (
	"tenant_id" integer PRIMARY KEY NOT NULL,
	"environment" text DEFAULT 'certificacion' NOT NULL,
	"status" text DEFAULT 'unconfigured' NOT NULL,
	"rut_emisor" text,
	"razon_social" text,
	"giro" text,
	"acteco_json" text,
	"direccion" text,
	"comuna" text,
	"ciudad" text,
	"codigo_sucursal_sii" integer,
	"resolucion_numero" integer,
	"resolucion_fecha" text,
	"rut_envia" text,
	"sii_unidad" text,
	"auto_emit_boleta" integer DEFAULT 1 NOT NULL,
	"live_since" timestamp with time zone,
	"connection_ok" integer,
	"connection_checked_at" timestamp with time zone,
	"connection_message" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"cost_center" text DEFAULT 'general' NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_rut" text,
	"description" text NOT NULL,
	"amount_net" integer DEFAULT 0 NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"amount_total" integer NOT NULL,
	"document_type" text DEFAULT 'invoice' NOT NULL,
	"document_number" text,
	"payment_method" text,
	"payment_status" text DEFAULT 'pending' NOT NULL,
	"paid_at" date,
	"due_date" date,
	"bank_movement_id" integer,
	"receipt_file_path" text,
	"receipt_file_name" text,
	"receipt_mime_type" text,
	"notes" text,
	"approval_status" text DEFAULT 'pending' NOT NULL,
	"approved_by_staff_id" integer,
	"approved_at" timestamp with time zone,
	"approval_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "financial_budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"planned_amount" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guard_shift_log_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"shift_log_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"task_id" integer,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"related_space_id" integer,
	"related_access_log_id" integer,
	"follow_up_required" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "guard_shift_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"staff_id" integer NOT NULL,
	"cash_session_id" integer,
	"shift_date" date NOT NULL,
	"shift_name" text DEFAULT 'custom' NOT NULL,
	"opening_notes" text,
	"handover_notes" text,
	"cash_count_note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now(),
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"folio" integer NOT NULL,
	"type" text NOT NULL,
	"client_id" integer,
	"payment_id" integer,
	"contract_id" integer,
	"amount" integer NOT NULL,
	"date" timestamp with time zone DEFAULT now(),
	"status_sii" text DEFAULT 'accepted' NOT NULL,
	"provider" text DEFAULT 'local_mock',
	"provider_mode" text DEFAULT 'mock',
	"external_id" text,
	"track_id" text,
	"status_detail" text,
	"rejection_reason" text,
	"validation_errors_json" text,
	"sii_payload_json" text,
	"sii_response_json" text,
	"pdf_content" text,
	"xml_content" text,
	"issued_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "monthly_finance_closures" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'closed' NOT NULL,
	"closed_by_staff_id" integer,
	"closed_at" timestamp with time zone DEFAULT now(),
	"accepted_pending_note" text,
	"monthly_snapshot_json" text NOT NULL,
	"operational_snapshot_json" text NOT NULL,
	"reopened_by_staff_id" integer,
	"reopened_at" timestamp with time zone,
	"reopened_reason" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "operational_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"title" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'general' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_staff_id" integer,
	"source_type" text,
	"source_id" text,
	"due_date" date,
	"completed_at" timestamp with time zone,
	"completed_note" text,
	"created_by_staff_id" integer,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"staff_id" integer,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"previous_amount" integer NOT NULL,
	"new_amount" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"payment_id" integer NOT NULL,
	"bank_movement_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"note" text,
	"reversed_at" timestamp with time zone,
	"reversed_note" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"contract_id" integer,
	"amount" integer NOT NULL,
	"due_date" date NOT NULL,
	"payment_date" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"reference" text,
	"receipt_file_path" text,
	"receipt_file_name" text,
	"receipt_mime_type" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"max_branches" integer,
	"max_spaces" integer,
	"max_users" integer,
	"monthly_ticket_limit" integer,
	"price_clp" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "schema_migrations" (
	"id" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shift_log_entry_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"shift_log_entry_id" integer NOT NULL,
	"staff_id" integer,
	"label" text,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sii_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"invoice_id" integer NOT NULL,
	"staff_id" integer,
	"provider" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"payload_json" text,
	"response_json" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "space_map_regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"map_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"geometry_json" text NOT NULL,
	"label" text,
	"color" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "space_maps" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"image_file_path" text NOT NULL,
	"image_file_name" text NOT NULL,
	"image_mime_type" text NOT NULL,
	"image_width" integer NOT NULL,
	"image_height" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "space_status_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"space_id" integer NOT NULL,
	"staff_id" integer,
	"previous_status" text,
	"status" text NOT NULL,
	"reason" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"type" text DEFAULT 'parking' NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"price" integer NOT NULL,
	"notes" text,
	"location" text,
	"level" text,
	"width_m" double precision,
	"length_m" double precision,
	"height_m" double precision,
	"features" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rut" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"password_hash" text,
	"last_access" timestamp with time zone,
	"must_change_password" integer DEFAULT 0 NOT NULL,
	"password_changed_at" timestamp with time zone,
	"totp_secret" text,
	"totp_enabled" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_access_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"staff_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"plan_id" integer NOT NULL,
	"status" text DEFAULT 'trialing' NOT NULL,
	"current_period_start" date,
	"current_period_end" date,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"comment_id" integer,
	"staff_id" integer,
	"label" text,
	"file_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"task_id" integer NOT NULL,
	"staff_id" integer,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"staff_id" integer NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" integer PRIMARY KEY NOT NULL,
	"grace_days" integer DEFAULT 5 NOT NULL,
	"late_interest" double precision DEFAULT 1.5 NOT NULL,
	"overdue_recovery_rate" double precision DEFAULT 60 NOT NULL,
	"company_name" text,
	"company_rut" text,
	"company_address" text,
	"sii_api_key" text,
	"bank_api_key" text,
	"sii_provider" text DEFAULT 'local_mock' NOT NULL,
	"sii_mode" text DEFAULT 'mock' NOT NULL,
	"sii_environment" text DEFAULT 'demo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rut" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "totems" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"status" text DEFAULT 'online' NOT NULL,
	"maintenance_mode" integer DEFAULT 0 NOT NULL,
	"last_heartbeat" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"client_id" integer,
	"plate" text NOT NULL,
	"brand" text,
	"model" text,
	"color" text,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"archived_at" timestamp with time zone,
	"archive_reason" text
);
--> statement-breakpoint
CREATE TABLE "visitor_passes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"name" text NOT NULL,
	"rut" text NOT NULL,
	"type" text NOT NULL,
	"reason" text,
	"plate" text,
	"phone" text,
	"company" text,
	"authorized_by" text,
	"associated_space_id" integer,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone NOT NULL,
	"qr_token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "visitor_passes_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "visitor_ticket_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"ticket_id" integer NOT NULL,
	"rate_id" integer,
	"rate_label" text NOT NULL,
	"rate_per_hour" integer DEFAULT 0 NOT NULL,
	"rate_per_minute" integer DEFAULT 0 NOT NULL,
	"billing_mode" text DEFAULT 'per_minute' NOT NULL,
	"grace_period_mins" integer DEFAULT 0 NOT NULL,
	"entry_time" timestamp with time zone NOT NULL,
	"quote_time" timestamp with time zone NOT NULL,
	"duration_mins" integer DEFAULT 0 NOT NULL,
	"billable_mins" integer DEFAULT 0 NOT NULL,
	"subtotal" integer DEFAULT 0 NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"rounding_increment" integer DEFAULT 100 NOT NULL,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'quoted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "visitor_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"branch_id" integer,
	"plate" text,
	"entry_time" timestamp with time zone DEFAULT now(),
	"exit_time" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"amount" integer DEFAULT 0 NOT NULL,
	"quoted_amount" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"payment_method" text,
	"payment_override_reason" text,
	"space_id" integer,
	"quote_id" integer,
	"cash_session_id" integer,
	"created_by_staff_id" integer,
	"paid_by_staff_id" integer,
	"completed_by_staff_id" integer,
	"entry_method" text DEFAULT 'manual' NOT NULL,
	"receipt_file_path" text,
	"receipt_file_name" text,
	"receipt_mime_type" text
);
--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rates" ADD CONSTRAINT "access_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_rates" ADD CONSTRAINT "access_rates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_password_resets" ADD CONSTRAINT "auth_password_resets_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_movements" ADD CONSTRAINT "bank_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_closures" ADD CONSTRAINT "cash_session_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_closures" ADD CONSTRAINT "cash_session_closures_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_session_closures" ADD CONSTRAINT "cash_session_closures_closed_by_staff_id_staff_id_fk" FOREIGN KEY ("closed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_shift_log_id_guard_shift_logs_id_fk" FOREIGN KEY ("shift_log_id") REFERENCES "public"."guard_shift_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reviewed_by_staff_id_staff_id_fk" FOREIGN KEY ("reviewed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_cafs" ADD CONSTRAINT "dte_cafs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_certificates" ADD CONSTRAINT "dte_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_documents" ADD CONSTRAINT "dte_documents_caf_id_dte_cafs_id_fk" FOREIGN KEY ("caf_id") REFERENCES "public"."dte_cafs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_envios" ADD CONSTRAINT "dte_envios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_events" ADD CONSTRAINT "dte_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_events" ADD CONSTRAINT "dte_events_document_id_dte_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."dte_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_events" ADD CONSTRAINT "dte_events_envio_id_dte_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."dte_envios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dte_settings" ADD CONSTRAINT "dte_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_bank_movement_id_bank_movements_id_fk" FOREIGN KEY ("bank_movement_id") REFERENCES "public"."bank_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_staff_id_staff_id_fk" FOREIGN KEY ("approved_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_budgets" ADD CONSTRAINT "financial_budgets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_shift_log_id_guard_shift_logs_id_fk" FOREIGN KEY ("shift_log_id") REFERENCES "public"."guard_shift_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_task_id_operational_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."operational_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_related_space_id_spaces_id_fk" FOREIGN KEY ("related_space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_log_entries" ADD CONSTRAINT "guard_shift_log_entries_related_access_log_id_access_logs_id_fk" FOREIGN KEY ("related_access_log_id") REFERENCES "public"."access_logs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_logs" ADD CONSTRAINT "guard_shift_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_logs" ADD CONSTRAINT "guard_shift_logs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guard_shift_logs" ADD CONSTRAINT "guard_shift_logs_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_finance_closures" ADD CONSTRAINT "monthly_finance_closures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_finance_closures" ADD CONSTRAINT "monthly_finance_closures_closed_by_staff_id_staff_id_fk" FOREIGN KEY ("closed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_finance_closures" ADD CONSTRAINT "monthly_finance_closures_reopened_by_staff_id_staff_id_fk" FOREIGN KEY ("reopened_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_assigned_staff_id_staff_id_fk" FOREIGN KEY ("assigned_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_tasks" ADD CONSTRAINT "operational_tasks_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_adjustments" ADD CONSTRAINT "payment_adjustments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_bank_movement_id_bank_movements_id_fk" FOREIGN KEY ("bank_movement_id") REFERENCES "public"."bank_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_log_entry_attachments" ADD CONSTRAINT "shift_log_entry_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_log_entry_attachments" ADD CONSTRAINT "shift_log_entry_attachments_shift_log_entry_id_guard_shift_log_entries_id_fk" FOREIGN KEY ("shift_log_entry_id") REFERENCES "public"."guard_shift_log_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_log_entry_attachments" ADD CONSTRAINT "shift_log_entry_attachments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sii_events" ADD CONSTRAINT "sii_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sii_events" ADD CONSTRAINT "sii_events_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sii_events" ADD CONSTRAINT "sii_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_map_regions" ADD CONSTRAINT "space_map_regions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_map_regions" ADD CONSTRAINT "space_map_regions_map_id_space_maps_id_fk" FOREIGN KEY ("map_id") REFERENCES "public"."space_maps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_map_regions" ADD CONSTRAINT "space_map_regions_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_maps" ADD CONSTRAINT "space_maps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_maps" ADD CONSTRAINT "space_maps_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_status_history" ADD CONSTRAINT "space_status_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_status_history" ADD CONSTRAINT "space_status_history_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_status_history" ADD CONSTRAINT "space_status_history_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_events" ADD CONSTRAINT "staff_access_events_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_operational_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."operational_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_comment_id_task_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."task_comments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_id_operational_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."operational_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totems" ADD CONSTRAINT "totems_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "totems" ADD CONSTRAINT "totems_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_passes" ADD CONSTRAINT "visitor_passes_associated_space_id_spaces_id_fk" FOREIGN KEY ("associated_space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_ticket_quotes" ADD CONSTRAINT "visitor_ticket_quotes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_ticket_quotes" ADD CONSTRAINT "visitor_ticket_quotes_ticket_id_visitor_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."visitor_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_ticket_quotes" ADD CONSTRAINT "visitor_ticket_quotes_rate_id_access_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."access_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_cash_session_id_cash_sessions_id_fk" FOREIGN KEY ("cash_session_id") REFERENCES "public"."cash_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_created_by_staff_id_staff_id_fk" FOREIGN KEY ("created_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_paid_by_staff_id_staff_id_fk" FOREIGN KEY ("paid_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_tickets" ADD CONSTRAINT "visitor_tickets_completed_by_staff_id_staff_id_fk" FOREIGN KEY ("completed_by_staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_access_logs_tenant" ON "access_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_access_logs_branch_time" ON "access_logs" USING btree ("branch_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_access_rates_tenant_branch_type" ON "access_rates" USING btree ("tenant_id","branch_id","type");--> statement-breakpoint
CREATE INDEX "idx_access_rates_tenant" ON "access_rates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_events_tenant" ON "audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_audit_events_created_at" ON "audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_events_entity" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_auth_login_attempts_reset_at" ON "auth_login_attempts" USING btree ("reset_at");--> statement-breakpoint
CREATE INDEX "idx_auth_password_resets_staff" ON "auth_password_resets" USING btree ("staff_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires_at" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_bank_movements_tenant" ON "bank_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_bank_movements_branch_status" ON "bank_movements" USING btree ("branch_id","status","date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_branches_tenant_code" ON "branches" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "idx_branches_tenant" ON "branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_branches_status" ON "branches" USING btree ("status","name");--> statement-breakpoint
CREATE INDEX "idx_cash_movements_tenant" ON "cash_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cash_movements_session" ON "cash_movements" USING btree ("cash_session_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_cash_movements_unique_source" ON "cash_movements" USING btree ("tenant_id","source_type","source_id","direction") WHERE "cash_movements"."direction" = 'in';--> statement-breakpoint
CREATE INDEX "idx_cash_session_closures_tenant" ON "cash_session_closures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cash_sessions_tenant" ON "cash_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_cash_sessions_branch_status" ON "cash_sessions" USING btree ("branch_id","status","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_clients_tenant_rut" ON "clients" USING btree ("tenant_id","rut");--> statement-breakpoint
CREATE INDEX "idx_clients_tenant" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_clients_status" ON "clients" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_collection_actions_tenant" ON "collection_actions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_collection_actions_payment" ON "collection_actions" USING btree ("payment_id","status");--> statement-breakpoint
CREATE INDEX "idx_collection_actions_next" ON "collection_actions" USING btree ("status","next_action_at");--> statement-breakpoint
CREATE INDEX "idx_contracts_tenant" ON "contracts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_contracts_branch_status" ON "contracts" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_documents_tenant" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_documents_entity" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_documents_follow_up" ON "documents" USING btree ("status","next_action_at","assigned_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dte_cafs_range" ON "dte_cafs" USING btree ("tenant_id","environment","dte_type","folio_from");--> statement-breakpoint
CREATE INDEX "idx_dte_cafs_lookup" ON "dte_cafs" USING btree ("tenant_id","environment","dte_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dte_certificates_fingerprint" ON "dte_certificates" USING btree ("tenant_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_dte_certificates_tenant_active" ON "dte_certificates" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dte_documents_folio" ON "dte_documents" USING btree ("tenant_id","environment","dte_type","folio");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_dte_documents_source" ON "dte_documents" USING btree ("tenant_id","environment","source_type","source_id","dte_type") WHERE "dte_documents"."source_type" IS NOT NULL AND "dte_documents"."source_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_dte_documents_status" ON "dte_documents" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "idx_dte_envios_pending" ON "dte_envios" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_dte_events_document" ON "dte_events" USING btree ("tenant_id","document_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_expenses_tenant" ON "expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_expenses_date" ON "expenses" USING btree ("date");--> statement-breakpoint
CREATE INDEX "idx_expenses_status" ON "expenses" USING btree ("payment_status","due_date");--> statement-breakpoint
CREATE INDEX "idx_expenses_category" ON "expenses" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_financial_budgets_tenant_month_cat" ON "financial_budgets" USING btree ("tenant_id","month","category");--> statement-breakpoint
CREATE INDEX "idx_financial_budgets_tenant_month" ON "financial_budgets" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "idx_guard_shift_entries_tenant" ON "guard_shift_log_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_guard_shift_entries_shift" ON "guard_shift_log_entries" USING btree ("shift_log_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_guard_shift_logs_tenant" ON "guard_shift_logs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_guard_shift_logs_status" ON "guard_shift_logs" USING btree ("status","shift_date");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_invoices_tenant_type_folio" ON "invoices" USING btree ("tenant_id","type","folio");--> statement-breakpoint
CREATE INDEX "idx_invoices_tenant" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_payment" ON "invoices" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "idx_invoices_contract" ON "invoices" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_monthly_finance_closures_tenant_month" ON "monthly_finance_closures" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "idx_monthly_finance_closures_tenant_month" ON "monthly_finance_closures" USING btree ("tenant_id","month");--> statement-breakpoint
CREATE INDEX "idx_operational_tasks_tenant" ON "operational_tasks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_operational_tasks_status" ON "operational_tasks" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "idx_payment_adjustments_tenant_payment" ON "payment_adjustments" USING btree ("tenant_id","payment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_tenant" ON "payment_allocations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_active_payment" ON "payment_allocations" USING btree ("payment_id","reversed_at");--> statement-breakpoint
CREATE INDEX "idx_payment_allocations_active_movement" ON "payment_allocations" USING btree ("bank_movement_id","reversed_at");--> statement-breakpoint
CREATE INDEX "idx_payments_tenant" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_payments_branch_status" ON "payments" USING btree ("branch_id","status","due_date");--> statement-breakpoint
CREATE INDEX "idx_shift_entry_attachments_tenant_entry" ON "shift_log_entry_attachments" USING btree ("tenant_id","shift_log_entry_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sii_events_tenant" ON "sii_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_sii_events_invoice" ON "sii_events" USING btree ("invoice_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_space_map_regions_tenant_map_space" ON "space_map_regions" USING btree ("tenant_id","map_id","space_id");--> statement-breakpoint
CREATE INDEX "idx_space_map_regions_map" ON "space_map_regions" USING btree ("tenant_id","map_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_space_map_regions_space" ON "space_map_regions" USING btree ("tenant_id","space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_space_maps_tenant_branch_name" ON "space_maps" USING btree ("tenant_id","branch_id","name");--> statement-breakpoint
CREATE INDEX "idx_space_maps_tenant_branch" ON "space_maps" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "idx_space_maps_default" ON "space_maps" USING btree ("tenant_id","branch_id","is_default");--> statement-breakpoint
CREATE INDEX "idx_space_status_history_tenant" ON "space_status_history" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_space_status_history_space" ON "space_status_history" USING btree ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_spaces_tenant" ON "spaces" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_spaces_branch_status" ON "spaces" USING btree ("branch_id","status","type");--> statement-breakpoint
CREATE INDEX "idx_staff_role_status" ON "staff" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "idx_staff_access_events_staff" ON "staff_access_events" USING btree ("staff_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_staff_access_events_created" ON "staff_access_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_tenant_status" ON "subscriptions" USING btree ("tenant_id","status","current_period_end");--> statement-breakpoint
CREATE INDEX "idx_task_attachments_tenant_task" ON "task_attachments" USING btree ("tenant_id","task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_task_comments_tenant_task" ON "task_comments" USING btree ("tenant_id","task_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_tenant_memberships_tenant_staff" ON "tenant_memberships" USING btree ("tenant_id","staff_id");--> statement-breakpoint
CREATE INDEX "idx_tenant_memberships_staff" ON "tenant_memberships" USING btree ("staff_id","status");--> statement-breakpoint
CREATE INDEX "idx_totems_tenant" ON "totems" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vehicles_tenant_plate" ON "vehicles" USING btree ("tenant_id","plate");--> statement-breakpoint
CREATE INDEX "idx_vehicles_client" ON "vehicles" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_vehicles_status_client" ON "vehicles" USING btree ("status","client_id");--> statement-breakpoint
CREATE INDEX "idx_visitor_passes_tenant" ON "visitor_passes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_visitor_ticket_quotes_tenant" ON "visitor_ticket_quotes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_visitor_ticket_quotes_ticket" ON "visitor_ticket_quotes" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_visitor_tickets_tenant" ON "visitor_tickets" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_visitor_tickets_branch_status" ON "visitor_tickets" USING btree ("branch_id","status","entry_time");