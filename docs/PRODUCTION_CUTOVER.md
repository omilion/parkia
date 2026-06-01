# Fase 1 - Cierre de Produccion Base

Este checklist deja el sistema listo para operar con datos reales en los modulos base. La facturacion SII queda disponible solo como mock/local para demo o piloto; no debe usarse como emision tributaria real en produccion hasta definir proveedor SII e integrar su API/certificacion.

## 1. Ambiente

- Crear `.env` desde `.env.production.example`.
- Definir `NODE_ENV=production`.
- Definir `APP_URL` con el dominio HTTPS real.
- Definir `PARKIA_SEED_DEMO=false`.
- Usar rutas absolutas y persistentes para:
  - `PARKIA_DB_PATH`
  - `PARKIA_STORAGE_PATH`
  - `PARKIA_BACKUP_PATH`

## 2. Datos Minimos

- Completar razon social, RUT y direccion en Configuracion > General.
- Cambiar la clave inicial de `admin@parkia.local` o desactivar ese usuario.
- Crear los usuarios reales que operaran el sistema.
- Cargar espacios reales antes de crear contratos productivos.

## 3. Build y Verificacion

Ejecutar:

```bash
npm install
npm run verify
```

Si el ambiente no permite el comando compuesto, ejecutar:

```bash
npm run lint
npm run build
npm test
```

## 4. Healthcheck

Validar:

```http
GET /api/health
```

La salida a produccion solo queda aprobada si:

- `status` es `ok`.
- `database.ok` es `true`.
- `storage.ok` es `true`.
- `backups.ok` es `true`.
- `readiness.productionReady` es `true`.

El mismo estado se puede revisar desde Configuracion > Operacion.

## 5. Respaldo Inicial

- Crear un respaldo desde Configuracion > Operacion.
- Descargar el archivo.
- Guardarlo fuera del servidor como copia inicial antes de cargar datos masivos.

## 6. SII en Produccion

- Confirmar con el cliente que el ambiente productivo no emitira documentos tributarios reales desde el mock/local.
- Mantener la facturacion SII marcada como demo/piloto mientras no exista proveedor SII definido.
- Validar que cualquier folio, estado o respuesta SII visible en demo sea claramente local/simulado.
- Bloquear comunicacionalmente la promesa de "factura emitida en SII" hasta completar integracion real con proveedor, credenciales, certificacion y pruebas de aceptacion.
- Si el cliente necesita facturacion real antes de la integracion, operar por el proceso externo vigente y registrar solo la referencia interna en el sistema.

## Pendientes Fuera de Fase 1

- Facturacion SII real queda pendiente hasta definir proveedor e integrar API/certificacion. El mock/local esta listo para demo/piloto, pero no reemplaza emision real.
- Automatizacion externa de respaldos queda pendiente de infraestructura.
- Dominio final, HTTPS y supervisor de proceso dependen del servidor elegido.
