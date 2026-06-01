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
