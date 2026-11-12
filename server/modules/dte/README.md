# Modulo DTE - Facturacion electronica SII

Integracion directa con el SII para emitir boletas (39, 41), facturas (33, 34) y notas de credito y debito (61, 56). Plan completo en `docs/PARKIA_PLAN_V2.md`, seccion 3.

## Como funciona (resumen)

Cada empresa (tenant) hace su propio onboarding en **Configuracion > Facturacion SII**. Nada se comparte entre empresas: cada una carga su certificado digital, sus folios (CAF) y su resolucion del SII.

1. **Emisor**: RUT, razon social, giro, actividades, direccion, unidad del SII.
2. **Certificado**: `.pfx`/`.p12` + clave. Se guarda cifrado y no vuelve a mostrarse.
3. **Conexion**: el SII autentica el certificado (facturas y boletas).
4. **Folios**: el CAF de boletas (tipo 39) descargado del portal del SII.
5. **Set de pruebas**: genera y envia boletas de prueba al ambiente de certificacion (Maullin) y espera la respuesta.
6. **Produccion**: con la resolucion del SII; desde aqui cada ticket cobrado emite su boleta real.

Hasta que la empresa pasa a produccion **nunca se emiten documentos reales**: en certificacion solo se envian los del set de pruebas.

## Estado

| Pieza | Archivo | Estado |
|---|---|---|
| Cifrado de secretos por tenant (AES-256-GCM por sobre) | `server/platform/secrets.ts` | Listo |
| Carga de certificado `.pfx` / `.p12` | `providers/sii/cert.ts` | Listo |
| Lectura y validacion de CAF | `providers/sii/caf.ts` | Listo |
| XML de boleta sin cliente, factura y notas | `providers/sii/builder.ts` | Listo, valida contra XSD oficial |
| Timbre electronico (TED), firma XMLDSig, sobres | `providers/sii/ted.ts`, `signer.ts`, `envelope.ts` | Listo, valida contra XSD oficial |
| Semilla, token, envio y estados | `providers/sii/auth.ts`, `client.ts` | Listo, probado con red simulada |
| Tablas y folios atomicos | `migration.ts` (migracion `050_dte_module`) | Listo y registrada |
| Servicio: configuracion, certificado, CAF, emision, envio, estados, produccion | `service.ts` | Listo |
| API REST `/api/dte/*` | `routes.ts` | Listo |
| Trabajos en segundo plano (envio y consulta cada 15 min) | `server/platform/jobs` | Listo |
| Boleta automatica al cobrar un ticket (sin cliente) | `server/modules/tickets/service.ts` | Listo |
| Facturas y boletas de contratos por el modulo (`sii_direct`) | `server/sii.ts` | Listo |
| Boleta impresa (termica 80 mm y carta) con PDF417 | `print.ts` | Listo |
| Set de pruebas de certificacion (casos propios o de ejemplo) | `service.ts` | Listo |
| Asistente de onboarding (6 pasos) y lista de documentos | `src/features/dte/` | Listo |
| Alertas al administrador (certificado, folios, cola, rechazos) | `server/modules/dashboard/service.ts` | Listo |
| **Prueba contra el SII real (Maullin)** | — | **Pendiente: necesita el certificado y CAF de una empresa** |
| Notas de credito y debito desde la interfaz | — | Pendiente |
| Libros y reporte diario de boletas (RCOF) | — | Pendiente, confirmar si el SII lo exige para boletas |
| Representacion impresa en PDF del servidor | — | Pendiente (hoy es HTML imprimible) |

## Tests

`npm run test:dte` (42 pruebas, sin red): nucleo, cliente SII con red simulada, migracion y el servicio completo con una base en memoria (onboarding, folios, envio, reintentos, rechazos, aislamiento entre empresas, produccion, reconciliacion).
`npm test` incluye pruebas HTTP de roles, aislamiento y que ninguna respuesta filtre secretos. `tests/e2e/dte-wizard.spec.ts` recorre el asistente en telefono.
Los tests usan certificados y CAF sinteticos generados en memoria (`tests/dte/generators.ts`). Nunca se versionan archivos reales.

## Decisiones

- **Boleta sin cliente es el caso por defecto.** Sin receptor, el XML lleva solo `<RUTRecep>66666666-6</RUTRecep>`; no se piden ni guardan datos personales. La factura es la excepcion y exige receptor completo.
- **Montos enteros en pesos.** Boleta: los montos de linea incluyen IVA y el neto se desglosa. Factura y notas: los montos de linea son netos y el IVA se suma.
- **La firma se aplica dentro del sobre final**, en el mismo contexto de namespaces en que el SII la verifica.
- **El texto se escapa igual que C14N** (`& < >`), para que la cadena firmada del TED sea identica a la que el SII reconstruye.
- **Emitir no necesita el certificado; enviar si.** El documento se timbra con el CAF y queda en cola; si el certificado falta o venció, los documentos esperan sin perderse y se reintentan con espera creciente (1, 2, 4... hasta 60 min).
- **Un documento por origen.** Un ticket o una cuota genera como maximo un documento por tipo, aunque el cobro se repita o dos cajas cobren a la vez.
- **El cobro nunca depende de la boleta.** Si no se puede emitir, el pago queda confirmado, el motivo queda en `dte_events` y el trabajo de envio la emite despues (reconciliacion por tickets cobrados desde el paso a produccion).
- **Produccion con doble llave.** La empresa debe completar el paso 6 **y** el servidor debe tener `PARKIA_SII_ALLOW_PRODUCTION=true`. Para pasar a produccion el SII debe haber aceptado al menos una boleta de prueba y debe haber un CAF de produccion.
- **Secretos cifrados** con `PARKIA_MASTER_KEY`, ligados a la empresa y al proposito: un texto cifrado copiado a otra empresa no se descifra.
- **Un CAF de certificacion y uno de produccion conviven**; el ambiente se detecta del propio CAF.
- **Rangos de CAF** no pueden traslaparse. No se puede cambiar el RUT del emisor si ya hay folios cargados.

## Primera prueba real contra el SII (Maullin)

No hace falta para construir, pero si para saber que la integracion funciona. La puede hacer **cualquier empresa**, incluida la propia, desde el asistente:

1. Datos del emisor (paso 1) y certificado del titular autorizado en el SII (paso 2).
2. La empresa inscrita en el ambiente de certificacion del SII y su fecha de autorizacion de pruebas.
3. CAF de boletas (tipo 39) descargado del portal de **certificacion**.
4. Paso 3 (probar conexion), paso 5 con la fecha de resolucion de pruebas.

Tambien por linea de comandos, sin la app:

```powershell
$env:DTE_PFX_PATH="C:\certificados\mi-certificado.pfx"
$env:DTE_PFX_PASSWORD="clave-del-certificado"
$env:DTE_RUT_EMISOR="76123456-7"
npm run dte:smoke -- auth
$env:DTE_CAF_PATH="C:\certificados\FoliosSII76123456739.xml"
$env:DTE_RAZON_SOCIAL="Estacionamientos Ejemplo SpA"
$env:DTE_GIRO="Servicios de estacionamiento"
$env:DTE_DIRECCION="Av. Ejemplo 123"
$env:DTE_COMUNA="Santiago"
$env:DTE_FECHA_RESOLUCION="2026-11-01"
npm run dte:smoke -- boleta --dry-run   # arma y firma sin enviar
npm run dte:smoke -- boleta             # envia a certificacion
npm run dte:smoke -- status <trackId> boleta
```

Si el certificado no se puede abrir porque fue exportado con cifrado AES moderno, reexportarlo con `openssl pkcs12 -legacy`. `tmp-dte/`, `*.pfx` y `*.p12` estan en `.gitignore`.

## Puntos a confirmar con la documentacion vigente del SII

Marcados en el codigo como `VERIFICAR-SII`. Ninguno impide probar en certificacion; los errores de estos puntos aparecen como rechazo explicito del SII, nunca como un documento mal emitido en silencio.

1. Rutas exactas de los servicios de boleta (`apicert`, `pangal`) y de facturas (`maullin`) — `endpoints.ts`.
2. Campos de la respuesta JSON del envio y del estado de boletas (`trackid`, `estado`, `estadistica`) — `client.ts`.
3. User-Agent exigido por el servicio de carga — `endpoints.ts`.
4. RUT generico de consumidor final (`66666666-6`) y texto de `RSR` en boletas sin receptor (`CONSUMIDOR FINAL`) — `rut.ts`, `builder.ts`.
5. Firma del TED sobre el DD aplanado en ISO-8859-1 — `ted.ts`.
6. IDK 100 = certificacion y vencimiento de 6 meses para CAF de facturas — `caf.ts`.
7. Duracion del token (se renueva cada 50 minutos) — `auth.ts`.
8. Ubicacion del RUT del titular dentro del certificado segun entidad emisora — `cert.ts`.
9. Lista de codigos de estado y rechazo — `errors.ts`.
10. Parametros del PDF417 y textos de la representacion impresa — `pdf417.ts`, `print.ts`.
11. Resultado por documento dentro de un envio aceptado: hoy el estado del envio se aplica a todos sus documentos; el detalle por documento (rechazos individuales) se afinara con la respuesta real — `service.ts`.
12. Si el SII exige hoy el reporte diario de consumo de folios para boletas.
