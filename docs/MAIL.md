# Módulo de correo (`server/platform/mail/`)

Un solo lugar para enviar correos. Quien necesita enviar uno (recuperación de clave, verificación de cuenta,
avisos de cobranza, boletas, pases de visita) llama a `sendMail` con una plantilla; nunca habla con un proveedor.

```ts
import { sendMail } from "../../platform/mail";

await sendMail({
  to: "cliente@ejemplo.cl",
  template: "notice",                          // ver server/platform/mail/templates.ts
  data: { title: "Tu cuota vence pronto", paragraphs: ["Vence el día 5."], cta: { label: "Pagar", url } },
  tenantRef: tenantId,                         // informativo
  dedupeKey: `past_due:${paymentId}:2026-11`,  // opcional: el mismo aviso no sale dos veces
});
// -> { status: "sent" | "queued" | "skipped" | "duplicate" | "failed", id }
```

## Configuración
| Variable | Valores |
|---|---|
| `PARKIA_MAIL_TRANSPORT` | `console` (desarrollo), `memory` (pruebas), `smtp`, `resend`, `disabled`. Sin definir: memoria en pruebas, consola en desarrollo, **deshabilitado en producción** |
| `PARKIA_MAIL_FROM` | Remitente verificado, p. ej. `Parkia <no-reply@tu-dominio.cl>` (obligatorio con `smtp`/`resend`) |
| `PARKIA_SMTP_URL` | `smtps://usuario:clave@host:465` (Amazon SES SMTP, Mailgun, Google Workspace, servidor propio) |
| `RESEND_API_KEY` | Clave de la API de Resend |

En producción nunca se "simula" un envío: sin proveedor configurado el correo queda `skipped`, y el chequeo
de preparación (`/api/health/details`, id `mail`) lo marca **crítico**. Antes de producción hay que verificar el
dominio del remitente (SPF y DKIM) en el proveedor, o los correos llegarán a spam.

## Bandeja de salida (`mail_outbox`)
- Cada correo se registra y se intenta enviar al instante.
- Si el proveedor falla de forma recuperable (red, 5xx, 429), queda en cola y el trabajo `mail.send-pending`
  (cada 15 min) lo reintenta con espera creciente (1, 5, 15, 60 y 360 min; máximo 6 intentos).
  Rechazos definitivos (casilla inexistente, 4xx) no se reintentan.
- **Correos con enlace secreto** (`password_reset`, `email_verification`; ver `SENSITIVE_TEMPLATES`): no se guarda
  su contenido ni se reintentan; si fallan, el usuario pide uno nuevo. Así una filtración de la base no entrega enlaces vigentes.
- Los correos resueltos se eliminan a los 90 días (datos personales, Ley 21.719).
- Tabla de plataforma: sin RLS, solo la usa el servidor. Por eso su columna se llama `tenant_ref` y no `tenant_id`
  (el catálogo de pruebas exige RLS en toda tabla con `tenant_id`).

## Agregar una plantilla
1. Declarar sus datos en `TemplateData` (`templates.ts`) y su función en `templates`. Todo dato se escapa con `escapeHtml`; los enlaces pasan por `assertSafeUrl` (solo http/https).
2. Si el enlace lleva un secreto, agregarla a `SENSITIVE_TEMPLATES`.
3. Probarla en `tests/mail/mail.test.ts`.

## Usos actuales
- **Recuperación de clave**: `POST /api/auth/forgot-password` envía `/restablecer?token=…` (vence en 30 min; máximo 3 correos por hora y dirección; la respuesta no revela si la dirección existe). Pantallas: "¿Olvidaste tu clave?" en el ingreso y `/restablecer`.

## Pruebas
- `tests/mail/mail.test.ts`: plantillas (escape, enlaces), configuración, transportes Resend y SMTP.
- `tests/api.test.ts`: recuperación de clave de punta a punta, reintentos, deduplicación y retención en SQLite, pglite y PostgreSQL.
