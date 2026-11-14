# Administrador de Parkia vs. administrador de un cliente

Parkia es un servicio que **Parkia** (la plataforma) vende a **empresas cliente** (estacionamientos). Hay dos administradores distintos y no se deben confundir:

| | Administrador de **plataforma** (Parkia) | Administrador de **empresa** (cliente) |
|---|---|---|
| Quién es | El dueño u operador de Parkia | El dueño o encargado de un estacionamiento |
| Qué ve | Todas las empresas (`/plataforma`) | Solo su empresa |
| Cómo se define | Correo en `PARKIA_PLATFORM_ADMINS` (entorno del servidor) + rol `admin` + correo verificado | Rol `admin` dentro de su empresa |
| Se puede otorgar desde la app | **No.** Solo cambiando el entorno del servidor | Sí, lo otorga otro administrador de la misma empresa |

## Qué es de cada uno

| Acción | Plataforma | Cliente |
|---|---|---|
| Cobrar la suscripción, registrar un pago por transferencia | ✔ | ✘ |
| Fijar la UF y el IPC (afectan a todas las empresas) | ✔ | ✘ (solo leer) |
| Suspender o reactivar una empresa | ✔ | ✘ |
| Entrar a una empresa como soporte (queda auditado) | ✔ | ✘ |
| Respaldar y restaurar la base completa | ✔ | ✘ |
| Ver su plan, su próximo cobro y su historial de cobros | — | ✔ |
| Inscribir o cambiar su tarjeta | — | ✔ |
| Su personal, tarifas, contratos, caja, SII, pagos de sus clientes | solo como soporte | ✔ |

Regla para código nuevo: **toda tabla sin `tenant_id` es de la plataforma** (`plans`, `subscriptions`, `tenants`, `uf_rates`, `ipc_rates`, …). Una ruta que escriba en una de ellas, o que mueva dinero entre Parkia y un cliente, lleva `requirePlatformAdmin`, nunca `requireAnyRole(["admin"])`.

## Cobro de la suscripción

El cliente **no se cobra a sí mismo**. En **Suscripción** ve su plan, la fecha y el monto estimado del próximo cobro, su historial, e inscribe su tarjeta.

Parkia cobra de dos formas:

1. **Automático** (job `subscriptions.charge`, todos los días a las 03:45): a cada empresa activa cuyo período terminó y que tiene tarjeta inscrita. Corre antes del ciclo de vida (04:00), así quien paga ese día no alcanza a quedar "vencido".
2. **A mano, desde `/plataforma`**: *Cobrar ahora* (a la tarjeta inscrita; hasta 7 días antes del término) o *Registrar pago* (dinero recibido por transferencia o depósito, con su referencia).

Reglas (`server/modules/saas/billing.ts`, `billingPeriod.ts`):

- **Un período se cobra una vez.** La fila del intento se crea antes de llamar a la pasarela, con una orden única por período e intento (`SUB-{empresa}-{fecha}-{n}`): dos ejecuciones simultáneas no cobran dos veces. Un segundo clic responde "aún no corresponde".
- **Continuidad.** El nuevo período empieza donde terminó el anterior si se paga a tiempo, con hasta 7 días de atraso o por adelantado. Solo si pasó más tiempo (empresa suspendida) empieza el día del pago.
- **UF real.** El monto de un plan en UF usa la UF del día del cobro. Con la UF de respaldo o una de más de 10 días **no se cobra**.
- **Rechazo.** No renueva. El job reintenta una vez al día; el ciclo de vida da 7 días de gracia y luego suspende.
- **Intento sin confirmar** (`processing`: el servidor cayó entre la pasarela y la base): no se reintenta solo, porque podría haberse cobrado. Se revisa con la pasarela y se regulariza con *Registrar pago*.
- **Pago por transferencia:** la referencia es única; registrar dos veces el mismo pago no renueva dos veces.
- Todo cobro o pago registrado por una persona queda en la bitácora de la empresa (`platform.subscription_charge`, `platform.subscription_manual_payment`).
- La factura la emite la empresa de Parkia (`PARKIA_PLATFORM_BILLING_TENANT_ID`), con su propio certificado y folios.

### Pasarela de tarjeta (Oneclick): estado real

**No existe todavía un adaptador real de Transbank Oneclick.** Lo que hay es una pasarela **simulada** que aprueba todo con códigos inventados; sirve para desarrollo y demostraciones.

- En producción la simulada está **bloqueada** (salvo `PARKIA_ALLOW_MOCK_PAYMENTS=true`): no se puede inscribir una tarjeta ni cobrar, y el cliente ve "el pago con tarjeta aún no está habilitado". Antes, un cliente podía "pagar" su suscripción sin que entrara dinero.
- Mientras no exista el adaptador real, en producción las suscripciones se cobran **por transferencia** y se registran con *Registrar pago*.
- Pendiente: implementar el adaptador de Oneclick Mall (inscripción con redirección a Webpay y autorización de cargos) y contratarlo con Transbank.

## Protección de la identidad de plataforma

Como la identidad de plataforma es un correo, ese correo está reservado:

- Una empresa no puede **crear** personal con un correo de `PARKIA_PLATFORM_ADMINS`, ni **cambiarle el correo** a alguien por uno de esos, ni registrarse con él.
- Un administrador de empresa no puede **cambiar la clave, los datos ni el estado** de un administrador de plataforma, aunque pertenezcan a la misma empresa. (Si pudiera, tomaría el control de la plataforma.)
- Un correo de plataforma **sin verificar** no da poderes.
- En producción, las acciones de plataforma exigen **verificación en dos pasos** (`PARKIA_PLATFORM_REQUIRE_2FA`, activa por defecto en producción). Quien puede cobrar, respaldar y entrar a todas las empresas no debe depender solo de una clave.

Recomendación operativa: usa para la plataforma una cuenta dedicada (por ejemplo `plataforma@tudominio.cl`), distinta de la que usas para operar un estacionamiento, y actívale 2FA.

## Pruebas
`tests/saas/billing.test.ts` (cobro, permisos, job, simulador en producción, concurrencia) y `tests/saas/platform-identity.test.ts`.
