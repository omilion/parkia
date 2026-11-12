-- Roles para aislamiento multi-tenant (Row Level Security)
-- parkia_admin (POSTGRES_USER): rol privilegiado para migraciones, jobs de plataforma y super-admin.
-- parkia_app: rol de aplicacion SIN BYPASSRLS ni SUPERUSER.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parkia_app') THEN
    CREATE ROLE parkia_app LOGIN PASSWORD 'parkia_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE parkia TO parkia_app;
GRANT USAGE ON SCHEMA public TO parkia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO parkia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO parkia_app;

