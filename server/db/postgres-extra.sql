-- ============================================================================
-- Parkia - reglas en PostgreSQL equivalentes a los disparadores de SQLite.
-- Idempotente: se aplica en cada arranque despues de las migraciones de Drizzle.
-- ============================================================================

-- Las fechas de la app son UTC.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET TimeZone TO ''UTC''', current_database());
END
$$;

-- 1. Empresa por defecto: si un INSERT no trae tenant_id, se usa la empresa de la sesion
--    (app.tenant_id) y, sin sesion, la primera empresa (igual que en SQLite). Corre antes
--    de la validacion NOT NULL y de la politica RLS.
CREATE OR REPLACE FUNCTION parkia_default_tenant_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := COALESCE(
      NULLIF(current_setting('app.tenant_id', true), '')::integer,
      (SELECT id FROM tenants ORDER BY id ASC LIMIT 1)
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      AND c.table_name NOT IN ('tenant_memberships', 'subscriptions', 'tenant_settings', 'dte_settings')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_tenant_default ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_tenant_default BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION parkia_default_tenant_id()',
      tbl, tbl
    );
  END LOOP;
END
$$;

-- 2. Solo se permiten estacionamientos como espacio operativo.
CREATE OR REPLACE FUNCTION parkia_spaces_only_parking() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM 'parking' THEN
    RAISE EXCEPTION 'Solo se permiten estacionamientos';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_spaces_only_parking ON spaces;
CREATE TRIGGER trg_spaces_only_parking BEFORE INSERT OR UPDATE OF type ON spaces
  FOR EACH ROW EXECUTE FUNCTION parkia_spaces_only_parking();

-- 3. updated_at automatico en mapas y regiones.
CREATE OR REPLACE FUNCTION parkia_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_space_maps_updated_at ON space_maps;
CREATE TRIGGER trg_space_maps_updated_at BEFORE UPDATE ON space_maps FOR EACH ROW EXECUTE FUNCTION parkia_touch_updated_at();
DROP TRIGGER IF EXISTS trg_space_map_regions_updated_at ON space_map_regions;
CREATE TRIGGER trg_space_map_regions_updated_at BEFORE UPDATE ON space_map_regions FOR EACH ROW EXECUTE FUNCTION parkia_touch_updated_at();
