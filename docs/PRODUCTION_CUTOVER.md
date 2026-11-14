# Salida a Produccion

Este checklist deja el sistema listo para operar con datos reales. La facturacion electronica tiene **tres modos**: `disabled` (la empresa no emite desde Parkia), `mock` (solo demo o piloto; nunca documentos reales) y `real` con `sii_provider=sii_direct` (integracion directa con el SII, descrita en `server/modules/dte/README.md`). La emision real exige que cada empresa complete su asistente y que el servidor la habilite (seccion 6).

## 1. Ambiente

- Crear `.env` desde `.env.production.example`.
- Definir `NODE_ENV=production`.
- Definir `APP_URL` con el dominio HTTPS real.
- Definir `PARKIA_SEED_DEMO=false`.
- Base de datos: PostgreSQL 16 con `PARKIA_DB_ENGINE=postgres`, `DATABASE_URL` (rol `parkia_app`) y `PARKIA_PG_ADMIN_URL`. Instalación, migración desde SQLite y respaldos en `docs/POSTGRES.md`.
- Usar rutas absolutas y persistentes para:
  - `PARKIA_STORAGE_PATH`
  - `PARKIA_BACKUP_PATH`
  - `PARKIA_DB_PATH` (solo si aún se opera con SQLite o para la migración inicial)

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

## 5. Respaldos

- **Base de datos PostgreSQL (produccion):** `scripts/backup-postgres.sh` cifrado con `PARKIA_BACKUP_PASSPHRASE_FILE`, copia a un bucket distinto con `PARKIA_S3_BACKUP_BUCKET`, tarea diaria en `deploy/cron/parkia-backup`. Guarda la frase de cifrado **fuera del servidor**. Detalle en `docs/POSTGRES.md`.
- **Antes de abrir:** ejecutar un respaldo, copiarlo al bucket y correr `scripts/restore-postgres.sh --verify` sobre ese archivo. Un respaldo que nunca se restauro no es un respaldo. La verificacion se repite cada domingo por cron.
- Con SQLite (solo instalaciones que aun no migran): crear el respaldo desde Configuracion > Operacion, descargarlo y guardarlo fuera del servidor.

## 6. SII en Produccion

Cada empresa tiene su propia configuracion; nada se comparte. Revisar por empresa:

- **Si la empresa no emitira desde Parkia:** `sii_mode=disabled`. El chequeo de salud lo da por correcto.
- **Si es demo o piloto:** `sii_mode=mock` es valido **solo fuera de produccion**. En produccion el chequeo `sii-mode` queda en critico y bloquea `productionReady`. Nunca prometer "factura o boleta emitida en el SII" con el mock.
- **Si emitira boletas o facturas reales:** `sii_mode=real` y `sii_provider=sii_direct`, y completar en Configuracion > Facturacion SII los seis pasos: emisor, certificado digital (`.pfx`), conexion, folios (CAF), set de pruebas aceptado en el ambiente de certificacion (Maullin) y paso a produccion con la resolucion del SII.
- **Doble llave de produccion:** ademas del paso 6 del asistente, el servidor necesita `PARKIA_SII_ALLOW_PRODUCTION=true`. Sin ella ninguna empresa puede emitir contra el SII de produccion. Dejarla sin definir en desarrollo y staging.
- `PARKIA_MASTER_KEY` es obligatoria (cifra certificados y folios); sin ella no se pueden cifrar ni descifrar secretos en produccion. Respaldarla aparte: sin ella los certificados guardados no se pueden abrir.
- `sii_provider=external_provider` no esta implementado y deja el chequeo en critico.
- **Antes de la primera empresa real:** la prueba contra Maullin con un certificado y folios reales **aun no se ha hecho** (ver `server/modules/dte/README.md`, "Primera prueba real"). Hasta entonces la integracion esta probada con una red simulada y contra los XSD oficiales, no contra el SII.
- Verificar en `/api/health/details` que `sii-mode` este en `ok`: con `sii_direct` solo lo esta cuando la empresa ya esta autorizada en produccion.

## 7. Servicios Externos

Cada uno se activa con sus variables; sin ellas el sistema funciona pero esa capacidad queda apagada o en modo simulado. El chequeo de salud avisa de lo que es obligatorio en produccion.

| Servicio | Variables | Notas |
|---|---|---|
| Correo (recuperacion de clave, verificacion, avisos) | `PARKIA_MAIL_TRANSPORT`, `PARKIA_MAIL_FROM`, SMTP o `RESEND_API_KEY` | Obligatorio en produccion. `docs/MAIL.md` |
| Pagos en linea | por empresa, en Configuracion > Pagos | Webpay Plus; pasarela simulada solo para pruebas. `docs/PAYMENTS.md` |
| Cobro de la suscripcion a los clientes | `docs/PLATAFORMA_VS_CLIENTE.md` | **No hay adaptador real de Oneclick:** la pasarela simulada esta bloqueada en produccion. Se cobra por transferencia y se registra en `/plataforma`. El administrador de plataforma necesita 2FA |
| Errores (Sentry) | `PARKIA_SENTRY_DSN` | Opcional; no envia datos personales |
| Respaldos fuera del servidor | `PARKIA_BACKUP_PASSPHRASE_FILE`, `PARKIA_S3_BACKUP_BUCKET` | Ver seccion 5 |

## Pendientes Conocidos

- **SII:** prueba real contra Maullin y certificacion; notas de credito y debito desde la interfaz; libros y reporte diario de boletas (RCOF), por confirmar si el SII lo exige para boletas.
- **Suscripcion:** falta el adaptador real de Transbank Oneclick (hoy solo simulador, bloqueado en produccion).
- **Pagos:** Webpay no se ha probado contra el ambiente de integracion real de Transbank; falta el cobro presencial con POS (Mercado Pago o Transbank), Oneclick para cuotas de abonados, reembolsos manuales y cobrar el exceso despues del plazo de salida.
- **Operador:** la impresion termica nunca se probo con una impresora fisica; la lectura de patente por camara espera la API de dispositivos (camara LPR).
- **Respaldos:** la copia al bucket usa la CLI `aws`, probada solo con un doble; hacer una subida real antes de depender de ella.
- **Infraestructura:** dominio final, HTTPS y supervisor de proceso dependen del servidor elegido (`docs/HETZNER_CX23_DEPLOYMENT.md`, `docs/VPS_DEPLOYMENT.md`).
