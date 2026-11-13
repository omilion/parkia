# PostgreSQL en Parkia

Parkia corre sobre PostgreSQL 16 en producción. SQLite sigue disponible para desarrollo local y como origen de la migración inicial.

## Cómo funciona

- **Una sola forma de acceder a datos.** `server/db.ts` entrega `db` con la misma forma que antes (`db.prepare(sql).get/all/run`, `db.transaction`), pero asíncrona. El motor se elige con `PARKIA_DB_ENGINE`:

  | Valor | Uso |
  |---|---|
  | `postgres` | Producción. Servidor PostgreSQL 16. |
  | `pglite` | PostgreSQL embebido, en memoria o en `PARKIA_PGLITE_DIR`. Lo usan las pruebas. |
  | `sqlite` | Desarrollo local (por omisión). |

- **El SQL se escribe una vez.** Las consultas están en el dialecto que la app ya usaba. El motor Postgres las traduce (`server/db/engine/translate.ts`): parámetros, funciones de fecha, `MAX(a, b)`, `GROUP_CONCAT`, `LIKE` sin distinguir mayúsculas, `INSERT OR IGNORE`, `printf`.
- **Aislamiento por empresa en la base (RLS).** Cada petición autenticada corre con el rol `parkia_app` y la empresa fijada en `app.tenant_id`. Las políticas de `server/db/rls.sql` limitan cada consulta a esa empresa aunque el SQL olvide filtrar. Sin empresa en contexto (inicio de sesión, trabajos de plataforma) se usa el rol administrador.
- **Esquema.** Se define en Drizzle (`server/db/schema/index.ts`) y se versiona en `server/db/migrations`. Al arrancar, la app:
  1. aplica las migraciones pendientes, con un bloqueo para que varias instancias puedan arrancar a la vez;
  2. aplica `server/db/postgres-extra.sql` (reglas equivalentes a los disparadores de SQLite);
  3. aplica `server/db/rls.sql`;
  4. otorga los permisos a `parkia_app`;
  5. crea los datos base (planes, empresa, sucursal y tarifas por defecto).
- **Fechas.** Todo en UTC. Las fechas y horas se entregan como `YYYY-MM-DD HH:MM:SS`, igual que en SQLite.

## Instalación del servidor

1. PostgreSQL 16 (paquete del sistema o `docker compose up -d postgres`; en local, si el 5432 está ocupado: `POSTGRES_PORT=55432 docker compose up -d postgres`).
2. Crear la base y los roles con `deploy/postgres/init-roles.sql`, y **cambiar la clave de `parkia_app`**:

   ```sql
   ALTER ROLE parkia_app PASSWORD 'clave-larga-y-unica';
   ```

   El rol administrador (`parkia_admin`) debe ser dueño de la base y superusuario o `BYPASSRLS`, porque las tablas tienen RLS forzado. `parkia_app` nunca debe tener `BYPASSRLS`.
3. En `/etc/parkia/parkia.env` (ver `.env.production.example`):

   ```
   PARKIA_DB_ENGINE=postgres
   DATABASE_URL=postgresql://parkia_app:...@127.0.0.1:5432/parkia
   PARKIA_PG_ADMIN_URL=postgresql://parkia_admin:...@127.0.0.1:5432/parkia
   PARKIA_PG_CREATE_APP_ROLE=false
   ```

4. Reiniciar el servicio. El primer arranque crea el esquema completo.

## Migrar una instalación existente desde SQLite

Con la app detenida (o en mantenimiento), para que no entren datos nuevos durante la copia:

```bash
# 1. Respaldo de la base SQLite y los archivos (por si hay que volver atrás)
scripts/backup-data.sh

# 2. Copia a PostgreSQL. Aplica el esquema, copia las 51 tablas y verifica conteos,
#    sumas de montos por empresa y que todas las tablas tengan RLS. Falla si algo no cuadra.
PARKIA_DB_PATH=/var/lib/parkia/parkia.db \
PARKIA_PG_ADMIN_URL=postgresql://parkia_admin:...@127.0.0.1:5432/parkia \
npx tsx scripts/migrate-sqlite-to-pg.ts > migracion.json

# 3. Cambiar PARKIA_DB_ENGINE=postgres y arrancar la app

# 4. Revisar que todos los endpoints de lectura respondan sin errores
PARKIA_DB_ENGINE=postgres DATABASE_URL=... PARKIA_PG_ADMIN_URL=... \
ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run smoke:api
```

El script de copia es idempotente: vacía las tablas de destino antes de copiar, así que se puede repetir.

**Vuelta atrás:** volver a `PARKIA_DB_ENGINE=sqlite` con el archivo SQLite original. Los datos ingresados después del cambio quedan solo en PostgreSQL.

## Respaldos

- `scripts/backup-postgres.sh` hace `pg_dump` (formato custom) más los archivos adjuntos en un solo archivo `parkia-pg-AAAAMMDDTHHMMSSZ.tar.gz`. La tarea diaria (03:30) está en `deploy/cron/parkia-backup`. Guarda 30 días por omisión (`PARKIA_BACKUP_RETENTION_DAYS`).
- **Cifrado.** Con `PARKIA_BACKUP_PASSPHRASE_FILE` (un archivo con una frase larga, permisos `600`) el respaldo se cifra con `gpg` (AES-256, con verificación de integridad) y queda como `.tar.gz.gpg`. **Guarda esa frase fuera del servidor** (gestor de claves): sin ella los respaldos cifrados no se pueden abrir. Una base de datos de clientes (RUT, patentes, pagos) no debería viajar ni dormir sin cifrar.
- **Copia fuera del servidor.** Con `PARKIA_S3_BACKUP_BUCKET` (y opcional `PARKIA_S3_ENDPOINT` para proveedores compatibles con S3: Backblaze, Hetzner, Wasabi, R2) cada respaldo se copia a ese bucket, **que debe ser distinto al de los archivos**. Necesita la CLI `aws` y las credenciales `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` en el entorno. **El script se niega a subir un respaldo sin cifrar.** Si la subida falla, el respaldo local se conserva y el script termina con error (queda en `/var/log/parkia-backup.log`). La retención remota la define el bucket (regla de ciclo de vida); recomendado: 30 días diarios y 12 meses mensuales.
- Cada respaldo trae un `.sha256`; el archivo se arma en una carpeta oculta y se mueve al final, así que uno a medias nunca aparece como "el último". El chequeo de salud (`/api/health/details`) reconoce estos archivos y avisa si el último tiene más de 24 horas.
- **Verificar (semanal, automático los domingos 05:00):**

  ```bash
  PARKIA_BACKUP_PASSPHRASE_FILE=/etc/parkia/backup.key     scripts/restore-postgres.sh --verify /var/backups/parkia/parkia-pg-AAAAMMDDTHHMMSSZ.tar.gz.gpg
  ```

  Comprueba el hash, descifra, restaura en una base temporal del mismo servidor, exige que tenga empresas y la borra. No toca producción. Un respaldo que nunca se restauró no es un respaldo.
- **Restaurar de verdad** (pide confirmar el nombre de la base para no pisar la equivocada):

  ```bash
  CONFIRM_RESTORE_INTO=parkia PARKIA_RESTORE_STORAGE_DIR=/var/lib/parkia   PARKIA_BACKUP_PASSPHRASE_FILE=/etc/parkia/backup.key     scripts/restore-postgres.sh parkia-pg-AAAAMMDDTHHMMSSZ.tar.gz.gpg "$PARKIA_PG_ADMIN_URL"
  ```

  Con `PARKIA_RESTORE_STORAGE_DIR` también extrae la carpeta `storage/` de los adjuntos. Sin cifrado el procedimiento es el mismo, sobre el `.tar.gz`.
- **Qué se probó.** Se ejecutó el ciclo completo contra PostgreSQL real con `gpg` real: respaldo cifrado, copia, verificación, clave incorrecta (rechazada), archivo alterado (detectado por el hash), negativa a restaurar sin confirmación, restauración con comparación de datos y adjuntos, y retención. **La CLI `aws` se simuló**: antes de depender de ella, haz una subida real a tu bucket y comprueba el archivo allí.
- **Exportación por empresa.** El administrador de cada empresa descarga sus datos en un ZIP de CSV desde `GET /api/tenant/export` (portabilidad; no sustituye al respaldo).

- Los respaldos desde la pantalla de Configuración son solo de SQLite. Con PostgreSQL responden 501 y remiten a este procedimiento.
- Se probó el ciclo completo: respaldo, restauración en una base nueva y comparación de datos.

## Pruebas

| Comando | Motor |
|---|---|
| `npm test`, `npm run test:dte` | SQLite |
| `npm run test:pglite`, `npm run test:dte:pglite`, `npm run test:e2e:pglite` | PostgreSQL embebido |
| `npm run test:postgres`, `npm run test:e2e:postgres` | PostgreSQL real; crea una base desechable por corrida (`PARKIA_TEST_PG_ADMIN_URL`, por omisión el de docker-compose en el puerto 55432) |
| `npm run db:compare-schemas` | Verifica que el esquema de Postgres tenga todas las tablas y columnas de SQLite |

`npm run verify` (y el CI) corre SQLite, PostgreSQL embebido y la comparación de esquemas. El CI además corre la suite de API contra un PostgreSQL 16 real.

## Cambios de esquema

1. Editar `server/db/schema/index.ts`.
2. `npm run db:generate -- --name descripcion` genera la migración en `server/db/migrations`. Revisarla: los cambios de tipo de texto a fecha necesitan `USING`.
3. Mientras SQLite siga en uso, agregar el cambio equivalente en `server/db/schema.ts`.
4. `npm run db:compare-schemas` confirma que ambos esquemas coinciden.

## Límites conocidos

- Las columnas que la app trata como sí/no son enteros 0/1 en ambos motores (no `boolean`).
- Si un `INSERT` no trae `tenant_id`, se asigna la empresa de la sesión o, sin sesión, la primera empresa, igual que hacía SQLite. El código de la app siempre lo envía; la regla existe por compatibilidad.
- El traductor cubre lo que la app usa hoy. Una construcción de SQLite nueva que no reconozca falla de forma visible en las pruebas sobre Postgres, que corren en el CI.
