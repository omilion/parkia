# Fase 7 - Dispositivos, notificaciones, portal del abonado y reservas

Código en `server/modules/phase7/`, pantallas en `src/features/phase7/` (`/dispositivos`, `/reservas`, `/portal`), reglas compartidas en `shared/schemas/{devices,notifications,portal,phase7}.ts`. Pruebas en `tests/phase7/` (se ejecutan con `npm run verify`).

## 7.1 Dispositivos (cámaras LPR, barreras, tótems, POS)

Cada dispositivo se registra en **Dispositivos** (administrador) y recibe una **clave propia** (`pk_dev_...`). Se muestra una sola vez; en la base solo queda su hash SHA-256. No usa sesión de personal: un dispositivo robado se revoca borrándolo.

| Ruta | Quién | Para qué |
|---|---|---|
| `POST /api/devices` | admin | Registrar. Devuelve la clave una sola vez |
| `GET /api/devices`, `GET /api/devices/events` | admin, guardia | Listar dispositivos y últimos 50 eventos |
| `POST /api/devices/:id/commands` | admin, guardia | Abrir o cerrar la barrera, ping |
| `DELETE /api/devices/:id` | admin | Revocar |
| `POST /api/device/v1/events` | dispositivo | Eventos de la cámara (cabecera `X-Device-Key` o `Authorization: Bearer`) |
| `GET /api/device/v1/commands/poll`, `POST .../commands/:id/ack` | dispositivo | La barrera consulta sus órdenes y las confirma |

**Cámaras LPR.** El evento acepta la patente en `plate`, `licensePlate` (Hikvision) o `PlateNumber` (Dahua). La decisión:

- **Abonado** con contrato activo: autoriza, en entrada o salida (`abonado_activo`).
- **Cámara de salida**: el último ticket de la patente decide. `paid` abre la barrera (`ticket_pagado`); `active` la deja cerrada (`ticket_pendiente_de_pago`); un ticket ya `completed` también la deja cerrada (`ticket_ya_cerrado`: el auto ya salió con él, lo revisa una persona).
- Sin ticket ni contrato: solo se registra el evento; la barrera no se mueve.
- Solo las decisiones reales (autorizar o negar) van a la bitácora de accesos; el evento siempre queda en `device_events`.
- Si se autoriza, se encola una orden `open_barrier` para la barrera de la misma sucursal.

**Barrera Shelly.** Con `vendor=shelly` y `endpoint_url`, el servidor llama al relé por HTTP (`?turn=on|off`). Cualquier otra barrera consulta sus órdenes (*polling*).

### Seguridad de la URL del relé (SSRF)
La URL la escribe cada empresa y el servidor la llama, así que se valida al registrar **y antes de cada llamada** (`relayUrl.ts`):

- Solo `http`/`https`, sin usuario ni clave, sin redirecciones, tiempo máximo 5 s.
- **Siempre bloqueado:** la propia máquina (`127.0.0.1`, `::1`, `0.0.0.0`), enlace local (`169.254.0.0/16`, incluye el servicio de metadatos de la nube), multicast, CGNAT, y los nombres `localhost`, `*.internal`, `*.local`.
- **Redes privadas** (`10/8`, `172.16/12`, `192.168/16`, `fc00::/7`): bloqueadas por defecto, porque un servicio en la nube no debe hablar con su red interna ni la del cliente le es alcanzable. En una **instalación local** (el servidor dentro del estacionamiento), definir `PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS=true`.
- Límite conocido: entre la comprobación y la conexión un DNS malicioso podría cambiar su respuesta (*DNS rebinding*). Para un relé usa una IP fija o un nombre bajo tu control.

## 7.2 Notificaciones (correo y WhatsApp)

- Plantillas: `fee_due_soon`, `fee_overdue`, `receipt_boleta`, `visitor_pass_qr`. Cada envío queda en `notification_outbox` (estado, intentos, error, id del proveedor) con reintentos (máximo 5) en el job `notifications.dispatch`, cada 5 minutos. `dedupe_key` evita duplicados.
- `POST /api/notifications/send` (admin, finanzas) y `GET /api/notifications/outbox`.
- **Correo:** usa el módulo de correo (`docs/MAIL.md`).
- **WhatsApp Business (Meta Cloud API):** `WHATSAPP_ACCESS_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`. Sin ellas se usa un transporte en memoria (pruebas).
- **Hoy no hay envíos automáticos:** los dispara una persona por la API. Qué recibe cada abonado y con qué consentimiento es **responsabilidad de la empresa**: WhatsApp Business exige consentimiento previo (*opt-in*) y la Ley 21.719 exige base legal para tratar el dato. No hay aún registro de consentimiento ni baja (*opt-out*) por canal; hay que agregarlos antes de automatizar recordatorios masivos.

## 7.3 Portal del abonado

Ingreso sin clave por **enlace mágico**: `/portal` → correo → `/portal?token=...`.

- El token tiene 192 bits, solo se guarda su hash, **vence a los 30 minutos y es de un solo uso (atómico)**: dos peticiones simultáneas con el mismo enlace abren una sola sesión.
- Como máximo **3 enlaces por persona por hora** y límites por dirección IP (pedir enlaces: 10 cada 10 min; probar enlaces: 20). La respuesta es siempre la misma, exista o no el correo.
- El enlace del correo usa `APP_URL`, no el encabezado `Host` de la petición.
- La sesión dura 7 días en una cookie `HttpOnly; SameSite=Lax` (y `Secure` con HTTPS, igual que la sesión del personal).
- `GET /api/portal/me`: cuotas, vehículos, contratos, facturas y documentos del abonado, solo los suyos.
- **Pagar una cuota no la marca como pagada.** `POST /api/portal/payments/:id/pay` entrega el enlace de pago de la cuota (`/pagar/r_...`, ver `docs/PAYMENTS.md`) y el portal lleva al abonado a la pasarela. La cuota solo pasa a pagada cuando la pasarela lo confirma. Requiere una forma de pago activa en Configuración > Pagos.

## 7.4 Reservas y reajuste automático

**Reservas** (`/reservas`): rango horario, patente, plaza opcional; no permite superponer reservas de la misma plaza; se puede hacer *check-in* (llegada) o cancelar.

**Reajuste de contratos** (`contracts.reajuste`, día 1 de cada mes a las 07:00, hora de Santiago, y a mano con `POST /api/contracts/:id/reajuste`):

- `adjustment_index = ipc`: sube la mensualidad por la variación del IPC del **período actual** (`ipc_rates`). `uf`: por la variación de la UF desde el último reajuste.
- Cada reajuste queda en `contract_adjustments` y es **idempotente por contrato, índice y período**: repetirlo no lo aplica dos veces.
- **El IPC es un dato de la plataforma**, común a todas las empresas: lo carga solo un administrador de plataforma (`POST /api/contracts/reajuste/ipc`, `PARKIA_PLATFORM_ADMINS`); cualquier administrador de empresa puede leerlo. Se acepta una variación mensual entre -5% y +10%.
- Límites: el IPC del mes en curso no existe el día 1 (el INE lo publica a inicios del mes siguiente), así que mientras no se cargue el período el job no ajusta nada y **no avisa**; y no hay carga automática del IPC (como la UF desde mindicador.cl). Las cuotas ya generadas conservan su monto; el nuevo se usa en las siguientes.

## Pendientes conocidos
- La cámara autoriza la salida y abre la barrera, pero **no cierra el ticket ni libera la plaza**: el ticket sigue `paid` hasta que una persona lo completa. Falta decidir si la salida por cámara debe completarlo.
- Un ticket `paid` abre la barrera sin revisar si venció el plazo de salida tras el pago.
- Cámaras y relés **no se han probado con hardware real**: Hikvision, Dahua y Shelly están probados con eventos y adaptadores simulados.
- Notificaciones: consentimiento y baja por canal, y envíos automáticos de recordatorios de cuota.
- IPC: carga automática desde una fuente oficial y aviso cuando falta el período.
- Los límites de frecuencia de las rutas públicas viven en memoria (se pierden al reiniciar y no se comparten entre instancias).
