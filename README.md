# Parkia

Sistema web SaaS para operar estacionamientos multi-sucursal: clientes, contratos, tickets, pagos, espacios, accesos, documentos, finanzas, tareas operativas, auditoria y respaldos.

Este repositorio parte desde la base operativa de Luchin y se esta transformando en Parkia. El documento maestro de planificacion esta en [docs/PARKIA_DEVELOPMENT_PLAN.md](docs/PARKIA_DEVELOPMENT_PLAN.md).

## Desarrollo Local

Requisitos: Node.js y npm.

```bash
npm install
npm run dev
```

Variables principales:

```bash
PORT=8080
HOST=0.0.0.0
PARKIA_DB_PATH=parkia.db
PARKIA_STORAGE_PATH=storage
PARKIA_BACKUP_PATH=backups
PARKIA_SEED_DEMO=true
```

Las variables antiguas `TIOLUCHIN_*` siguen funcionando como compatibilidad transitoria, pero los despliegues nuevos deben usar `PARKIA_*`.

## Produccion

Antes de usar con datos reales:

1. Copiar `.env.example` a `.env`.
2. Configurar `NODE_ENV=production`.
3. Configurar `APP_URL` con la URL real.
4. Usar rutas persistentes para `PARKIA_DB_PATH`, `PARKIA_STORAGE_PATH` y `PARKIA_BACKUP_PATH`.
5. Configurar `PARKIA_SEED_DEMO=false`.
6. Ejecutar `npm run build`.
7. Levantar el servidor Node con el gestor de procesos definido para el ambiente.

## Verificacion

```bash
npm run lint
npm run build
npm test
```

## Salud y Respaldos

- `GET /api/health`: estado tecnico, migraciones, storage y preparacion para produccion.
- `POST /api/backups/database`: crea respaldo SQLite, solo admin.
- `GET /api/backups/database`: lista respaldos recientes, solo admin.
- `GET /api/backups/database/:fileName`: descarga respaldo, solo admin.
