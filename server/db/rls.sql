-- ============================================================================
-- Parkia v2 - Row Level Security (RLS) Multi-Tenant
-- ============================================================================
-- Modelo (Seccion 1.4 de docs/PARKIA_PLAN_V2.md):
-- 1. Cada peticion autenticada abre una transaccion y ejecuta:
--      SET LOCAL app.tenant_id = '<tenant_id>';
-- 2. Todas las tablas de negocio con tenant_id tienen RLS + FORCE RLS activo
--    con la politica:
--      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::integer
-- 3. Si app.tenant_id no esta seteado, NULLIF devuelve NULL y ninguna fila
--    coincide (fail-closed).
-- ============================================================================

CREATE OR REPLACE FUNCTION current_app_tenant_id() RETURNS integer
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer;
$$;

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'tenant_settings',
    'branches',
    'clients',
    'vehicles',
    'spaces',
    'space_status_history',
    'space_maps',
    'space_map_regions',
    'contracts',
    'payments',
    'bank_movements',
    'payment_allocations',
    'payment_adjustments',
    'collection_actions',
    'expenses',
    'financial_budgets',
    'monthly_finance_closures',
    'invoices',
    'sii_events',
    'access_rates',
    'guard_shift_logs',
    'guard_shift_log_entries',
    'shift_log_entry_attachments',
    'cash_sessions',
    'cash_movements',
    'cash_session_closures',
    'visitor_tickets',
    'visitor_ticket_quotes',
    'visitor_passes',
    'access_logs',
    'totems',
    'operational_tasks',
    'task_comments',
    'task_attachments',
    'documents',
    'audit_events',
    'dte_settings',
    'dte_certificates',
    'dte_cafs',
    'dte_documents',
    'dte_envios',
    'dte_events'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', tbl);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I
           AS PERMISSIVE
           FOR ALL
           USING (tenant_id = current_app_tenant_id())
           WITH CHECK (tenant_id = current_app_tenant_id())',
        tbl
      );
    END IF;
  END LOOP;
END
$$;

