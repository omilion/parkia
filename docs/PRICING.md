# Tarifas, convenios y ticket perdido (Fase 4A)

## Motor (`server/modules/tickets/pricing-engine.ts`)
Función pura `quote(plan, entrada, salida, { extraFreeMins })`, sin base de datos. Cumple la Ley 20.967:

- **per_minute**: minutos completos transcurridos, sin redondeo al alza.
- **elapsed_blocks**: tramos vencidos; primer tramo ≥ 30 min, siguientes ≥ 10 min.
- La gracia se descuenta desde el inicio; los convenios de minutos gratis la amplían.
- Tope diario por día calendario local (zona de la sucursal, con cambios de hora de Chile).
- Las reglas se eligen por día de semana y franja horaria (se admite cruzar medianoche); gana la mayor `priority`.
- `validatePlan` exige cubrir las 24 h de todos los días y respetar los mínimos legales.

## Versionado
Editar una tarifa crea una **versión nueva** (`group_id`, `version`) y archiva la anterior. El ticket guarda
`rate_plan_id` al entrar y se cobra siempre con esa versión. `resolveRatePlan` elige por sucursal > todas,
tipo de vehículo > todos y fechas de vigencia.

## Convenios
`free_minutes`, `percent` o `fixed` (con tope opcional). El código es **único global** porque la página
pública no conoce el cliente. Un comercio valida un ticket una sola vez (`ticket_validations`).

- Pública, sin sesión: `POST /api/public/validar` (`/validar` en la web). Limita intentos por IP y por código
  (`PARKIA_PUBLIC_RATE_LIMIT`, 20 cada 10 min) y enmascara la patente en la respuesta.
- Personal (admin, caja, guardia): `POST /api/visitors/:id/validations`. Caja y guardia no ven el código.

## Ticket perdido
Sin multa fija: se cobra el tiempo real. `POST /api/visitors/:id/lost-ticket` exige una nota de verificación y
admite evidencia (JPG/PNG/PDF); solo el administrador descarga la evidencia.

## API
`/api/rate-plans` (CRUD, `/:groupId/versions`, `/simulate`) y `/api/agreements` son solo para administración.

## Pendiente (Fase 4B)
Pasarelas de pago, `payment_intents`, página pública `/pagar/:token` y Webpay Plus.
