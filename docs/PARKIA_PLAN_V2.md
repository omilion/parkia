# Parkia v2 - Plan de Desarrollo y Arquitectura

Fecha: 2026-11-11. Reemplaza como hoja de ruta a `PARKIA_DEVELOPMENT_PLAN.md` (sprints 0-5 ya ejecutados). Basado en la revision del codigo en la rama `sprint3-branch-filters`.

Objetivo: pasar de "sistema de gestion interna que funciona" a "SaaS de estacionamientos vendible en Chile": boleta electronica real ante el SII, cobro electronico, aislamiento multi-tenant garantizado, operacion comoda en telefono y tablet.

---

## 1. Decisiones de arquitectura

### 1.1 Que se mantiene y que se cambia

| Capa | Hoy | Decision | Motivo |
|---|---|---|---|
| Lenguaje | TypeScript | **Se mantiene** | 41.000 lineas y 6.300 de tests funcionando. Reescribir en otro lenguaje no aporta nada al negocio. |
| Frontend | React 19 + Vite 6 + Tailwind 4 | **Se mantiene**, se reestructura | El problema no es el framework: son paginas de 2.600-4.300 lineas sin componentes compartidos. |
| HTTP | Express 4 | **Se mantiene** (subir a Express 5 al migrar a async) | Cambiar a Nest/Fastify es costo sin retorno. |
| Base de datos | SQLite (better-sqlite3, sincrono) | **Se migra a PostgreSQL 16** | Unico cambio de tecnologia recomendado. Ver 1.2. |
| Acceso a datos | SQL crudo en las rutas | **Drizzle ORM** + SQL crudo (`sql```) para reportes | Esquema tipado, migraciones versionadas, sin perder los reportes complejos. |
| Trabajos en segundo plano | No hay (se recalcula al abrir el dashboard) | **pg-boss** (colas sobre Postgres) | Envio SII, consulta de estados, cuotas, morosidad, notificaciones. Sin Redis. |
| Archivos | Disco local (`server/storage.ts`) | **S3 compatible** (Hetzner Object Storage o Cloudflare R2) detras de la misma interfaz | Respaldos y documentos fuera del VPS, aislados por prefijo de tenant. |
| Estado en frontend | `fetch` + `useState` (81 `useState` en FinancePage) | **TanStack Query** + react-hook-form + zod compartido | Cache, reintentos, estados de carga uniformes, base para offline. |
| App movil | No hay | **PWA** (vite-plugin-pwa + Dexie) | Instalable en el POS Android y en tablets sin publicar en tiendas. |
| Tests | Un archivo `tsx tests/api.test.ts` | **Vitest** + supertest + **Playwright** (viewports) | Paralelismo, aislamiento por test, pruebas responsive automaticas. |
| CI | No hay | **GitHub Actions**: lint, build, tests, Playwright | Hoy todo se verifica a mano. |

No se recomienda: Next.js (no hay SEO ni SSR que justificar), microservicios, app nativa, ni Redis.

### 1.2 Por que PostgreSQL ahora

- Las restricciones `UNIQUE` globales (`vehicles.plate`, `clients.rut`, `access_rates.type`, `invoices.folio`, `staff.rut`) hay que rehacerlas por tenant. En SQLite eso exige reconstruir cada tabla; es el mismo esfuerzo que migrar.
- **Row Level Security**: el aislamiento por tenant pasa a estar garantizado por la base, no por recordar el `AND tenant_id = ?` en cada consulta. Las fugas encontradas (`system_config`, `totems`, respaldos) son exactamente el tipo de error que RLS impide.
- El SII, los pagos y las notificaciones necesitan colas con reintentos y bloqueo de folios concurrente (`SELECT ... FOR UPDATE`).
- `timestamptz` resuelve el problema de fechas en UTC que hoy corre vencimientos y cierres nocturnos.
- Respaldos por tenant (`pg_dump` filtrado o export logico) en vez de entregar la base completa a cualquier admin.

Costo real: better-sqlite3 es sincrono; todas las rutas pasan a `async`. Se hace modulo por modulo, con los tests existentes como red de seguridad (ver Fase 1).

### 1.3 Estructura objetivo del repositorio

```
shared/                      # zod + tipos usados por server y src
  schemas/{tickets,contracts,dte,...}.ts
server/
  app.ts, server.ts
  db/{client.ts, schema/*.ts, migrations/*.sql, rls.sql}
  platform/{auth, tenant, audit, jobs, storage, secrets, http}
  modules/
    tickets/{routes.ts, service.ts, repo.ts, pricing.ts}
    cash/  contracts/  clients/  spaces/  access/  finance/
    dte/                     # ver seccion 3
    payments/                # pasarelas
    devices/                 # LPR, barreras, totems
    notifications/
    saas/                    # tenants, planes, suscripcion, super-admin
src/
  app/{router.tsx, providers.tsx, shell/}
  ui/                        # sistema de diseno (seccion 4)
  features/<dominio>/{pages, components, api.ts, hooks.ts}
  lib/
tests/{api, unit, e2e}
```

Regla: `routes.ts` solo valida y delega; la logica vive en `service.ts`; el SQL en `repo.ts`. `finance.ts` (3.911 lineas) se divide en `receivables`, `bank`, `expenses`, `reports`, `closures`.

### 1.4 Modelo de aislamiento multi-tenant

1. Cada peticion autenticada abre una transaccion y ejecuta `SET LOCAL app.tenant_id = $1` (y `app.branch_ids`).
2. Todas las tablas de negocio tienen `tenant_id NOT NULL` y politica RLS `USING (tenant_id = current_setting('app.tenant_id')::int)`.
3. La aplicacion se conecta con un rol sin `BYPASSRLS`. Solo los jobs de plataforma y el super-admin usan un rol privilegiado, en un modulo separado (`saas/`).
4. Unicidad por tenant: `UNIQUE (tenant_id, plate)`, `UNIQUE (tenant_id, rut)`, `UNIQUE (tenant_id, branch_id, type)` para tarifas, `UNIQUE (tenant_id, dte_type, folio)`.
5. Test automatico que recorre el catalogo y falla si una tabla con `tenant_id` no tiene RLS activo.

### 1.5 Secretos

Certificados digitales, claves de CAF y credenciales de pasarelas se guardan cifrados con AES-256-GCM (cifrado por sobre: una clave de datos por tenant, envuelta con `PARKIA_MASTER_KEY` del entorno). Nunca en texto plano, nunca en logs, nunca en respaldos sin cifrar. Modulo unico: `server/platform/secrets.ts`.

---

## 2. Hoja de ruta

Estimaciones para un desarrollador a tiempo completo apoyado por agentes. Las fases 2 y 3 pueden correr en paralelo con la 1 una vez migrado el modulo que tocan.

| Fase | Contenido | Duracion |
|---|---|---|
| 0 | Parches urgentes + CI | 1 semana |
| 1 | PostgreSQL, RLS, modularizacion | 4 semanas |
| 2 | Sistema de diseno y responsive | 3 semanas (paralelo) |
| 3 | Modulo DTE / SII hasta certificacion en Maullin | 5 semanas |
| 4 | Motor tarifario + pagos electronicos | 4 semanas |
| 5 | PWA de operador, offline, impresion | 3 semanas |
| 6 | SaaS: alta de empresas, cobro, super-admin | 3 semanas |
| 7 | Dispositivos, notificaciones, portal abonado | 4 semanas |

> **Estado al 2026-11-13.** Las casillas reflejan lo construido y verificado en `main`. Lo marcado **PARCIAL** o **PENDIENTE** dice que falta. Ademas de esos puntos, lo que ninguna casilla puede cerrar por si sola es la verificacion contra servicios reales (Maullin, Transbank, impresora fisica, bucket S3, Sentry); esta listada en `docs/PRODUCTION_CUTOVER.md`.

### Fase 0 - Parches urgentes (antes de cualquier otra cosa)

Se corrigen en SQLite, hoy, porque son fugas activas:

- [x] `GET/PATCH /api/config` (`server/routes/admin.ts:510-524`): crear `tenant_settings (tenant_id PK, ...)`, migrar la fila `system_config id=1` al tenant por defecto y leer/escribir por tenant. Actualizar `server/sii.ts:44`, `finance.ts:887`, `health.ts:99`.
- [x] `/api/totems` (`admin.ts:534-548`): filtrar y actualizar por `tenant_id`.
- [x] `/api/backups/*` (`admin.ts:677-748`): mover a rol de plataforma (variable `PARKIA_PLATFORM_ADMINS` con correos autorizados). Un admin de tenant no descarga ni restaura la base.
- [x] Aplicar limites de plan: helper `assertPlanLimit(req, 'spaces' | 'branches' | 'users' | 'tickets')` usado en `POST /api/spaces`, `/api/branches`, `/api/staff`, `/api/visitors`. Responder `402 PLAN_LIMIT_REACHED`.
- [x] Tests de aislamiento para cada punto anterior (tenant B no ve ni modifica lo de A).
- [x] GitHub Actions con `npm run verify` en cada push.
- [x] `index.html`: `lang="es-CL"`.

Criterio de salida: los cuatro tests de aislamiento nuevos pasan; CI en verde.

### Fase 1 - PostgreSQL y modularizacion

Semana 1 - Base
- [x] Docker Compose local con Postgres 16. `server/db/client.ts` con `pg` + Drizzle.
- [x] Esquema Drizzle completo (las 38 migraciones actuales consolidadas en un esquema inicial). Tipos: `timestamptz`, `integer` para CLP (sin `REAL`), `date` para vencimientos.
- [x] `rls.sql` con politicas y test de catalogo (1.4).
- [x] Middleware `withTenantTx(req, fn)` que abre la transaccion y fija `app.tenant_id`. *(Hecho como contexto por peticion con `AsyncLocalStorage`: `runWithTenant` / `runWithoutTenant`.)*
- [x] Script `scripts/migrate-sqlite-to-pg.ts`: copia tabla por tabla, valida conteos y sumas de montos por tenant.

Semanas 2-3 - Migracion por modulo (en este orden, cada uno con sus tests en verde antes de seguir)
1. `auth`, `tenant`, `branches`, `staff` (sesiones a tabla con indice por expiracion; bloqueo de login a tabla, hoy esta en memoria).
2. `spaces`, `spaceMaps`.
3. `tickets` (visitors) + `cash`.
4. `access` + turnos.
5. `clients`, `contracts`, `documents`.
6. `finance` (dividido en cinco submodulos).
7. `tasks`, `audit`, `dashboard`.

Semana 4 - Infraestructura
- [x] pg-boss: jobs `receivables.generate` (diario 03:00), `payments.refresh-overdue` (diario 03:10), `sessions.cleanup`. Quitar las llamadas a `ensureUpcomingReceivables()` / `refreshOverduePayments()` de `general.ts:474,923` y `finance.ts:629`. *(Hecho con un planificador propio sobre la misma base, sin pg-boss: este solo funciona en PostgreSQL y Parkia tambien corre en SQLite y pglite. Cada tarea corre a su hora, queda en `job_runs`, no se duplica entre instancias y recupera lo perdido tras una caida.)*
- [x] Zona horaria: columna `branches.timezone` (default `America/Santiago`); helper unico `localDate(branch)`. Eliminar todos los `toISOString().slice(0,10)` y `date('now')`. *(Hecho: el dia de negocio es el de Santiago en todo el sistema. `shared/dates.ts` (servidor y navegador); en SQL `date('now')` y `strftime(f, 'now')` significan hoy en Santiago en SQLite y PostgreSQL, y `parkia_local_date(columna)` da el dia de Santiago de un instante guardado en UTC. Queda una sola zona por instalacion: `branches.timezone` existe pero las fechas de negocio aun no la usan por sucursal. Probado a las 22:30 de Santiago con el reloj fijado: `tests/dates/`.)*
- [ ] Storage S3 con prefijo `tenants/{id}/`. Respaldos: `pg_dump` nocturno cifrado a un bucket distinto + export por tenant (ZIP de CSV) disponible para el admin del tenant. **PARCIAL.** *Hecho: prefijo `tenants/{id}/`, respaldo nocturno cifrado con copia a un bucket distinto, verificacion semanal de restauracion y exportacion por empresa. Pendiente: los archivos adjuntos siguen en disco local (no en S3).*
- [ ] Vitest: partir `tests/api.test.ts` por modulo; base de datos efimera por archivo de test. **PARCIAL.** *Se usa `node:test`, no Vitest. Las suites nuevas viven en archivos propios por modulo con base desechable (`tests/support/apiHarness.ts`), pero `tests/api.test.ts` sigue siendo un archivo unico grande.*
- [x] Sentry (errores) + logs JSON con `pino` + `request_id`. *(Sentry listo detras de `PARKIA_SENTRY_DSN`, sin datos personales; logs JSON propios con `request_id` en lugar de `pino`. Los errores del navegador no se reportan.)*
- [x] Recuperacion de contrasena por correo y 2FA TOTP opcional para `admin`. *(2FA con pantalla, secreto cifrado, codigos de recuperacion y sin reutilizacion de codigos.)*

Criterio de salida: toda la suite pasa contra Postgres; datos de demo migrados con sumas identicas; ninguna consulta depende de `tenant_id` escrito a mano para estar aislada.

### Fase 2 - Sistema de diseno y responsive

Detalle completo en la seccion 4. Entregables:

- [x] `src/ui/` con componentes base y tokens.
- [x] Shell nuevo (navegacion movil, riel en tablet).
- [x] Las 11 paginas migradas a `features/` usando los componentes, en el orden de 4.5.
- [x] Playwright con 5 viewports y capturas por pagina.

Criterio de salida: ninguna pagina tiene scroll horizontal a 360 px; todos los flujos de guardia y cajero se completan con una mano en un telefono.

### Fase 3 - Modulo DTE / SII

Detalle completo en la seccion 3. Criterio de salida: set de pruebas de boleta y de factura enviado y aceptado en el ambiente de certificacion (Maullin), con el asistente de configuracion por tenant funcionando.

**Estado:** codigo completo (certificado, CAF, boletas y facturas, firma, envio, estados, produccion con doble llave, asistente por empresa), probado con red simulada y contra los XSD oficiales. **El criterio de salida aun no se cumple:** falta enviar el set de pruebas a Maullin con el certificado y los folios de una empresa real. Ver `server/modules/dte/README.md`.

### Fase 4 - Motor tarifario y pagos

Tarifas (`server/modules/tickets/pricing.ts`, reemplaza la logica de `server/parking.ts:42-89`)
- [x] Tablas `rate_plans (tenant, branch, name, vehicle_type, mode, grace_mins, daily_cap, valid_from, valid_to)` y `rate_rules (plan, weekdays, from_time, to_time, price_per_minute | block_minutes + block_price, priority)`.
- [x] Modos conforme a la Ley 20.967: `per_minute` (minuto efectivo, sin redondeo al alza) y `elapsed_blocks` (tramo vencido; primer tramo minimo 30 min, siguientes minimo 10 min). Validar esos minimos al guardar la tarifa.
- [x] Motor puro `quote(plan, entryAt, exitAt)` que devuelve el desglose por tramo. Tests de tabla: cruce de medianoche, cambio de horario, tope diario, varios dias, cambio de hora de verano.
- [x] Revisar el `Math.ceil` de minutos: cobrar minutos completos transcurridos.
- [x] Tipo de vehiculo en el ticket (auto, moto, camioneta).
- [x] Convenios: `agreements (comercio, tipo: minutos gratis | % | monto fijo, tope)` y `ticket_validations`; el comercio valida con QR o codigo desde una pantalla simple.
- [x] Ticket perdido: flujo formal que busca por patente, cobra el tiempo real registrado y deja evidencia (foto de cedula o padron opcional). Sin multa fija.
- [x] Versionado de tarifas: el ticket guarda la version con la que entro.

Pagos (`server/modules/payments/`)
- [x] Interfaz `PaymentGateway { createCharge, getStatus, refund, parseWebhook }`.
- [x] Adaptador 1: **Webpay Plus** (Transbank) para pago web del ticket por QR y pago de cuotas de abonados. *(Probado con red simulada y una pasarela simulada propia; falta el ambiente de integracion real de Transbank.)*
- [ ] Adaptador 2: **Mercado Pago** (QR y Point) o **Getnet/Transbank POS integrado** para el cobro presencial; elegir segun el hardware del primer cliente. **PENDIENTE.** *Depende del hardware del primer cliente.*
- [x] Tabla `payment_intents` con idempotencia y webhooks firmados; el ticket pasa a `paid` solo por confirmacion de la pasarela.
- [x] Pagina publica `/pagar/:token`: el cliente escanea el QR del ticket, ve el monto y paga. Minutos de salida configurables despues del pago.
- [ ] Abonados: link de pago por cuota y suscripcion con tarjeta (Webpay Oneclick). **PARCIAL.** *Hecho el link de pago por cuota (`/pagar/r_...`). Falta la suscripcion con tarjeta de los abonados (Oneclick); el Oneclick que existe es el de la suscripcion SaaS de cada empresa.*
- [x] Al confirmar el pago se encola la emision de la boleta (Fase 3).

### Fase 5 - PWA de operador, offline e impresion

- [x] `vite-plugin-pwa`: manifest, iconos, cache del shell, aviso de actualizacion.
- [x] Ruta `/operar` (seccion 4.4): modo dedicado para guardia y cajero.
- [x] Offline: cola en IndexedDB (Dexie) para entradas, salidas y cobros en efectivo. Cada operacion lleva `client_uuid` y hora del dispositivo; el servidor es idempotente por `client_uuid`. Indicador permanente de "sin conexion / N pendientes".
- [x] Tarifas y tickets abiertos se sincronizan al dispositivo para cotizar sin red. Los pagos con tarjeta requieren conexion.
- [x] Impresion termica: ESC/POS por Web Bluetooth / WebUSB (58 y 80 mm) con respaldo en `window.print()` y CSS de 80 mm. Ticket de entrada con QR; comprobante de salida con el timbre PDF417 de la boleta. *(Probada con dispositivos simulados y los bytes decodificados; **nunca con una impresora fisica**.)*
- [ ] Lectura de QR y de patente con la camara (`BarcodeDetector` con polyfill). **PARCIAL.** *El QR se lee (BarcodeDetector con jsQR de respaldo). La patente no: el navegador no lee texto y un OCR local es poco fiable; queda para la camara LPR de la Fase 7.*

### Fase 6 - SaaS

- [x] Alta autoservicio: `/registro` crea tenant, sucursal, usuario owner y prueba de 15 dias. Verificacion de correo.
- [x] Asistente de inicio: sucursal -> plazas (carga masiva) -> tarifa -> usuarios -> primer ticket de prueba.
- [ ] Cobro de la suscripcion: planes en UF (valor diario desde el Banco Central o mindicador.cl, guardado en tabla), cargo mensual por Webpay Oneclick, factura emitida por el propio modulo DTE de Parkia. **PARCIAL.** *El cobro lo hace Parkia (job diario `subscriptions.charge` y acciones del administrador de plataforma: cobrar ahora o registrar una transferencia); el cliente solo inscribe su tarjeta. Planes en UF con la UF real del dia, un cobro por periodo, factura por el modulo DTE. **Falta el adaptador real de Transbank Oneclick:** hoy solo existe una pasarela simulada, bloqueada en produccion; mientras tanto se cobra por transferencia. Ver `docs/PLATAFORMA_VS_CLIENTE.md`.*
- [x] Estados `trialing -> active -> past_due (7 dias de gracia) -> suspended`, con avisos por correo.
- [x] Panel super-admin (`/plataforma`, rol separado): tenants, consumo, estado SII, suplantacion auditada para soporte.
- [x] Ley 21.719 de datos personales: politica de retencion por tabla, exportacion y eliminacion por titular (RUT o patente), registro de consentimiento, contrato de encargado de tratamiento para clientes.

### Fase 7 - Dispositivos, notificaciones, portal

- [x] API de dispositivos: `devices (tenant, branch, type: lpr | barrier | totem | pos, direction, api_key_hash)`. Autenticacion por clave de dispositivo, no por sesion de guardia (hoy `/api/totems/scan` exige rol humano). Eventos `POST /api/device/v1/events` y comandos (abrir barrera) por WebSocket o long-poll. *(Hecho. Clave por dispositivo, eventos, ordenes por consulta y bitacora. Sin probar con equipos reales.)*
- [x] Adaptador LPR generico (webhook de camaras Hikvision / Dahua) y rele de barrera (Shelly o similar) como primera integracion. *(Hecho: Hikvision y Dahua por webhook, rele Shelly con proteccion SSRF. La camara abre la barrera pero aun no cierra el ticket ni libera la plaza.)*
- [x] Notificaciones: correo (Resend o SES) y WhatsApp Business API. Plantillas: cuota por vencer, cuota vencida, boleta, pase de visita con QR. *(Hecho: bandeja de salida con reintentos, correo y WhatsApp Business. Solo envios manuales; falta consentimiento y baja por canal antes de automatizar.)*
- [x] Portal del abonado: ingreso por enlace magico, cuotas, pago, boletas, documentos, vehiculos. *(Hecho: enlace magico de un solo uso; pagar una cuota lleva a la pasarela, no la marca pagada.)*
- [x] Reservas y reajuste automatico de contratos por IPC/UF. *(Hecho. El IPC lo carga solo el administrador de plataforma; falta su carga automatica.)*

---

## 3. Modulo DTE / SII - diseno completo

Meta de la fase: integracion directa con el SII, lista para cargar el certificado digital de cada empresa, cargar folios (CAF) y certificar contra el ambiente de pruebas. Habilitar una empresa nueva debe ser solo configuracion.

Nota: los nombres de servidores, pasos de certificacion y obligaciones de reporte de esta seccion corresponden a lo que conozco del SII; confirmar contra la documentacion vigente en sii.cl antes de implementar cada paso.

### 3.1 Alcance

| Codigo | Documento | Uso en Parkia |
|---|---|---|
| 39 | Boleta electronica afecta | Ticket de visita y cuota de abonado persona natural. El estacionamiento esta afecto a IVA. |
| 41 | Boleta exenta | Solo si el tenant lo requiere. |
| 33 | Factura electronica afecta | Abonados empresa, convenios. |
| 34 | Factura exenta | Casos puntuales. |
| 61 | Nota de credito | Anulaciones y devoluciones. |
| 56 | Nota de debito | Intereses por mora. |

### 3.1.1 Boleta sin cliente (caso por defecto)

En un estacionamiento la boleta se emite a un consumidor anonimo: no se piden datos y no existe un cliente en el sistema. Ese es el flujo principal del modulo, no una excepcion.

- La boleta 39 se emite **sin receptor identificado**: el XML lleva el RUT generico de consumidor final (`66666666-6`) y no se exige razon social, giro ni direccion. Confirmar el formato exacto contra el esquema de boleta vigente al implementar `builder.ts`.
- En `dte_documents`, `client_id` y todos los campos `receptor_*` son **nulos permitidos**. La boleta se vincula al ticket (`source_type = ticket`), no a un cliente.
- La validacion actual se elimina para boletas: hoy `server/sii.ts:98-99` exige nombre y RUT de cliente, y la consulta de `server/sii.ts:72-90` hace `JOIN clients`, por lo que un ticket de visita no puede generar documento.
- El cobro no agrega ningun paso: cobrar -> boleta emitida automaticamente (`auto_emit_boleta`) -> se imprime con el comprobante de salida. Cero campos extra para el cajero.
- Detalle de la boleta generado desde el ticket: "Servicio de estacionamiento", patente, hora de entrada y salida, minutos, total con IVA incluido.
- **Factura a pedido**: boton secundario "Necesita factura" en la pantalla de cobro, antes de emitir. Pide RUT (autocompleta si ya existe como cliente), razon social, giro, direccion y comuna, y emite una 33 en lugar de la 39. Si la boleta ya se emitio, no se reemplaza desde caja: queda como tarea para administracion (nota de credito + factura).
- **Anulacion**: una boleta emitida por error se anula con nota de credito 61 que la referencia, tambien sin receptor identificado; solo rol admin, con motivo.
- **Entrega**: impresa en el ticket termico con su timbre PDF417. Opcional, QR a una pagina publica `/boleta/:token` para quien la quiera digital, sin pedir correo.
- **Pagos con tarjeta**: evaluar con el contador si el comprobante del POS integrado puede valer como boleta (el SII lo permite bajo ciertas condiciones); de ser asi, esos cobros no consumen folios y solo se informan. Queda como opcion configurable por tenant, no como supuesto.
- Abonados persona natural sin datos tributarios completos siguen el mismo camino: boleta 39 sin receptor, vinculada a la cuota (`source_type = payment`).

### 3.2 Ambientes

| | Certificacion | Produccion |
|---|---|---|
| Facturas y notas (SOAP + upload) | `maullin.sii.cl` | `palena.sii.cl` |
| Boletas (REST) | `apicert.sii.cl` (semilla, token, consultas) y `pangal.sii.cl` (envio) | `api.sii.cl` y `rahue.sii.cl` |

El ambiente es un campo por tenant (`certificacion | produccion`). Todo tenant parte en certificacion. En certificacion la resolucion va con numero 0 y la fecha de autorizacion de pruebas.

### 3.3 Modelo de datos

```
dte_settings        tenant_id PK, environment, rut_emisor, razon_social, giro, acteco,
                    direccion, comuna, ciudad, codigo_sucursal_sii, resolucion_numero,
                    resolucion_fecha, rut_envia (del certificado), auto_emit_boleta bool,
                    status: unconfigured | testing | certified | production
dte_certificates    id, tenant_id, pfx_encrypted, password_encrypted, subject_rut,
                    subject_name, issuer, valid_from, valid_to, fingerprint, active
dte_cafs            id, tenant_id, dte_type, folio_from, folio_to, next_folio,
                    caf_xml_encrypted, authorized_at, expires_at, environment,
                    status: active | exhausted | expired | voided
dte_documents       id, tenant_id, branch_id, dte_type, folio, issued_at,
                    receptor_rut, receptor_razon, receptor_giro, receptor_direccion, receptor_comuna,
                    neto, exento, iva, total, items_json, references_json,
                    xml_signed, ted_xml, pdf_key,
                    source_type: ticket | payment | manual | subscription, source_id,
                    status, status_detail, track_id, envio_id, UNIQUE(tenant_id, dte_type, folio, environment)
dte_envios          id, tenant_id, kind: EnvioDTE | EnvioBOLETA, xml_signed, track_id,
                    status: pending | uploaded | accepted | partially | rejected, sii_response, attempts
dte_events          bitacora de cada llamada al SII (reemplaza sii_events)
dte_received        (posterior) documentos de proveedores, acuse y aceptacion
```

La tabla `invoices` actual se migra a `dte_documents`; `client_id` y los campos `receptor_*` son opcionales porque la boleta de ticket no tiene cliente (ver 3.1.1). Solo las facturas 33/34 exigen receptor completo.

Estados del documento: `draft -> signed -> queued -> sent -> accepted | accepted_with_objections | rejected`, mas `voided` (por nota de credito).

### 3.4 Componentes (`server/modules/dte/`)

```
provider.ts          interface DteProvider { issue, sendBatch, queryStatus, void }
providers/mock.ts    el mock actual, solo fuera de produccion
providers/sii/
  auth.ts            semilla -> firma -> token; cache por tenant y ambiente
  cert.ts            carga y validacion del .pfx (node-forge)
  caf.ts             parseo del CAF, validacion de firma del SII, asignacion de folio
  builder.ts         arma el XML del DTE (ISO-8859-1) por tipo
  ted.ts             timbre electronico: firma del DD con la clave privada del CAF (RSA-SHA1)
  signer.ts          XMLDSig del documento y del sobre (xml-crypto, C14N, RSA-SHA1)
  envelope.ts        EnvioDTE / EnvioBOLETA con caratula
  client-dte.ts      CrSeed, GetTokenFromSeed, DTEUpload, QueryEstUp, QueryEstDte
  client-boleta.ts   REST de boletas: semilla, token, envio, estado de envio y de documento
  xsd/               esquemas oficiales del SII; validacion antes de enviar
  errors.ts          mapeo de codigos de rechazo a mensajes accionables
pdf.ts               representacion impresa carta y termica 80 mm con PDF417 (bwip-js)
service.ts           reglas de negocio: que documento emitir, a quien, cuando
jobs.ts              dte.send, dte.poll-status, caf.low-stock, cert.expiring
routes.ts            configuracion, CAF, emision, consulta, descarga
certification/       generador del set de pruebas y libros para la certificacion
```

Librerias: `node-forge` (PKCS#12), `xml-crypto` + `@xmldom/xmldom` (firma), `iconv-lite` (ISO-8859-1), `bwip-js` (PDF417), `libxmljs2` o `xmllint-wasm` (XSD), `soap` o `fetch` directo para los servicios SOAP.

Puntos tecnicos que no se pueden errar:
- **Folios**: asignacion con `SELECT ... FOR UPDATE` sobre `dte_cafs`; un folio nunca se reutiliza ni se salta en silencio. Si la emision falla despues de asignar, el documento queda en `draft` con su folio para reintento.
- **Codificacion**: todo el XML en ISO-8859-1; la firma se calcula sobre la forma canonica exacta. Tests con vectores fijos (XML esperado byte a byte).
- **Montos**: enteros en CLP. En boleta afecta el total incluye IVA; neto = round(total / 1.19).
- **Emision asincrona**: cobrar un ticket nunca espera al SII. Se genera y firma localmente (el timbre se puede imprimir de inmediato) y el envio va por cola con reintentos exponenciales.
- **Idempotencia**: un `source_type + source_id` produce un solo documento.
- **Boletas**: enviar en sobres (`EnvioBOLETA`) agrupados cada pocos minutos, no una llamada por ticket. Verificar si sigue vigente alguna obligacion de resumen diario (entiendo que el RCOF fue eliminado en 2022).

### 3.5 Flujo de emision

```
Pago confirmado (caja o pasarela)
  -> service.issueFor(source)           39 sin receptor por defecto; 33 solo si se pidio factura
  -> caf.takeFolio()                    con bloqueo
  -> builder + ted + signer             XML firmado, estado signed
  -> pdf / ticket termico disponible    el cliente se va con su boleta
  -> job dte.send                       agrupa en sobre, sube, guarda track_id
  -> job dte.poll-status                consulta hasta estado final
  -> rejected -> tarea automatica en el modulo Tareas con el motivo traducido
```

### 3.6 Asistente de configuracion por tenant (Configuracion > Facturacion electronica)

Esta es la "pequena configuracion" para habilitar una empresa:

1. **Datos del emisor**: RUT, razon social, giro, codigo de actividad, direccion, comuna. Validacion de RUT.
2. **Certificado digital**: subir `.pfx` / `.p12` + clave. El sistema valida que abre, muestra titular, RUT y vigencia, y lo guarda cifrado. Alerta a 30 dias del vencimiento.
3. **Probar conexion**: obtiene semilla y token en el ambiente elegido. Verde o error explicado.
4. **Folios (CAF)**: subir el XML del CAF por tipo de documento. Se valida que el RUT y el ambiente coincidan. Muestra rango y folios disponibles. Alerta cuando queda menos del 10 %.
5. **Documento de prueba**: emite una boleta de $1 en certificacion y muestra el resultado del SII.
6. **Paso a produccion**: se habilita solo con el estado `certified`; pide numero y fecha de resolucion y CAF de produccion.

Panel permanente: estado del certificado, folios restantes por tipo, documentos pendientes y rechazados, ultimo envio.

### 3.7 Plan de certificacion en Maullin

Semana 1 - Cimientos
- [x] Tablas, `secrets.ts`, carga de certificado, autenticacion (semilla y token) contra Maullin y `apicert`. *(Autenticacion probada con red simulada; falta contra Maullin.)*
- [x] Carga y validacion de CAF.

Semana 2 - Generacion y firma
- [x] `builder`, `ted`, `signer` para 39 y 33, con validacion XSD y tests de vectores.
- [ ] PDF carta y ticket termico con PDF417. **PARCIAL.** *La boleta se imprime en termica 80 mm y carta con el PDF417, pero como HTML imprimible; el PDF generado en el servidor esta pendiente.*

Semana 3 - Envio y estados
- [x] Sobres, upload, track ID, consulta de estado, jobs y reintentos.
- [ ] Notas de credito y debito (61, 56) con referencias. **PARCIAL.** *El generador (builder) soporta los tipos 61 y 56; falta la pantalla para emitirlas.*
- [x] Mapeo de errores y tareas automaticas.

Semana 4 - Set de pruebas
- [ ] Inscribir al emisor de pruebas en el ambiente de certificacion del SII y descargar los sets (basico de factura, boleta). **PENDIENTE.** *Tramite de una empresa real ante el SII.*
- [ ] `certification/`: generador que lee los casos del set y produce los documentos exigidos, mas los libros de compra y venta que pida el proceso. **PARCIAL.** *El generador del set de pruebas (casos propios o de ejemplo) esta listo; no se han producido los libros de compra y venta.*
- [ ] Enviar, corregir rechazos, repetir hasta obtener aprobacion del set. **PENDIENTE.** *Necesita el certificado y los folios de una empresa.*

Semana 5 - Cierre del proceso
- [ ] Etapa de simulacion (documentos representativos de la operacion real). **PENDIENTE.**
- [ ] Intercambio: recepcion de un DTE y generacion de acuse de recibo y respuesta comercial. **PENDIENTE.**
- [ ] Muestras impresas de cada tipo con timbre. **PENDIENTE.**
- [ ] Declaracion de cumplimiento y solicitud de paso a produccion. **PENDIENTE.**
- [x] Asistente de configuracion (3.6) terminado y probado con un segundo tenant de prueba. *(Asistente de seis pasos en la app; el aislamiento entre empresas esta probado.)*

Riesgo a tener presente: la autorizacion del SII es por contribuyente. Cada empresa cliente debe estar habilitada como emisor electronico con su RUT; tener el software certificado acorta ese tramite pero no lo elimina. Por eso la interfaz `DteProvider` queda abierta: si un cliente prefiere no hacer el tramite, se puede conectar un proveedor intermediario como segundo adaptador sin tocar el resto del sistema.

Insumos que debe conseguir el negocio (no son tareas de codigo): certificado digital de firma electronica del representante, RUT emisor inscrito en el ambiente de certificacion, CAF de pruebas.

---

## 4. UI / UX y responsive

### 4.1 Diagnostico del codigo actual

| Hallazgo | Evidencia | Efecto |
|---|---|---|
| Navegacion movil con 11 iconos en una fila con scroll horizontal | `src/components/layout/Sidebar.tsx:81-101` | El usuario no ve la mitad de los modulos; nada cabe en la zona del pulgar. |
| La tablet se trata como telefono | Barra lateral `hidden lg:flex` (aparece recien a 1024 px) | iPad vertical (768-834 px) recibe la barra inferior y desperdicia el ancho. |
| 16 tablas resueltas con `overflow-x-auto` | Todas las paginas | En telefono hay que arrastrar de lado para ver monto o estado. |
| Texto de 9-11 px en 169 lugares | 40 en AccessPage, 34 en FinancePage | Ilegible en una caseta con sol o de noche. |
| Paginas monoliticas | FinancePage 4.275 lineas y 81 `useState`; SpacesPage 2.632 | Imposible ajustar el layout sin romper algo; todo se carga a la vez. |
| Panel lateral unico para todo | `src/components/ui/Drawer.tsx` (ancho completo en movil, sin pie fijo) | El boton de guardar queda al final del scroll; formularios largos. |
| No hay componentes base | `src/components/ui/` tiene 5 archivos; botones e inputs se repiten con clases a mano | Inconsistencia de tamanos, colores y estados. |
| Sin estados de carga ni de error uniformes | `fetch` directo en cada pagina | Pantallas en blanco y saltos de contenido. |
| `html lang="en"`, sin `theme-color`, sin manifest | `index.html` | Lectores de pantalla y teclado del telefono en ingles. |

### 4.2 Sistema de diseno (`src/ui/`)

Tokens en `src/index.css` con `@theme` de Tailwind 4:
- Color: neutros slate, primario indigo, semanticos (exito, alerta, peligro, info) con pares fondo/texto que cumplan contraste AA.
- Tipografia: escala 12 / 14 / 16 / 18 / 24 / 30. **Minimo 12 px**; 16 px en inputs (evita el zoom de iOS). Numeros tabulares para montos.
- Espaciado en multiplos de 4; radios 8 / 12 / 16.
- Objetivo tactil minimo 44 x 44 px, 48 px en el modo operador.
- Modo de alto contraste para caseta (clase en `html`), elegible por usuario.

Componentes:

| Componente | Comportamiento responsive |
|---|---|
| `Button`, `IconButton` | Tamanos sm / md / lg; `lg` por defecto en movil. Estado de carga integrado. |
| `Field`, `Input`, `Select`, `MoneyInput`, `PlateInput`, `RutInput`, `DateInput` | Etiqueta arriba, error debajo. `inputmode` correcto; patente en mayusculas con formato chileno; RUT con digito verificador. |
| `DataView` | **Tabla en >= 768 px, lista de tarjetas en < 768 px**, definida una sola vez por columna (`primary`, `secondary`, `meta`, `hideBelow`). Reemplaza las 16 tablas. |
| `FilterBar` | En linea en escritorio; en movil un boton "Filtros (n)" que abre una hoja inferior. |
| `Sheet` | Hoja inferior en telefono (arrastrable, con pie fijo para la accion principal); panel lateral en tablet y escritorio. Reemplaza a `Drawer`. |
| `Dialog`, `ConfirmDialog` | Centrado en escritorio, hoja inferior en movil. |
| `Tabs` | Con scroll y sombra de desborde en movil; sincronizadas con la URL. |
| `PageHeader` | Titulo, selector de sucursal y accion principal; en movil la accion principal pasa a boton flotante. |
| `StatCard`, `Badge`, `EmptyState`, `Skeleton`, `Toast`, `Pagination` | Estados uniformes de carga, vacio y error. |

### 4.3 Shell y navegacion

| Ancho | Navegacion |
|---|---|
| < 768 px (telefono) | Barra inferior con **4 destinos segun rol + "Mas"** (hoja con el resto). Respeta `safe-area-inset-bottom`. |
| 768-1279 px (tablet) | **Riel lateral de iconos** de 72 px, expandible. Contenido a dos columnas donde aplique. |
| >= 1280 px | Barra lateral completa actual. |

Destinos por rol en telefono:
- Guardia: Operar, Plazas, Bitacora, Tareas.
- Cajero: Operar, Caja, Plazas, Tareas.
- Finanzas: Inicio, Cobranza, Pagos, Tareas.
- Admin: Inicio, Operar, Finanzas, Tareas.

Encabezado: en movil solo titulo, sucursal y campana; la busqueda global pasa a pantalla completa.

### 4.4 Modo operador (`/operar`)

Pantalla principal de guardia y cajero, pensada para telefono o POS Android con una mano:

- Arriba: sucursal, turno y caja abiertos, ocupacion (libres / total), estado de conexion.
- Dos botones grandes: **Entrada** y **Salida / Cobrar**.
- Entrada: teclado de patente propio (letras y numeros grandes), tipo de vehiculo, plaza sugerida -> imprime ticket. Tres toques.
- Salida: escanear QR o escribir patente -> monto calculado con desglose -> medio de pago -> boleta -> salida. El monto ocupa media pantalla.
- Lista de vehiculos dentro con busqueda por patente y tiempo transcurrido.
- Cierre de caja como asistente de 3 pasos con conteo por denominacion.
- Sin tablas, sin texto bajo 14 px, sin paneles anidados.

### 4.5 Correcciones por modulo (orden de ejecucion)

1. **Seguridad / Accesos** (`AccessPage`, 1.594 lineas): dividir en Operar (4.4), Bitacora, Pases y Tarifas. Quitar el texto de 10 px. Tarifas pasa a Configuracion (solo admin).
2. **Estacionamientos** (`SpacesPage`, 2.632): vista de mapa con pellizco y arrastre en tactil, y lista de plazas como alternativa en telefono; detalle de plaza en hoja inferior; el editor de mapas queda solo para tablet y escritorio, con aviso claro en telefono.
3. **Dashboard** (831): una columna en telefono con tarjetas priorizadas por rol; graficos con altura fija y leyenda debajo; alertas como lista accionable. La unica tabla pasa a `DataView`.
4. **Finanzas** (`FinancePage`, 4.275): convertir las pestanas en rutas (`/finanzas/cobranza`, `/pagos`, `/banco`, `/gastos`, `/reportes`, `/cierres`, `/documentos-tributarios`), cada una cargada bajo demanda. Tablas a `DataView` con monto y estado siempre visibles. Conciliacion bancaria: dos columnas en tablet, pasos secuenciales en telefono. Reportes con exportacion visible y tablas resumidas en movil.
5. **Clientes** y **Contratos** (1.211 / 1.184): lista de tarjetas con busqueda fija arriba; ficha con pestanas; alta de contrato como asistente por pasos en vez de un formulario largo.
6. **Tareas** (921): tablero por columnas en escritorio, lista agrupada por estado en telefono, acciones por deslizamiento.
7. **Documentos**, **Personal**, **Auditoria**, **Configuracion**: `DataView` + `FilterBar`; Configuracion con menu lateral en tablet y lista de secciones en telefono.

Cada modulo se entrega con: componentes en `features/<modulo>/`, datos por TanStack Query, formularios con react-hook-form + zod compartido, y sus capturas Playwright aprobadas.

### 4.6 Verificacion

- Playwright en 360x800, 390x844, 768x1024, 1024x768 y 1440x900: cada pagina sin scroll horizontal, sin texto bajo 12 px, objetivos tactiles >= 44 px (regla automatica).
- Recorridos completos por rol en telefono: turno de guardia, cobro y cierre de caja, registro de pago de abonado.
- axe-core en CI para contraste y etiquetas.
- Presupuesto de rendimiento: carga inicial bajo 200 KB comprimidos, interaccion bajo 3 s en un Android de gama media.

---

## 5. Riesgos y como se controlan

| Riesgo | Control |
|---|---|
| La migracion a Postgres rompe comportamiento | Modulo por modulo, suite existente como contrato, script de comparacion de sumas, SQLite sigue arrancable hasta el final de la fase. |
| La certificacion SII se alarga por rechazos | Validacion XSD y tests de vectores antes de enviar; el generador del set es repetible; dos semanas dedicadas solo a certificacion. |
| Perdida o filtracion de certificados | Cifrado por sobre, clave maestra fuera de la base, acceso auditado, nunca en respaldos sin cifrar. |
| Folios duplicados o perdidos | Bloqueo transaccional, restriccion unica, test de concurrencia con 50 emisiones paralelas. |
| El rediseno retrasa funciones | Fase 2 corre en paralelo y por modulo; el modo operador se entrega primero porque es el que vende. |
| Offline genera cobros duplicados | Idempotencia por `client_uuid`, tarjeta solo con conexion, reconciliacion visible al sincronizar. |

## 6. Primeros 10 dias

1. Fase 0 completa: `tenant_settings`, tótems, respaldos, limites de plan, tests de aislamiento, CI.
2. Docker Compose con Postgres y esquema Drizzle inicial.
3. `src/ui/` con tokens, `Button`, `Field`, `Sheet`, `DataView` y el shell nuevo (navegacion por rol).
4. En paralelo, gestion del negocio: certificado digital e inscripcion del RUT emisor en el ambiente de certificacion del SII, para que esten listos cuando empiece la Fase 3.
