# Pagos en línea (Fase 4B)

## Principio
Un ticket o una cuota pasan a **pagado solo cuando la pasarela lo confirma** (retorno + commit, webhook firmado
o conciliación). Nunca por lo que informe el navegador del cliente.

## Piezas (`server/modules/payments/`)
| Archivo | Rol |
|---|---|
| `gateway.ts` | Interfaz `PaymentGateway` (`createCharge`, `redirectFor`, `confirm`, `getStatus`, `refund`, `parseWebhook`), firma HMAC de webhooks y pasarela simulada |
| `webpay.ts` | Adaptador de **Webpay Plus** (API REST v1.2). Credenciales públicas de integración para pruebas |
| `service.ts` | `payment_intents`, ciclo de vida, configuración por empresa, conciliación, enlaces |
| `routes.ts` | Rutas públicas (sin sesión) y de personal |

## Flujo del ticket (QR)
1. El personal abre el ticket en Operar → "Cobro en línea (QR)" (`GET /api/visitors/:id/pay-link`). El token `t_…` es aleatorio y vive en `visitor_tickets.public_token`.
2. El cliente abre `/pagar/:token` (sin sesión): ve el monto calculado en ese momento y elige la forma de pago.
3. `POST /api/public/pay/:token/start` crea un `payment_intent` (monto fijado, `Idempotency-Key` opcional) y devuelve la redirección. Un doble clic reanuda el cobro vigente; no abre otro.
4. Webpay devuelve al cliente a `/api/public/payments/return/webpay` con `token_ws`; el servidor ejecuta el **commit**. Con `TBK_TOKEN` (anuló o venció) el intento queda cancelado.
5. Al confirmarse: el ticket queda `paid` (método tarjeta, sin caja de turno), con plazo de salida (`exit_deadline`), y se encola la boleta (Fase 3).

## Casos protegidos
- **Doble cobro** (el ticket se pagó en caja mientras el cliente pagaba en línea): se devuelve el dinero por la pasarela; se conserva el pago de caja.
- **Monto distinto** al del intento: no se aplica y se devuelve.
- **Reintentos** del retorno (F5) o del aviso: idempotentes; un solo pago.
- **Retorno que nunca llega**: el job `payments.reconcile` (cada 15 min) consulta a la pasarela y confirma lo cobrado, y vence los intentos abandonados.
- **Falla al aplicar** un pago ya cobrado (p. ej. mes contable cerrado): el intento queda `paid` con `failure_reason` y un evento `apply_failed` para resolución manual.

## Cuotas de abonados
`POST /api/payments/:id/pay-link` (admin/finanzas) genera un enlace `r_…` (14 días) que se reutiliza mientras esté vigente. Al pagar se registra la cuota con `markPaymentAsPaid` (método tarjeta, referencia `proveedor:autorización`).

## Webhooks
`POST /api/public/payments/webhook/:provider` exige `x-parkia-timestamp` y `x-parkia-signature` (`sha256=` HMAC de `timestamp.cuerpo`, tolerancia 5 min). El secreto se deriva de `PARKIA_MASTER_KEY`. Webpay Plus no usa webhooks; la pasarela simulada sí (así se prueba la ruta real).

## Configuración
Configuración → **Pagos en línea** (solo administrador): activar Webpay o la pasarela simulada, ambiente, código de comercio y llave secreta (cifrada por empresa, nunca se devuelve) y minutos para salir. En producción Webpay exige credenciales propias. La pasarela simulada no se habilita con `NODE_ENV=production` (salvo `PARKIA_ALLOW_MOCK_PAYMENTS=true`).

`APP_URL` define la URL de retorno que se entrega a Transbank; sin ella se usa el host de la petición.

## Pruebas
- `tests/payments/gateway.test.ts`: adaptador Webpay con `fetch` simulado y firmas.
- `tests/api.test.ts`: flujo completo (webhook, retorno, duplicados, cuotas, conciliación) en SQLite, pglite y PostgreSQL.
- `tests/e2e/payments.spec.ts`: el cliente paga desde el QR, con axe en las páginas públicas.

## Pendiente / decidido diferir
- **Mercado Pago (QR/Point), POS Getnet/Transbank y Webpay Oneclick** (suscripción con tarjeta): se eligen según el hardware del primer cliente y entran por la misma interfaz `PaymentGateway`.
- **Cumplimiento del plazo de salida** (`exit_deadline`): hoy se registra y se muestra; falta cobrar el exceso al salir después del plazo.
- **Reembolsos manuales** desde la interfaz: hoy solo automáticos (duplicados y montos distintos).
- **Certificación Transbank** para pasar a producción con credenciales propias.
