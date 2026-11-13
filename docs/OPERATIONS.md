# Guia Operativa de Produccion

Esta guia define los pasos minimos para operar Parkia con datos reales.

## 1. Variables de Entorno

Para desarrollo local, crear `.env` desde `.env.example`.

Para produccion, crear `.env` desde `.env.production.example` y ajustar:

```bash
NODE_ENV=production
APP_URL=https://app.parkia.cl
TRUSTED_ORIGINS=
PORT=8080
HOST=127.0.0.1
PARKIA_DB_PATH=/var/lib/parkia/parkia.db
PARKIA_STORAGE_PATH=/var/lib/parkia/storage
PARKIA_BACKUP_PATH=/var/backups/parkia
PARKIA_SEED_DEMO=false
```

Reglas:

- `PARKIA_DB_PATH`, `PARKIA_STORAGE_PATH` y `PARKIA_BACKUP_PATH` deben apuntar a carpetas persistentes.
- En produccion, esas rutas deben ser absolutas.
- `PARKIA_SEED_DEMO=false` es obligatorio antes de cargar datos reales.
- `APP_URL` debe ser la URL publica que usaran los usuarios.
- `TRUSTED_ORIGINS` solo debe incluir dominios adicionales a `APP_URL`.
- En VPS con nginx/Caddy, `HOST=127.0.0.1` para no exponer Node directo a Internet.

## 2. Instalacion y Build

```bash
npm install
npm run lint
npm run build
npm test
```

No pasar a produccion si alguno falla.

## 3. Arranque

El servidor sirve la API y el frontend compilado cuando `NODE_ENV=production`.

```bash
npm start
```

En servidor real, ejecutar el proceso con un supervisor como systemd, PM2, Docker o el mecanismo que defina infraestructura.

Para VPS Ubuntu, usar la guia completa en [VPS_DEPLOYMENT.md](VPS_DEPLOYMENT.md). Incluye plantillas de systemd, nginx y backup diario.

Ejemplo Linux:

```bash
mkdir -p /var/lib/parkia/storage /var/backups/parkia
npm install
npm run build
NODE_ENV=production npm start
```

Ejemplo Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force C:\parkia\data, C:\parkia\storage, C:\parkia\backups
npm install
npm run build
$env:NODE_ENV="production"
npm start
```

## 3b. Tareas programadas, errores y 2FA

**Tareas programadas** (`server/platform/jobs`). Cada tarea corre a su hora, en horario de Santiago (campo `cron` de cada una: cobros 03:00, vencidos 03:10, limpieza de sesiones cada hora, SII/pagos/correo cada 15 min, suscripciones 04:00, retención Ley 21.719 04:30, UF 08:15). Cada ejecución queda en la tabla `job_runs` (estado, duración, resultado, error) y se conserva 30 días.
- Una ejecución programada tiene **una sola fila** (`UNIQUE(tarea, hora)`): quien la inserta primero la corre. Con dos copias del servidor, o un reinicio justo a esa hora, nunca se ejecuta dos veces.
- Si el servidor estuvo caído a la hora programada, al volver **recupera la última ejecución pendiente** (hasta 26 horas atrás).
- Una tarea que falla no detiene a las demás. El chequeo `jobs` de `/api/health/details` es crítico en producción si el planificador lleva más de 45 minutos sin ejecutar nada, y advierte si la última ejecución de alguna tarea falló.
- Para ver qué pasó: `SELECT job_name, status, started_at, duration_ms, error FROM job_runs ORDER BY id DESC LIMIT 50;`
- *No se usa pg-boss:* solo funciona con PostgreSQL y Parkia también corre con SQLite y el PostgreSQL embebido; este planificador usa la misma base y funciona igual en los tres.

**Errores y registros.** Los registros salen en JSON (`PARKIA_LOG_FORMAT=json`, por omisión en producción) con `request_id`, que también viaja en la cabecera `X-Request-Id` y en los errores 500: con él se encuentra la línea exacta. Con `PARKIA_SENTRY_DSN` los errores no capturados también se envían a Sentry, **sin cookies, cabeceras, cuerpos, query, IP ni usuario**, y con los tokens de las rutas reemplazados. El SDK se carga en segundo plano tras abrir el puerto (tarda varios segundos) y solo si hay DSN. Los errores del navegador no se reportan todavía.

**Verificación en dos pasos (administradores).** Cada administrador la activa desde el icono de escudo de la barra superior: escanea el QR con Google/Microsoft Authenticator o Authy, confirma un código y guarda los 8 códigos de recuperación (se muestran una sola vez; cada uno sirve una vez). El secreto se guarda cifrado con `PARKIA_MASTER_KEY`, un código no se puede reutilizar, y reconfigurar con el 2FA activo exige desactivarlo antes con la clave. **Si un administrador pierde el teléfono y los códigos**, otro administrador no puede restablecerlo desde la app; en la base: `UPDATE staff SET totp_enabled = 0, totp_secret = NULL, totp_recovery_codes = NULL, totp_last_step = NULL WHERE email = '...';` (verifica antes la identidad de la persona).

## 4. Healthcheck

Endpoint:

```http
GET /api/health
```

Debe responder:

- `status: "ok"`
- `database.ok: true`
- `storage.ok: true`
- `readiness.productionReady: true` antes de salida a produccion

Si `readiness.productionReady` es `false`, revisar los checks en Configuracion > Operacion.

Estados:

- `critical`: bloquea salida a produccion.
- `warning`: se puede revisar antes de salida, pero no siempre bloquea ambiente local.
- `ok`: configuracion validada.

## 5. Respaldos

Desde la app:

1. Ingresar como admin.
2. Ir a Configuracion > Operacion.
3. Presionar Crear respaldo.
4. Descargar el archivo desde Respaldos recientes.

API:

```http
POST /api/backups/database
GET /api/backups/database
GET /api/backups/database/:fileName
```

Los respaldos se guardan en `PARKIA_BACKUP_PATH`.

Rutina minima:

- Crear respaldo diario al cierre si no existe automatizacion externa.
- Descargar al menos un respaldo semanal y confirmar que abre como archivo SQLite valido.
- Respaldar tambien `PARKIA_STORAGE_PATH`, porque ahi viven documentos y adjuntos.
- Mantener al menos 30 dias de respaldos diarios mientras no exista politica formal.

## 6. Restauracion Manual

Para restaurar SQLite desde un respaldo comprimido:

1. Detener el servidor.
2. Respaldar el archivo actual por seguridad.
3. Descomprimir el archivo `.sqlite.gz` seleccionado.
4. Copiar el archivo `.sqlite` resultante sobre `PARKIA_DB_PATH`.
5. Levantar el servidor.
6. Validar `/api/health`.

Ejemplo:

```bash
cp /var/lib/parkia/parkia.db /var/lib/parkia/parkia.db.before-restore
gunzip -c /var/backups/parkia/parkia-YYYYMMDDTHHMMSSZ.sqlite.gz > /var/lib/parkia/parkia.db
```

## 7. Checklist Antes de Entrega

- `NODE_ENV=production`.
- `APP_URL` configurada.
- `PARKIA_SEED_DEMO=false`.
- DB, storage y backups apuntan a rutas persistentes y absolutas.
- `npm run build` ejecutado y `dist/index.html` existe.
- Admin puede crear y descargar backup.
- `/api/health` responde `readiness.productionReady: true`.
- Usuario admin inicial tiene clave cambiada.
- El check `admin-password` aparece en estado `ok`.
- Datos legales completos en Configuracion > General: razon social, RUT y direccion.
- Roles probados: admin, finance y guard.
- `npm run lint`, `npm run build` y `npm test` pasan.

## 8. Rutina Recomendada

Diaria:

- Revisar dashboard de alertas.
- Revisar tareas criticas y atrasadas.
- Crear respaldo al cierre del dia si no existe automatizacion externa.

Semanal:

- Descargar un respaldo y confirmar que el archivo existe y tiene tamano razonable.
- Revisar auditoria de acciones sensibles.
- Revisar documentos vencidos y contratos por vencer.

Mensual:

- Exportar cierre financiero.
- Validar gastos, cobranza y proyeccion de caja.
- Revisar permisos del personal activo.
