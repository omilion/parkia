# Operador sin conexión, impresión y escaneo (Fase 5)

## Qué cubre
| Capacidad | Dónde |
|---|---|
| App instalable (PWA): manifest, iconos, shell sin red, aviso de actualización | `vite.config.ts`, `public/icons/`, `src/app/PwaUpdatePrompt.tsx` |
| Entradas, cobros en efectivo y salidas sin red, con cola y sincronización automática | `src/features/operator/offline/`, `server/modules/operator/` |
| Cotizar sin red con el mismo motor que el servidor | `shared/pricing-engine.ts`, `shared/offline-pricing.ts` |
| Impresión térmica 58/80 mm (Bluetooth/USB) con respaldo al diálogo del sistema | `src/features/operator/printing/` |
| Lectura del QR del ticket con la cámara | `src/features/operator/scanning/` |

## PWA
- `registerType: 'prompt'`: la actualización la elige el usuario (un guardia en medio de un cobro no pierde la pantalla).
- El service worker solo guarda el *shell* (JS, CSS, HTML, iconos, fuentes). **Los datos de negocio no se cachean ahí**: viven en IndexedDB con su propia política.
- La app abre sin red con el último usuario conocido (`parkia.cachedUser` en `localStorage`; se borra al cerrar sesión o ante un 401). La sesión sigue siendo la del servidor: si venció, las operaciones guardadas esperan hasta volver a ingresar (no se pierden).
- Los iconos salen de `npx tsx scripts/generate-pwa-icons.ts`.

## Modelo sin conexión
Cada operación lleva un `client_uuid` y la hora del dispositivo. Se guardan en IndexedDB (Dexie) antes de enviarse.

1. **Instantánea** (`GET /api/operator/snapshot?branch_id=`): plazas, tickets abiertos con sus convenios, catálogo de tarifas (las vigentes y la versión con que entró cada ticket abierto) y datos de la empresa. Se refresca cada 30 s con red.
2. **Proyección** (`projectTickets`, función pura): lo que ve el operador es la última instantánea más las operaciones locales aún no reflejadas (entrada → aparece, cobro → pagado, salida → desaparece).
3. **Cotización local** (`quoteTicketLocally`): usa la tarifa del ticket (o la vigente a su hora de entrada) con `quoteForDevice`, la misma función que usa el servidor para sus cotizaciones.
4. **Sincronización** (`POST /api/operator/sync`, lotes de hasta 50 en orden): idempotente por `client_uuid`. Reenviar un lote nunca duplica.

### Reglas del servidor al aplicar (`server/modules/operator/sync.ts`)
- **Hora**: la informa el dispositivo pero se acota: nunca en el futuro (reloj adelantado → hora del servidor, con aviso) y no más de 14 días atrás (si no, se rechaza).
- **Cobro**: el servidor recalcula con la hora real del pago. Si lo cobrado difiere, **igual se registra** (el dinero ya cambió de manos) y queda una advertencia; si fue menor, queda marcado como excepción.
- **Rechazos** (`PLATE_ACTIVE`, `ALREADY_PAID`, `NOT_PAID`, `ENTRY_UNKNOWN`, `ENTRY_REJECTED`, `TICKET_NOT_FOUND`, `TOO_OLD`, `BRANCH_INVALID`): se registran y quedan auditados; no se reintentan solos. En Operar aparecen en "Operaciones que requieren revisión" hasta que una persona las descarta.
- **Sin plaza libre**: el auto ya está dentro, así que la entrada se registra igual, sin plaza asignada.
- **QR del ticket**: el token (`t_…`) se genera en el dispositivo para imprimirlo antes de tener red; si el servidor ya lo tenía en uso lo reemplaza y avisa.
- Solo **efectivo** sin red: la tarjeta necesita a la pasarela.

### Caja
La caja **no se puede cerrar con operaciones sin enviar** (el botón se deshabilita): un cobro en efectivo sincronizado después del cierre descuadraría el turno.

### Límites conocidos
- Convenios y ticket perdido requieren conexión (el convenio sí se respeta si ya estaba aplicado al ticket cuando se descargó la instantánea).
- Un ticket creado por otra persona *después* de la última instantánea no se ve sin red.
- No se aplica el límite de tickets del plan a las entradas sincronizadas (el auto ya está físicamente dentro).
- La boleta electrónica se emite al sincronizar el cobro (Fase 3); el comprobante impreso sin red no lleva timbre y lo dice.

## Impresión
- **Documento neutro** (`document.ts`) → dos renderizadores: **ESC/POS** (`escpos.ts`) y **HTML** (`html.ts`). El contenido de los tickets vive en un solo lugar.
- ESC/POS: texto en CP858 (`ESC t 19`), 32 columnas en 58 mm y 48 en 80 mm. **QR y timbre PDF417 se envían como imagen** (`GS v 0`, en franjas de 64 filas), no con comandos nativos de códigos de barras, que cambian de marca en marca. El servidor entrega el timbre como PNG (`GET /api/operator/tickets/:id/receipt`).
- **Transportes**: Web Bluetooth (BLE; servicios 18F0, FFE0, FF00 y los de Microchip/ISSC) y WebUSB (interfaz de clase impresora). Solo Chrome/Edge; iPhone/Safari usa la impresión del sistema.
- **Respaldo**: si no hay térmica conectada, o falla a medio camino, se abre el diálogo de impresión del sistema con una página de 58/80 mm. Un ticket nunca queda sin imprimir por un cable suelto. La impresión **automática** solo ocurre con térmica conectada.
- El ticket de entrada lleva el QR de pago (`/pagar/:token`): el cliente puede pagar desde su teléfono (Fase 4B).

## Escaneo del QR
`BarcodeDetector` nativo cuando existe; si no, jsQR (JavaScript puro, sin WASM, funciona sin red). La búsqueda es primero local (sirve sin red) y luego `GET /api/operator/tickets/lookup?token=`. Las pruebas confirman que el QR que imprimimos (58 mm, 80 mm y HTML) se lee de vuelta.

## Qué NO está hecho (y por qué)
- **Lectura de patente con la cámara (OCR).** `BarcodeDetector` solo lee códigos, no texto. Un OCR en el navegador (Tesseract.js) pesa varios MB, descarga modelos y es poco fiable con patentes chilenas en la calle. Lo correcto es una **cámara LPR** conectada por la API de dispositivos de la Fase 7 (adaptadores Hikvision/Dahua), o decidir explícitamente un OCR en el dispositivo y medir su precisión. Mientras tanto la patente se escribe o se lee el QR del ticket.
- **Hardware real.** El ESC/POS, Bluetooth y USB están probados con dispositivos simulados y con los bytes decodificados, pero **no contra una impresora física**. Antes de entregar a un cliente hay que probar con su modelo (58 y 80 mm) y ajustar la tabla de caracteres, el ancho útil en puntos o el tamaño de los trozos Bluetooth si hace falta.
- **Pagos con tarjeta sin red** (por diseño: requieren pasarela).

## Pruebas
- `tests/operator/offline-queue.test.ts`: proyección, cola, lotes, reintentos, sesión vencida, concurrencia (IndexedDB simulado).
- `tests/operator/printing.test.ts`: bytes ESC/POS, tramas, ambos anchos, HTML, transportes Bluetooth/USB simulados, respaldo.
- `tests/operator/scanning.test.ts`: lectura de vuelta del QR impreso, bucle de cámara, errores de permiso.
- `tests/operator/operator-sync.test.ts` (SQLite y pglite): idempotencia, rechazos, hora acotada, paridad de cotización dispositivo/servidor, comprobante y búsqueda por token.
- e2e: `pwa`, `operator-offline` (corta la red, opera, recarga sin red y sincroniza), `operator-printing`, `operator-scan` (con axe en los diálogos).
