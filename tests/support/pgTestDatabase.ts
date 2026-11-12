import pg from "pg";

/**
 * Con PARKIA_DB_ENGINE=postgres las pruebas usan un servidor PostgreSQL real. Cada corrida
 * crea su propia base desechable (nunca toca la base de desarrollo) y la elimina al terminar.
 *
 * Servidor: PARKIA_TEST_PG_ADMIN_URL (por defecto el de docker-compose en el puerto 55432).
 * Debe existir el rol parkia_app (deploy/postgres/init-roles.sql).
 */
export async function prepareTestDatabase(): Promise<(() => Promise<void>) | null> {
  if (process.env.PARKIA_DB_ENGINE !== "postgres") return null;

  const adminUrl = new URL(process.env.PARKIA_TEST_PG_ADMIN_URL || "postgresql://parkia_admin:parkia_admin_dev@127.0.0.1:55432/parkia");
  const name = `parkia_test_${process.pid}_${Date.now()}`;
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  // Bases de corridas anteriores que no alcanzaron a limpiar (p. ej. el servidor de Playwright
  // terminado a la fuerza en Windows): se borran si tienen mas de una hora.
  const stale = await admin.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE 'parkia\_test\_%'");
  for (const { datname } of stale.rows) {
    const createdAt = Number(datname.split("_").pop());
    if (Number.isFinite(createdAt) && Date.now() - createdAt > 3_600_000) await admin.query(`DROP DATABASE IF EXISTS ${datname} WITH (FORCE)`);
  }
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();

  const testAdminUrl = new URL(adminUrl.toString());
  testAdminUrl.pathname = `/${name}`;
  const appUrl = new URL(testAdminUrl.toString());
  appUrl.username = "parkia_app";
  appUrl.password = process.env.PARKIA_TEST_PG_APP_PASSWORD || "parkia_app_dev";
  process.env.PARKIA_PG_ADMIN_URL = testAdminUrl.toString();
  process.env.DATABASE_URL = appUrl.toString();

  return async () => {
    const cleanup = new pg.Client({ connectionString: adminUrl.toString() });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await cleanup.end();
  };
}
