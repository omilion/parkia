ALTER TABLE "dte_cafs" ALTER COLUMN "authorized_at" SET DATA TYPE date USING NULLIF("authorized_at", '')::date;--> statement-breakpoint
ALTER TABLE "dte_cafs" ALTER COLUMN "expires_at" SET DATA TYPE date USING NULLIF("expires_at", '')::date;--> statement-breakpoint
ALTER TABLE "dte_documents" ALTER COLUMN "issued_at" SET DATA TYPE date USING NULLIF("issued_at", '')::date;--> statement-breakpoint
ALTER TABLE "dte_settings" ALTER COLUMN "resolucion_fecha" SET DATA TYPE date USING NULLIF("resolucion_fecha", '')::date;