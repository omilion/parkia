# Traspaso: Fase 6 (SaaS) en paralelo con la Fase 5

Documento para el agente que implemente la **Fase 6** del plan (`docs/PARKIA_PLAN_V2.md`, sección 2). Mientras tanto,
otro agente trabaja en la **Fase 5** (PWA del operador, offline, impresión): no toquen los mismos archivos.

## Prompt sugerido
> Implementa la Fase 6 de Parkia siguiendo `docs/FASE6_TRASPASO.md` y `docs/PARKIA_PLAN_V2.md`. Trabaja en tu propia
> rama y worktree (`git worktree add ../Parkia-fase6 -b fase6-saas`). Avanza por los subpasos 6.1 a 6.6 en ese orden,
> con un commit por subpaso y `npm run verify` en verde antes de cada uno. No toques lo que el documento marca como
> "zona de la Fase 5". Si necesitas una decisión de negocio que el documento marca como pendiente, déjala configurable y avísame.

## Estado de partida (rama `sprint3-branch-filters`)
Ya existe y **no hay que rehacer**:
- **Multi-tenant** con aislamiento por RLS en PostgreSQL. Tablas: `tenants` (`status`: active/suspended/archived), `plans` (`max_branches`, `max_spaces`, `max_users`, `monthly_ticket_limit`, `price_clp`), `tenant_memberships` (`owner`/`admin`/`member`), `subscriptions` (`status`: trialing/active/past_due/suspended/cancelled, `current_period_start/end`).
- `requireUsableTenantSubscription` (`server/tenant.ts` → `server/platform/tenant/service.ts`) bloquea escrituras con suscripción inactiva; `assertPlanLimit` aplica límites de plan. **Los estados existen, falta su ciclo automático y los avisos.**
- Administradores de plataforma: variable `PARKIA_PLATFORM_ADMINS` + `isPlatformAdmin`.
- **Correo** (`server/platform/mail/`, ver `docs/MAIL.md`): `sendMail({ to, template, data, dedupeKey })`, plantillas `password_reset`, `email_verification`, `notice` (genérica), bandeja de salida con reintentos, job `mail.send-pending`. Los correos con enlace secreto no guardan su contenido.
- **Pagos** (`server/modules/payments/`, ver `docs/PAYMENTS.md`): interfaz `PaymentGateway`, Webpay Plus, pasarela simulada, `payment_intents`, conciliación. **Webpay Oneclick NO existe** (inscripción de tarjeta + cargos recurrentes): es una interfaz distinta a crear.
- **DTE/SII** (`server/modules/dte/`): cada tenant emite con su certificado y CAF. Para facturar la suscripción, Parkia misma sería un emisor: decidir si es un tenant "plataforma" (recomendado) con su propia configuración SII.
- Rutas públicas sin sesión: patrón en `server/modules/payments/routes.ts` y `server/modules/tickets/pricing-routes.ts` (registrar **antes** de `app.use("/api", requireAuth)` en `server/routes.ts`; límite con `allowPublicAttempt`; URLs con `publicBaseUrl(req)`; `originGuard` solo se exime para retornos de pasarela y webhooks).
- Páginas públicas del frontend: se detectan por `window.location.pathname` al inicio de `src/App.tsx` (`/validar`, `/pagar/…`, `/restablecer`).

## Subpasos (en este orden)
**6.1 Alta autoservicio** — `/registro` crea tenant + sucursal + staff owner + `subscriptions` en `trialing` (15 días). Verificación de correo con la plantilla `email_verification` (ya existe; vence a las 24 h). Sin verificar no se puede operar. Protecciones: límite por IP y por correo, no revelar si un correo ya existe, RUT y nombre validados con los esquemas compartidos.

**6.2 Asistente de inicio** — sucursal → plazas (carga masiva, reutilizar la importación existente) → tarifa (`rate_plans`, Fase 4A) → usuarios → primer ticket de prueba. Debe poder retomarse.

**6.3 Ciclo de la suscripción** — job `subscriptions.lifecycle` (agregar en `server/platform/jobs/index.ts`): `trialing` vence → `past_due` (7 días de gracia) → `suspended`; avisos por correo con `sendMail` y `dedupeKey` (p. ej. `trial_ending:{tenant}:{fecha}`). Suspender = solo lectura + exportación de datos, nunca borrar.

**6.4 Panel `/plataforma`** — rol separado (no es un rol de tenant): tenants, consumo contra límites, estado SII, suspensión/reactivación. **Suplantación auditada** para soporte: sesión con marca visible, tiempo limitado, registro en `audit_events` con quién y por qué; revisar con especial cuidado.

**6.5 Ley 21.719** — política de retención por tabla (documentada y aplicada por job), exportación y eliminación por titular (RUT o patente) con anonimización donde exista obligación tributaria de conservar, registro de consentimiento, plantilla de contrato de encargado de tratamiento.

**6.6 Cobro de la suscripción** — **al final: tiene bloqueos externos.** Tabla de UF diaria (fuente: Banco Central o mindicador.cl; guardar histórico y no depender de la red al cobrar), planes en UF, cargo mensual por Oneclick y factura por el módulo DTE. Programar contra un adaptador simulado; no se puede probar real hasta contratar Oneclick y certificar a Parkia como emisor.

## Decisiones de negocio pendientes (no inventar; dejar configurable)
- Precio de cada plan en UF y límites por plan.
- Proveedor de correo definitivo (SMTP o Resend) y dominio del remitente.
- Si Parkia factura desde un tenant "plataforma" y con qué razón social/RUT.
- Contrato de Oneclick con Transbank.

## Reglas para trabajar en paralelo (evitar choques con la Fase 5)
**Zona de la Fase 5 (no tocar):** `src/features/operator/`, `vite.config.*`, service worker/manifest, impresión, y la idempotencia por `client_uuid` en `server/modules/tickets/` y `server/modules/cash/`.

**Archivos calientes compartidos** (cambios mínimos y localizados; yo resuelvo los conflictos al integrar): `server/db/schema.ts`, `server/db/schema/index.ts`, `server/db/rls.sql`, `server/db/migrations/meta/_journal.json`, `server/routes.ts`, `server/platform/jobs/index.ts`, `package.json`, `src/App.tsx`, `tests/api.test.ts`.
- **Migraciones SQLite:** usa ids que empiecen en `070_` (la Fase 5 usa `063_`–`069_`; el último existente es `062_mail_outbox`). Agrega siempre al final del arreglo.
- **Migraciones Drizzle:** genera con `npm run db:generate -- --name <descriptivo>`; la numeración `0006_…` puede chocar al integrar y se reordena entonces. Nunca edites migraciones ya creadas.
- **Tests nuevos en archivos propios** (`tests/saas/*.test.ts`), no en `api.test.ts` (que es enorme y se pisa). Si necesitas el arnés del servidor, copia el arranque de `tests/api.test.ts` (líneas 1–60) o extráelo a `tests/support/`. Agrega un script `test:saas` y súmalo a `verify`.
- Toda tabla con columna `tenant_id` debe quedar en `server/db/rls.sql` **y** en `TENANT_SCOPED_TABLES`, o ser una tabla de plataforma (nombre la columna `tenant_ref` o agrégala a `PLATFORM_TABLES_WITH_TENANT_ID` en `server/db/client.ts`).

## Convenciones del proyecto
- Esquema dual: `server/db/schema.ts` (SQLite) + `server/db/schema/index.ts` (Drizzle/Postgres) + migración generada; `npm run db:compare-schemas` debe quedar sin diferencias.
- SQL escrito en dialecto SQLite; se traduce a Postgres. Fechas y horas con `datetime('now')`.
- Validación compartida con Zod en `shared/schemas/` (formularios y API usan las mismas reglas).
- Toda escritura del frontend pasa por `useApiMutation` (hay un test que lo exige). Textos de interfaz en español de Chile, accesibles (axe en las rutas nuevas: agrégalas a `tests/e2e/accessibility.spec.ts`).
- Secretos por empresa con `encryptSecret`/`decryptSecretString` (`server/platform/secrets.ts`); nunca en respuestas ni logs.
- Los commits terminan con la línea `Co-Authored-By` indicada por el entorno; nunca `--no-verify`.

## Criterio de terminado de cada subpaso
`npm run verify` en verde (lint, build, SQLite, unitarios, DTE, comparación de esquemas, pglite) **y** `npm run test:postgres` (requiere Docker Desktop con el contenedor `parkia-postgres` en el puerto 55432) **y** `npx playwright test` completo.
