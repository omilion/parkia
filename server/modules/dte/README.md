# Modulo DTE - Facturacion electronica SII

Integracion directa con el SII para emitir boletas (39, 41), facturas (33, 34) y notas de credito y debito (61, 56). Plan completo en `docs/PARKIA_PLAN_V2.md`, seccion 3.

## Estado

| Pieza | Archivo | Estado |
|---|---|---|
| Cifrado de secretos por tenant (AES-256-GCM por sobre) | `server/platform/secrets.ts` | Listo |
| Carga de certificado `.pfx` / `.p12` | `providers/sii/cert.ts` | Listo |
| Lectura y validacion de CAF | `providers/sii/caf.ts` | Listo |
| XML de boleta sin cliente, factura y notas | `providers/sii/builder.ts` | Listo, valida contra XSD oficial |
| Timbre electronico (TED) | `providers/sii/ted.ts` | Listo |
| Firma XMLDSig perfil SII | `providers/sii/signer.ts` | Listo |
| Sobres EnvioBOLETA / EnvioDTE | `providers/sii/envelope.ts` | Listo, valida contra XSD oficial |
| Semilla, token, envio y estados | `providers/sii/auth.ts`, `client.ts` | Listo, probado con red simulada |
| Codigo PDF417 del timbre | `pdf417.ts` | Listo |
| Tablas y asignacion de folios | `migration.ts` | Listo, **sin registrar** en `server/db/schema.ts` |
| Script de prueba contra Maullin | `scripts/dte-smoke.ts` | Listo |
| Servicio con base de datos, colas y rutas | — | Pendiente |
| Asistente de configuracion (UI) | — | Pendiente |
| Generador del set de pruebas del SII | — | Pendiente |
| Representacion impresa (PDF carta y termica) | — | Pendiente |

Tests: `npm run test:dte` (25 pruebas, sin red). Incluyen validacion contra los XSD oficiales en `providers/sii/xsd/` y una verificacion independiente de la canonicalizacion de la firma.

## Decisiones

- **Boleta sin cliente es el caso por defecto.** Sin receptor, el XML lleva solo `<RUTRecep>66666666-6</RUTRecep>`; no se piden ni guardan datos personales. La factura es la excepcion y exige receptor completo.
- **Montos enteros en pesos.** Boleta: los montos de linea incluyen IVA y el neto se desglosa. Factura y notas: los montos de linea son netos y el IVA se suma.
- **La firma se aplica dentro del sobre final**, en el mismo contexto de namespaces en que el SII la verifica. Por eso `buildDte` entrega el `<DTE>` sin firmar y `buildEnvelope` firma cada documento y luego el `SetDTE`.
- **El texto se escapa igual que C14N** (`& < >`), para que la cadena firmada del TED sea identica a la que el SII reconstruye.
- **Produccion bloqueada por defecto.** `getSiiEndpoints("produccion")` falla salvo `allowProduction: true`.
- **Secretos cifrados** con `PARKIA_MASTER_KEY`. El texto cifrado queda ligado al tenant y al proposito: no sirve si se copia a otro tenant o a otro campo.

## Probar contra Maullin (certificacion)

Requisitos del negocio (no son codigo):

1. **Certificado digital** de firma electronica de la persona que enviara los documentos, en `.pfx` o `.p12`, con su clave. Debe estar autorizada para la empresa en sii.cl.
2. **Empresa inscrita en el ambiente de certificacion** del SII (postulacion como emisor electronico, con el RUT de la empresa).
3. **CAF de prueba** tipo 39 descargado desde el ambiente de certificacion (Maullin).
4. **Fecha de autorizacion de pruebas** que muestra el SII; el numero de resolucion en certificacion es 0.

Pasos:

```powershell
$env:DTE_PFX_PATH="C:\certificados\mi-certificado.pfx"
$env:DTE_PFX_PASSWORD="clave-del-certificado"
$env:DTE_RUT_EMISOR="76123456-7"

# 1. El certificado autentica contra el SII (facturas y boletas)
npm run dte:smoke -- auth

# 2. Armar y firmar una boleta sin enviarla; revisar el XML en .\tmp-dte
$env:DTE_CAF_PATH="C:\certificados\FoliosSII76123456739.xml"
$env:DTE_RAZON_SOCIAL="Estacionamientos Ejemplo SpA"
$env:DTE_GIRO="Servicios de estacionamiento"
$env:DTE_DIRECCION="Av. Ejemplo 123"
$env:DTE_COMUNA="Santiago"
$env:DTE_FECHA_RESOLUCION="2026-11-01"
npm run dte:smoke -- boleta --dry-run

# 3. Enviarla y consultar el estado
npm run dte:smoke -- boleta
npm run dte:smoke -- status <trackId> boleta
```

Si el certificado no se puede abrir porque fue exportado con cifrado AES moderno, reexportarlo con `openssl pkcs12 -legacy`. Si el certificado no trae el RUT del titular, definir `DTE_RUT_ENVIA`. Cada boleta enviada consume un folio: usar `DTE_FOLIO` para avanzar.

`tmp-dte/`, `*.pfx` y `*.p12` estan en `.gitignore`.

## Puntos a confirmar con la documentacion vigente del SII

Marcados en el codigo como `VERIFICAR-SII`. Ninguno impide probar en certificacion; los errores de estos puntos aparecen como rechazo explicito del SII.

1. Rutas exactas de los servicios de boleta (`apicert`, `pangal`) y de facturas (`maullin`) — `endpoints.ts`.
2. Campos de la respuesta JSON del envio y del estado de boletas (`trackid`, `estado`, `estadistica`) — `client.ts`.
3. User-Agent exigido por el servicio de carga — `endpoints.ts`.
4. RUT generico de consumidor final (`66666666-6`) y texto de `RSR` en boletas sin receptor (`CONSUMIDOR FINAL`) — `rut.ts`, `builder.ts`.
5. Firma del TED sobre el DD aplanado en ISO-8859-1 — `ted.ts`.
6. IDK 100 = certificacion y vencimiento de 6 meses para CAF de facturas — `caf.ts`.
7. Duracion del token (se renueva cada 50 minutos) — `auth.ts`.
8. Ubicacion del RUT del titular dentro del certificado segun entidad emisora — `cert.ts`.
9. Lista de codigos de estado y rechazo — `errors.ts`.
10. Parametros del PDF417 para la representacion impresa — `pdf417.ts`.

## Siguientes pasos

1. Registrar `applyDteMigration` en `server/db/schema.ts` (o su equivalente en Drizzle al terminar la migracion a PostgreSQL).
2. `service.ts`: emitir por origen (ticket, cuota), tomar folio en transaccion, guardar documento, encolar envio.
3. Jobs: `dte.send` (agrupa boletas cada pocos minutos), `dte.poll-status`, `caf.low-stock`, `cert.expiring`.
4. Rutas y asistente de configuracion en 6 pasos (emisor, certificado, probar conexion, CAF, documento de prueba, paso a produccion).
5. Generador del set de pruebas y libros para completar la certificacion.
6. Representacion impresa carta y termica 80 mm con el PDF417.
