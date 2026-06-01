# Revision de roles no administradores

Fecha: 2026-05-15

Esta revision simula el dia a dia de Finanzas, Guardia y los traspasos entre roles. El objetivo no es revisar pantallas aisladas, sino confirmar si cada usuario puede terminar su trabajo diario con trazabilidad, permisos correctos y acciones claras.

## Estado general

El producto esta avanzado. Los modulos base ya no se sienten como maqueta: hay roles reales, permisos separados, tareas globales, bitacora de turno, finanzas completas, documentos, contratos, gastos, cobranza, reportes y auditoria administrativa.

Lo que falta ya no es construir todo desde cero. El foco ahora debe ser cerrar detalles de operacion real:

- Evitar acciones visibles que el backend rechaza.
- Filtrar informacion sensible segun rol.
- Hacer que cada pendiente tenga dueno, origen y siguiente accion.
- Convertir flujos criticos en acciones auditables.
- Pulir pantallas por jornada real, no solo por modulo.

## Roles activos revisados

- `admin`: administra operacion, auditoria, usuarios, configuracion, finanzas, seguridad y seguimiento global.
- `finance`: opera clientes, contratos, documentos, finanzas, cobranza, gastos y tareas financieras.
- `guard`: opera seguridad, accesos, visitantes, espacios, bitacora y tareas operativas.

## Finanzas

### Mision diaria

Entra en la manana, revisa dashboard y alertas, mira morosos, gastos vencidos, documentos pendientes y conciliacion. Luego entra a cuentas por cobrar, registra pagos o ajustes, gestiona cobranza, carga cartola CGVC, registra gastos y prepara cierre/reporte del dia.

### Lo que funciona bien

- Login de finanzas existe y el rol queda bloqueado de seguridad, personal y auditoria global.
- Cuentas por cobrar tiene ficha, pagos, ajustes, abonos, comprobantes e historial.
- Cobranza tiene cola, canales, proxima accion y cierre de gestiones.
- Gastos tiene proveedor, centro de costo, respaldo, estado de pago y aprobacion.
- CGVC permite importar, sugerir matches, conciliar manualmente, dejar notas y revisar pendientes.
- Reportes tienen formulas visibles, fecha de corte y exportaciones.
- Tareas ya filtran categorias permitidas para finanzas.

### Brechas

- P1: Finanzas ve botones de admin que despues fallan por backend: aprobar gasto, cerrar mes, reabrir mes y reversar abono.
- P1: Finanzas puede registrar un gasto pendiente, pero no tiene accion clara para pedir aprobacion al admin.
- P1: Finanzas tiene mucho poder contractual si puede crear, suspender, reactivar y terminar contratos sin politica de aprobacion.
- P2: El dashboard de finanzas muestra operacion fisica, pero no ofrece accion util como avisar a guardia o revisar cliente moroso presente.
- P2: Las notificaciones mandan a `/tasks` generico cuando ya existe tarea.
- P2: Cobranza registra canal, pero no facilita WhatsApp, copiar telefono, copiar email o usar plantilla.
- P2: Falta una bitacora financiera consolidada para que finanzas vea trazabilidad sin entrar a auditoria admin completa.
- P2: La data demo tiene encoding roto en algunos textos y baja confianza en una presentacion.

## Guardia

### Mision diaria

Inicia turno, revisa alertas, abre bitacora, controla accesos, genera pases, revisa visitas, opera aperturas manuales, registra incidentes con evidencia, deja pendientes y cierra turno con traspaso.

### Lo que funciona bien

- Guardia puede entrar y usar seguridad, espacios, visitantes y tareas operativas.
- Guardia queda bloqueado correctamente de finanzas y clientes por API.
- Las tareas financieras quedan ocultas para guardia.
- La bitacora ya crea seguimientos y tareas globales.
- Los pendientes de turno aparecen como alertas y pueden heredarse.
- Hay tests relevantes de permisos, bitacora, adjuntos, CSV y restricciones.

### Brechas

- P1: Guardia puede editar tarifas de acceso. En producto real deberia verlas, no cambiarlas.
- P1: Apertura manual registra autorizador hardcodeado como `Guardia Turno 1`, no el usuario real.
- P1: "Abrir Barrera Principal" y "Abrir Puerta Peatonal" abren el mismo flujo generico.
- P1: Incidentes de bitacora necesitan campos estructurados: hora del incidente, persona involucrada, RUT o patente, a quien se aviso, resolucion, responsable siguiente y gravedad operacional.
- P1: Cobro de visitas usa monto manual/default; deberia calcular tarifa y exigir motivo si se ajusta.
- P2: Dashboard de guardia todavia muestra bloque de contratos vacio; deberia mostrar turno, visitas activas o accesos denegados.
- P2: "Generar y Enviar Pase QR" promete envio real, pero hoy solo genera token.
- P2: Cierre de turno permite pendientes sin checklist fuerte de traspaso.
- P2: Tareas de guardia necesita ultimo pulido responsive para tablet/porterias.

## Traspasos entre roles

### Lo que esta bien

- Guardia puede crear novedad con seguimiento y eso crea tarea global.
- Si se resuelve la novedad desde bitacora, se cierra la tarea relacionada.
- Si se cierra la tarea, se resuelve la novedad relacionada.
- Documentos pendientes, observados o vencidos crean tareas globales.
- Al aprobar documentos, se cierra la tarea asociada.
- Alertas de mora, gastos vencidos, conciliacion y cobranza alimentan dashboard.

### Brechas

- P0: Alertas del dashboard no estan suficientemente filtradas por rol. Guardia podria ver informacion financiera sensible si consume el mismo endpoint de alertas.
- P1: Crear tarea desde alerta no asigna responsable por defecto.
- P1: Una novedad de guardia de tipo `payment` cae como tarea general; finanzas no puede abrir seguridad para ver el origen completo.
- P1: Cobranza tiene seguimiento propio, pero no esta amarrada 1:1 a tareas globales por accion.
- P2: Algunas tareas financieras no tienen `sourceHref` util, por ejemplo cierre/reapertura mensual.
- P2: `/documents?documentId=...` no enfoca ni resalta el documento enlazado.

## Sprint recomendado: Roles reales y traspasos

### Objetivo

Dejar Finanzas y Guardia listos para uso diario real, corrigiendo permisos visibles, trazabilidad entre roles y acciones criticas.

### Alcance propuesto

1. Seguridad de rol y alertas
   - Filtrar alertas por rol en backend.
   - Bloquear creacion de tareas desde alertas que no correspondan al rol.
   - Ocultar en UI cualquier dato financiero a guardia.

2. Finanzas operativo
   - Ocultar acciones admin o convertirlas en "Solicitar aprobacion".
   - Crear solicitud de aprobacion para gasto, cierre mensual, reapertura y reversa.
   - Agregar acciones rapidas en cobranza: WhatsApp, copiar telefono, copiar email y plantilla.
   - Agregar bitacora financiera filtrada para eventos financieros.

3. Guardia operativo
   - Quitar edicion de tarifas al guardia.
   - Usar usuario real en aperturas manuales.
   - Diferenciar accion de barrera vehicular y puerta peatonal.
   - Estructurar incidente de bitacora con campos operacionales.
   - Agregar checklist obligatorio de cierre de turno.

4. Tareas y handoffs
   - Asignar responsable automatico por categoria o regla.
   - Mapear `payment` de guardia a tarea financiera con resumen visible.
   - Crear tarea 1:1 para acciones de cobranza que requieran seguimiento.
   - Agregar `sourceHref` para cierres/reaperturas financieras.
   - Hacer que documentos enlazados se enfoquen desde `documentId`.

5. QA por rol
   - Probar login y navegacion como `finance`.
   - Probar login y navegacion como `guard`.
   - Probar API 403/200 por rol en rutas sensibles.
   - Probar un dia completo de Finanzas.
   - Probar un turno completo de Guardia.
   - Probar un handoff Guardia -> Finanzas -> Admin.

## Criterio de terminado

- Cada boton visible para cada rol ejecuta una accion permitida o explica claramente que requiere aprobacion.
- Guardia no ve ni modifica informacion financiera sensible.
- Finanzas no ve acciones admin ejecutables si no puede completarlas.
- Cada pendiente critico tiene responsable, origen, vencimiento y siguiente paso.
- El admin puede auditar quien hizo que, cuando y desde que flujo.
- El sistema pasa lint, build, tests y checklist manual por rol.
