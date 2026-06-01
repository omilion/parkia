# Parkia - Documento Maestro De Desarrollo

Investigacion inicial: 2026-05-29. Este archivo es el punto de partida para transformar la base Luchin en Parkia, un SaaS multi-sucursal para estacionamientos.

## 1. Objetivo Del Producto

Parkia debe permitir que una empresa opere una o varias sucursales de estacionamiento desde una sola cuenta, con control de accesos, tickets, tarifas, caja por turno, contratos mensuales, reportes y usuarios por rol.

Definicion de MVP funcional:

- Crear empresa/tenant y al menos una sucursal.
- Crear plazas/cupos de estacionamiento por sucursal.
- Registrar entrada por patente y asignar cupo.
- Calcular automaticamente el monto de salida segun tarifa, gracia y redondeo legal.
- Cobrar ticket y registrar movimiento de caja.
- Cerrar turno con arqueo estructurado.
- Ver reportes por sucursal y consolidado.
- Gestionar abonados mensuales, clientes, contratos, documentos y pagos.
- Bloquear o limitar uso cuando la suscripcion del tenant no este activa.

## 2. Competencia Revisada

### 2.1 Gestion Parking

Fuente: https://gestionparking.cl/

Que destaca:

- App Android nativa + software web responsive.
- Operador ingresa patente, emite ticket de entrada y ticket de salida.
- Reportes online para administrador.
- Medios de pago variados.
- Pendientes de pago por patente.
- Estadisticas y graficos.
- Opcion de boleta electronica.

Precios encontrados:

- Plan Gratis: $0, 1 operador, hasta 50 ingresos/salidas al mes.
- Plan Uno: 1 UF + IVA/mes, publicado como $40.307 + IVA, 1 operador, hasta 5.000 ingresos.
- Plan Dos: 2 UF + IVA/mes, $80.614 + IVA, 2 operadores, hasta 10.000 ingresos.
- Plan Tres: 3 UF + IVA/mes, $120.921 + IVA, 3 operadores, hasta 15.000 ingresos.
- Plan Cuatro: 4 UF + IVA/mes, $161.228 + IVA, 4 operadores, hasta 20.000 ingresos.
- Plan Cinco: 5 UF + IVA/mes, $201.535 + IVA, 5 operadores, hasta 25.000 ingresos, incluye boletas electronicas.
- Plan Seis: 6 UF + IVA/mes, $241.842 + IVA, 6 operadores, hasta 30.000 ingresos, incluye boletas electronicas.
- Plan 10: 8 UF + IVA/mes, $322.456 + IVA, 10 operadores, hasta 50.000 ingresos.
- Boleta electronica como add-on de 0,5 UF + IVA mensual para planes inferiores.

Lectura para Parkia:

- Es el rival SaaS mas directo por pricing transparente y entrada barata.
- Compite por facilidad y telefono/POS Android.
- Parkia debe superar con multi-sucursal real, caja por turno mejor estructurada, permisos por sucursal y reportes consolidados.

### 2.2 ParkFacil

Fuente: https://www.parkfacil.cl/

Que destaca:

- POS Android + modulo web + app operador.
- Se posiciona como multiempresa y administracion de multiples estacionamientos.
- Integra ERP, LPR, barreras, totem entrada/salida, pagos con tarjeta, lector de carnet y autoatencion como adicionales.
- Soporte 24/7.
- Enfatiza operacion simple con pocos botones.
- Ticket con QR para calcular tiempo usado y monto a cancelar.

Precios encontrados:

- Plan Basico: 1,50 UF + IVA mensual, 2 operadores, hasta 100 plazas.
- Plan Medio: 2,50 UF + IVA mensual, 4 operadores, hasta 300 plazas.
- Plan Alto: 5,00 UF + IVA mensual, 8 operadores, hasta 1000 plazas.
- Administrador adicional: 1,00 UF + IVA mensual.
- Operador adicional: 0,70 UF + IVA mensual.
- Contrato minimo informado: 12 meses.
- POS no incluido.

Lectura para Parkia:

- Buen referente para empaquetar por plazas y operadores.
- Tiene discurso de hardware y escalabilidad.
- Parkia debe evitar depender de hardware propietario al inicio, pero dejar integraciones listas para LPR, barrera y POS.

### 2.3 EstacionaPlus

Fuente: https://estacionaplus.cl/

Que destaca:

- App Android + panel web.
- Control por plaza y ocupacion en tiempo real.
- Roles y permisos.
- Tarifas automaticas por minuto, tramo o tarifa fija.
- Reportes diarios/mensuales.
- Modo sin conexion.
- Exportacion PDF/Excel.
- Plan empresarial con multiples sedes.

Precios encontrados:

- Basico: $24.900/mes, hasta 20 plazas, 2 usuarios operativos, reportes basicos, modo offline.
- Pro: $49.900/mes, hasta 100 plazas, usuarios ilimitados, reportes avanzados, PDF/Excel.
- Empresarial: desde $89.900/mes, plazas ilimitadas, multiples sedes, facturacion, reportes personalizados, soporte 24/7 y marca personalizada.
- 15 dias de prueba gratis en los planes publicados.

Lectura para Parkia:

- Precio agresivo en el tramo pequeno.
- El modo offline es una ventaja relevante para playas con mala conectividad.
- Parkia puede diferenciarse con finanzas, caja, auditoria y multi-sucursal mas robustos, no solo control operativo.

### 2.4 Referencia Enterprise: Parking Chile / Parking Manager

Fuente: https://parkingchile.cl/sistemas-estacionamientos.html

No se encontro precio publico. Sirve como benchmark de soluciones con equipamiento: barreras, totems, lector de tickets, camaras LPR, POS, cobradores automaticos, versiones Lite/Estandar/PRO/FULL y tarifas configurables segun Ley 20.967.

Lectura para Parkia:

- No competir primero por hardware pesado.
- Disenar integraciones desde el dominio: dispositivos, direccion entrada/salida, eventos, comandos manuales y auditoria.

## 3. Posicionamiento Recomendado

Parkia no debe venderse como "otro software de tickets". Debe venderse como sistema operativo multi-sucursal para estacionamientos pequenos y medianos que necesitan control, caja y reportes sin comprar hardware caro desde el dia uno.

Propuesta comercial inicial:

- Starter: 1 sucursal, hasta 40 plazas, 2 operadores.
- Pro: hasta 3 sucursales, 150 plazas totales, usuarios operativos ilimitados.
- Business: sucursales ilimitadas, reportes avanzados, API, marca blanca y soporte prioritario.
- Add-ons: boleta/facturacion, LPR, barrera/totem, POS, WhatsApp, backups extendidos.

Regla de precio sugerida:

- Precio base por tenant + precio por sucursal.
- Limite por plazas para que el costo escale con el valor operacional.
- Cobrar integraciones y soporte premium aparte.

## 4. Estado Tecnico De La Base Luchin

Lo reutilizable:

- Auth, usuarios y roles base.
- Clientes, vehiculos, contratos y documentos.
- Espacios/cupos, accesos, visitas, tickets y totems.
- Pagos, conciliacion, gastos, reportes y cierres financieros.
- Bitacora de turno, tareas operativas y auditoria.
- Deploy, health checks, backups y tests API.

Brechas criticas:

- No existe `tenant_id` ni `branch_id`; todo opera como single-tenant/single-sucursal.
- `spaces.type` mezcla `parking` y `storage`.
- El cobro de visita permite monto manual; la UI tiene un monto fijo de referencia.
- No existe caja estructurada por turno.
- `access_logs.visitor_id` se usa ambiguamente entre ticket y pase.
- `totems` no tiene direccion entrada/salida ni sucursal.
- `system_config` es singleton.
- Storage y backups no estan aislados por tenant.

Primeros cambios ya iniciados:

- Branding base Parkia en metadata, README, login, sidebar y deploy.
- Variables nuevas `PARKIA_*` con compatibilidad transitoria `TIOLUCHIN_*`.
- Default de DB `parkia.db`.
- Cookie nueva `parkia_session`, lectura legacy de `tl_session`.
- Seeds demo sin bodegas.
- Deploy base renombrado a `parkia`.

## 5. Protocolo Multiagente

Todo sprint se ejecuta con especialistas y supervisor.

Regla obligatoria:

- Un agente puede entregar trabajo como "entregado".
- El supervisor revisa diff, ejecuta smoke/QA, valida criterios y decide "aprobado" u "observado".
- Nada se considera recibido ni integrado hasta aprobacion explicita del supervisor.
- Si falla QA, vuelve al agente responsable con observaciones concretas.
- Al cierre de cada sprint se consolida changelog, riesgos, pruebas ejecutadas y pendientes.

Roles:

- Supervisor tecnico: coordina, revisa arquitectura, aprueba entregas y consolida.
- Backend/API: rutas, servicios, validaciones y seguridad de datos.
- Base de datos/migraciones: schema, backfill, indices, constraints y pruebas de integridad.
- Frontend/UX operacional: pantallas de operador, caja, dashboard y flujos mobile.
- QA automatizado: tests API, smoke, regresion y datos de prueba.
- QA manual/operacional: recorridos por rol administrador, finanzas y guardia.
- DevOps/seguridad: env, deploy, backups, health, hardening y observabilidad.
- Producto/comercial: pricing, planes, copy operativo, criterios de MVP y documentacion.

## 6. Roadmap Por Sprints

### Sprint 0 - Fundacion Parkia

Objetivo: separar identidad Parkia de Luchin y dejar una base ejecutable.

Agentes:

- Backend/API
- Frontend/UX
- DevOps
- QA automatizado

Tareas:

- Terminar rebrand visible: login, sidebar, metadata, README, env, deploy, seeds, health checks.
- Mantener compatibilidad transitoria con variables antiguas.
- Quitar referencias visibles a bodegas en UX principal.
- Crear documento maestro de planificacion.
- Ajustar tests base para Parkia.
- Smoke: login admin, dashboard, espacios, accesos, finanzas, health.

Criterios de aprobacion:

- `npm run lint`, `npm run build` y tests criticos pasan.
- La app inicia sin `TIOLUCHIN_*`.
- No aparece Tio Luchin en UI primaria.
- Documento maestro existe y referencia fuentes de competencia.

### Sprint 1 - Ticket Parking Real

Objetivo: que el flujo entrada-salida-cobro sea funcional sin montos manuales arbitrarios.

Agentes:

- Backend/API
- Base de datos
- Frontend/UX operacional
- QA automatizado

Tareas:

- Crear servicio `calculateParkingFee(ticketId, exitAt)`.
- Agregar endpoint `GET /api/visitors/:id/quote`.
- Soportar tarifa por minuto efectivo, tramo vencido, gracia, monto minimo y convenio simple.
- Reemplazar monto fijo del drawer de cobro por cotizacion calculada.
- `POST /api/visitors/:id/pay` debe rechazar monto menor al calculado salvo override admin con motivo.
- Registrar evento de auditoria de cotizacion y pago.
- Tests: ticket gratis dentro de gracia, ticket pagado fuera de gracia, monto menor rechazado, override auditado.

Criterios de aprobacion:

- Un guardia puede registrar entrada, consultar monto, cobrar y finalizar salida.
- La salida impaga queda bloqueada.
- No existe monto hardcodeado en UI.

### Sprint 2 - Caja Y Turnos

Objetivo: transformar la bitacora de turno en caja operativa controlable.

Agentes:

- Backend/API
- Base de datos
- Frontend/UX operacional
- QA manual/operacional

Tareas:

- Crear `cash_sessions` vinculada a `guard_shift_logs`.
- Campos: fondo inicial, responsable, apertura, cierre, efectivo esperado, efectivo contado, tarjeta, transferencia, diferencias y notas.
- Registrar pagos de tickets como movimientos de caja.
- Cierre de turno debe exigir arqueo estructurado.
- Reporte de caja por turno y por dia.
- Tests: apertura, pago, cierre con diferencia, cierre sin caja bloqueado.

Criterios de aprobacion:

- El guardia puede abrir turno/caja, cobrar tickets y cerrar caja con arqueo.
- Finanzas ve resumen diario.

### Sprint 3 - Sucursales

Objetivo: que Parkia opere multiples sucursales dentro de un tenant.

Agentes:

- Base de datos
- Backend/API
- Frontend/UX
- QA automatizado
- QA seguridad

Tareas:

- Crear `branches`.
- Agregar `branch_id` a espacios, tickets, accesos, totems, contratos, pagos, gastos, turnos y tareas.
- Backfill a sucursal default.
- Selector de sucursal en UI.
- Filtros obligatorios de backend por sucursal activa.
- Reportes por sucursal y consolidado.
- Tests de aislamiento: sucursal A no ve ni opera datos de sucursal B salvo admin consolidado.

Criterios de aprobacion:

- Dos sucursales pueden operar en paralelo sin fuga de datos.
- Dashboard permite ver sucursal actual y consolidado.

### Sprint 4 - SaaS Multi-Tenant Y Suscripcion

Objetivo: vender Parkia por suscripcion sin mezclar clientes.

Agentes:

- Base de datos
- Backend/API
- Seguridad
- Producto/comercial
- QA automatizado

Tareas:

- Crear `tenants`, `tenant_memberships`, `plans`, `subscriptions`.
- Agregar `tenant_id` a tablas criticas.
- Resolver contexto tenant desde sesion.
- Bloquear funciones por suscripcion vencida.
- Limites por plan: sucursales, plazas, usuarios, tickets/mes.
- Panel admin tenant: plan, estado, consumo.
- Tests de aislamiento tenant.

Criterios de aprobacion:

- Dos empresas usan la misma instancia sin cruzar datos.
- Un tenant suspendido no puede operar tickets nuevos.

### Sprint 5 - Eliminacion Final De Bodegas

Objetivo: dejar dominio Parkia sin bodega como concepto operativo.

Agentes:

- Base de datos
- Frontend/UX
- Backend/API
- QA regresion

Tareas:

- Migrar `spaces.type` hacia dominio solo parking o introducir `parking_spaces`.
- Archivar datos `storage` legacy si existen.
- Quitar labels, plantillas, reportes, PDF y tests de bodega.
- Actualizar contratos y dashboard para estacionamientos.

Criterios de aprobacion:

- La UI no permite crear ni editar bodegas.
- Tests no dependen de `storage`.

### Sprint 6 - Reportes, Exportables Y Operacion Comercial

Objetivo: que el producto sea vendible y auditable.

Agentes:

- Backend/API
- Frontend/UX
- Producto/comercial
- QA manual

Tareas:

- Reporte ventas por turno, dia, sucursal y metodo de pago.
- Reporte ocupacion y rotacion.
- Reporte abonados y morosidad.
- Exportar PDF/Excel.
- Plantillas CSV de carga inicial para plazas, clientes, abonados y tarifas.
- Ajustar textos de onboarding operativo.

Criterios de aprobacion:

- Un cliente piloto puede cargar datos y revisar ingresos del dia sin ayuda tecnica.

### Sprint 7 - Integraciones Y Produccion

Objetivo: preparar piloto real.

Agentes:

- DevOps/seguridad
- Backend/API
- QA automatizado
- QA manual/operacional

Tareas:

- Health/readiness Parkia final.
- Backup y restore probado.
- Hardening de cookies, CORS, headers, rate limits y logs.
- Preparar API de dispositivos: LPR, barrera, POS.
- Smoke completo en build production.
- Checklist de entrega y manual operativo.

Criterios de aprobacion:

- App en ambiente productivo responde.
- Restore de backup probado.
- Smoke por rol aprobado.

## 7. Matriz QA Y Smoke

Smoke minimo por build:

- Login admin, finanzas y guardia.
- Crear sucursal.
- Crear cupo.
- Entrada visitante.
- Cotizar salida.
- Cobrar ticket.
- Completar salida.
- Abrir/cerrar caja.
- Ver dashboard.
- Exportar reporte.
- Crear respaldo.
- Health details como admin.

QA por rol:

- Admin: configura empresa, sucursales, usuarios, tarifas y reportes.
- Guardia: opera entrada/salida, caja, bitacora y contingencias.
- Finanzas: revisa pagos, caja, gastos, conciliacion y reportes.
- Tenant owner: ve plan, consumo y estado de suscripcion.

QA de seguridad:

- Sin sesion no hay APIs protegidas.
- Usuario de una sucursal no accede a otra si no tiene permiso.
- Tenant A no ve datos de Tenant B.
- Backups no descargan rutas arbitrarias.
- Storage no permite path traversal.

## 8. Backlog Inmediato Priorizado

P0:

- Completar Sprint 0.
- Corregir tests y smoke post-rebrand.
- Implementar cotizacion automatica de ticket.
- Eliminar monto hardcodeado en cobro de visita.

P1:

- Caja estructurada por turno.
- Branch model y selector de sucursal.
- Filtro backend obligatorio por sucursal.

P2:

- Multi-tenant con planes y suscripciones.
- Integraciones POS/LPR/barrera.
- Offline mobile.

## 9. Decision Tecnica Actual

No conviene reescribir desde cero. La base Luchin ya contiene modulos valiosos de estacionamiento, finanzas, documentos, acceso y auditoria. La ruta correcta es una transformacion controlada:

1. Rebrand y limpieza de dominio.
2. Ticket/caja funcional.
3. Sucursales.
4. Multi-tenant.
5. Suscripcion.
6. Produccion piloto.

La mayor regla de seguridad tecnica: no agregar multi-sucursal solo en frontend. Todo aislamiento debe vivir en base de datos, sesion, middleware y queries.
