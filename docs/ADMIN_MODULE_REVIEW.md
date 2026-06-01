# Revision funcional por modulo - Administrador

Revision hecha desde la perspectiva del administrador, combinando UI, endpoints y datos locales en `http://localhost:8080`.

## Estado general

El administrador ya tiene una base operativa amplia: clientes, contratos, documentos, tareas, espacios, finanzas, seguridad, auditoria, personal y configuracion. El sistema permite ejecutar procesos reales, pero aun hay brechas de informacion que pueden dejar decisiones sin contexto o dificultar auditoria posterior.

Datos locales observados:

- Clientes: 2.
- Contratos: 3.
- Espacios: 11.
- Finanzas: $50.000 pendiente, $85.000 vencido, $50.000 cobrado.
- Alertas dashboard: mora, cartola por conciliar y seguimiento de guardia.
- Documentos en seguimiento: 0.
- Tareas activas: 0.
- Readiness produccion: no listo por ambiente local, direccion de empresa faltante y clave admin inicial.

## 1. Dashboard

Funciones actuales:

- Ocupacion, ingresos, accesos del dia, contratos por vencer, pagos recientes, accesos en vivo y alertas priorizadas.
- Las alertas permiten crear tareas o navegar al modulo correspondiente.

Lo bueno:

- Sirve como tablero ejecutivo.
- Las alertas ya tienen severidad, monto, accion y posibilidad de generar tarea.
- El trend de ingresos ya no queda como mock visual aislado.

Falta informacion:

- Selector de periodo: hoy, semana, mes, rango personalizado.
- Explicacion visible de como se calcula meta de ingresos y trend.
- Diferenciar ingresos cobrados, devengados, vencidos y proyectados.
- Acceso directo desde cada KPI a la vista filtrada que lo origina.
- Estado de readiness productivo resumido para admin cuando haya bloqueos criticos.

Prioridad: alta.

## 2. Clientes

Funciones actuales:

- Crear cliente natural o empresa.
- Buscar y filtrar por tipo/estado financiero.
- Carga masiva CSV y descarga de plantilla.
- Ficha con resumen, contratos, pagos, documentos y accesos.
- Subida de documentos por cliente.

Lo bueno:

- La ficha centraliza informacion operativa.
- La carga masiva ya informa importados y omitidos.
- Documentos del cliente tienen tipo, estado, vencimiento, nota y archivo.

Falta informacion:

- Direccion, comuna/ciudad, giro, contacto de facturacion y representante legal para empresas.
- Notas comerciales/operativas del cliente.
- Multiples vehiculos/patentes por cliente, no solo una patente.
- Estado documental del cliente en la tabla principal.
- Deuda real en ficha: hoy el resumen muestra `Deuda Total $0`, aunque existen pagos pendientes/vencidos.
- Productos duplicados: el cliente local muestra `Estacionamiento A1, Estacionamiento A1`; debe separar activos/historicos o deduplicar.
- Acciones de editar, desactivar/archivar cliente y ver historial de cambios.
- Validacion visual del RUT al crear/importar con feedback antes de guardar.

Prioridad: alta.

## 3. Contratos

Funciones actuales:

- Crear contrato con cliente, espacio, inicio, termino, tarifa, dia de cobro, garantia, tipo de documento y notas.
- Descargar PDF, generar documento PDF, adjuntar contrato firmado.
- Suspender, reactivar y terminar contrato con nota obligatoria.

Lo bueno:

- El ciclo de vida basico existe.
- Las acciones sensibles piden motivo y quedan auditables.
- La relacion con documento firmado ya esta considerada.

Falta informacion:

- Ficha detallada de contrato con pagos, documentos, cambios de estado y accesos asociados.
- Fecha efectiva y motivo estructurado para suspension/reactivacion/termino.
- Responsable interno del contrato.
- Reglas de reajuste: UF/IPC/fijo, periodicidad y proxima fecha.
- Condiciones de garantia: monto, estado, devolucion, descuentos y comprobante.
- Datos de facturacion por contrato: receptor, giro, direccion tributaria, orden de compra si aplica.
- Historial de versiones o anexos.
- Renovacion con comparacion de tarifa anterior/nueva.

Prioridad: alta.

## 4. Documentos

Funciones actuales:

- Seguimiento global de documentos pendientes, observados, vencidos y por vencer.
- Filtros por estado/tipo, busqueda, descarga y cambio de estado.
- En ficha cliente se pueden subir documentos con vencimiento y nota.

Lo bueno:

- Ya existe bandeja documental transversal.
- Se muestran vencimientos proximos.
- El estado se puede actualizar desde la lista.

Falta informacion:

- Motivo obligatorio al rechazar/observar.
- Responsable asignado y proxima accion.
- Relacion visual clara con cliente, contrato o pago.
- Historial de cambios de estado por documento.
- Versionado o reemplazo de archivo.
- Checklist documental por tipo de cliente/contrato.
- Alertas/tareas automaticas cuando vence o queda rechazado.

Prioridad: media-alta.

## 5. Tareas

Funciones actuales:

- Crear tarea con titulo, detalle, categoria, prioridad, responsable y vencimiento.
- Filtros por estado, categoria, asignacion, prioridad y origen.
- Editar, avanzar, completar, cancelar e inspeccionar historial.
- Tareas pueden venir desde dashboard y bitacora de guardia.

Lo bueno:

- Es un buen tablero global de pendientes.
- Ya hay historial y origen de tarea.
- Categorias filtradas por rol.

Falta informacion:

- Comentarios o seguimiento intermedio, no solo nota de cierre.
- Adjuntos/evidencias en tarea.
- Subtareas o checklist para procesos largos.
- Fecha/hora de vencimiento, no solo fecha.
- SLA o antiguedad visible.
- Reasignacion con motivo.
- Vinculo clickeable al origen exacto cuando viene de alerta, cliente, contrato, documento, pago o turno.

Prioridad: media-alta.

## 6. Espacios

Funciones actuales:

- Vista por estacionamientos, bodegas y visitas.
- Crear espacio con identificador, precio, estado y notas.
- Ver ocupacion, cliente asignado, estado financiero, presencia y controles.
- Cambiar estado, apertura manual, liberar espacio y bloquear acceso.
- Cobro/cierre de tickets de visita.

Lo bueno:

- La vista tipo inventario funciona bien para admin, finanzas y guardia con permisos distintos.
- Ya muestra presencia y ultimo acceso.
- Acciones riesgosas usan confirmacion.

Falta informacion:

- Metraje/dimensiones, ubicacion interna, nivel/sector y caracteristicas.
- Estado fisico/observaciones separadas de estado comercial.
- Historial de ocupacion y mantenciones por espacio.
- Motivo obligatorio al liberar manualmente o cambiar a disponible desde ocupado.
- Evidencia/foto o documento asociado al espacio.
- Tarifa historica y fecha de ultimo reajuste.
- Capacidad para bodegas y restricciones de uso.

Prioridad: media.

## 7. Finanzas

Funciones actuales:

- Cuentas por cobrar, cobranza, gastos, sincronizacion CGVC, facturacion SII y reportes.
- Registro de pagos, conciliacion manual/parcial, reversa de abonos.
- Gestiones de cobranza con canal, nota y proxima accion.
- Gastos con proveedor, RUT, descripcion, neto, IVA, total, documento, vencimiento, pago, respaldo y notas.
- Presupuestos, reportes, cierre/reapertura mensual y exportaciones CSV.

Lo bueno:

- Es el modulo mas completo.
- Tiene trazabilidad para conciliacion, abonos parciales y reversas.
- Gastos ya estan bien encaminados para rentabilidad.
- Facturacion SII mock/local esta lista para demo/piloto mientras se define proveedor real.

Falta informacion:

- Ficha completa de cuenta por cobrar con contrato, cliente, historial de cobranza, abonos, documentos y factura.
- Estado de comprobante/recibo requerido por metodo de pago.
- Forma de registrar descuentos, condonaciones, multas y ajustes con motivo.
- Responsable de cobranza y etapa de cobranza.
- Clasificacion contable de gastos mas fina: centro de costo, recurrente/no recurrente, periodo de devengo.
- Flujo de aprobacion de gastos antes de pago.
- Export CSV con filtros aplicados en todos los casos, no solo estado basico.
- Reportes con explicacion de formula y fecha de corte.
- Facturacion SII debe mostrar claramente que el mock/local no emite, envia ni recibe aceptacion real del SII.

Prioridad: alta, salvo emision SII real que queda final por decision de proveedor.

## 8. Seguridad y Accesos

Funciones actuales:

- Monitor en vivo, gestion de visitas, bitacora de turno, auditoria historica y tarifas.
- Crear pase de visita con RUT, motivo y ventana de vigencia.
- Apertura manual de emergencia con motivo.
- Bitacora de turno con apertura, novedades, seguimiento, cierre y traspaso.
- Exportacion de auditoria/seguimientos.

Lo bueno:

- La bitacora de turno ya cubre continuidad operacional.
- Las aperturas manuales quedan advertidas y registradas.
- Los seguimientos de turno llegan a tareas.

Falta informacion:

- En pase de visita falta patente, empresa/proveedor, telefono y persona/cliente que autoriza.
- Asociar visita a espacio/cliente desde formulario de pase.
- Foto/documento de identidad opcional para visita.
- Motivo obligatorio al resolver seguimiento de bitacora.
- Bitacora deberia permitir adjuntos/evidencias.
- Filtros de auditoria deberian incluir hasta/fin de rango, espacio y metodo.
- Tarifas de visitas deberian incluir moneda, vigencia y reglas por tramo.

Prioridad: media-alta.

## 9. Auditoria

Funciones actuales:

- Lista eventos, resumen por accion/entidad/usuario, filtros por busqueda, accion, entidad, fecha y limite.
- Exportacion CSV.
- Modal con metadata completa.

Lo bueno:

- Es una buena base para trazabilidad admin.
- Metadata cruda ayuda a soporte.
- Exportacion existe.

Falta informacion:

- Filtro por usuario especifico y por ID de entidad.
- Comparacion antes/despues normalizada para eventos de update.
- Etiquetas humanas para mas acciones nuevas del sistema.
- Retencion/politica de auditoria visible.
- Boton para ir desde evento a la entidad afectada.
- Severidad o criticidad de evento.

Prioridad: media.

## 10. Personal

Funciones actuales:

- Crear usuarios admin, finanzas y guardia.
- Ver RUT, correo, rol, estado y ultimo acceso.
- Restablecer clave.
- Activar/desactivar con motivo y cierre de sesiones.

Lo bueno:

- Cubre RBAC basico.
- Desactivacion pide motivo.
- Reset de clave existe.

Falta informacion:

- Editar datos del usuario y cambiar rol con motivo.
- Forzar cambio de clave al primer ingreso/reset.
- Historial de accesos y sesiones activas.
- Telefono obligatorio o canal de contacto operativo.
- Politica de complejidad visible.
- Evitar que el ultimo admin activo se desactive.
- Perfil de permisos mas granular para futuro.

Prioridad: alta por seguridad.

## 11. Configuracion

Funciones actuales:

- Reglas de cobranza, datos empresa, credenciales SII/CGVC.
- Estado de totems, modo mantencion, healthcheck, plantillas de carga y respaldos.

Lo bueno:

- La seccion Operacion ya sirve como checklist de salida.
- Respaldos manuales y descarga estan disponibles.
- Plantillas de carga inicial estan centralizadas.

Falta informacion:

- Direccion empresa sigue vacia en datos locales, bloquea readiness legal.
- Datos legales incompletos: giro, comuna, ciudad, correo tributario, telefono empresa.
- Configuracion productiva no editable desde UI: APP_URL, rutas, storage, backup path; hoy solo se ven por health.
- Rotacion/fecha de ultima actualizacion de credenciales API.
- Prueba de conexion para SII real/CGVC cuando existan proveedores.
- Politica de respaldos: frecuencia, retencion, ultimo respaldo exitoso y alerta si no hay respaldo reciente.
- Cambio de clave propia del admin desde UI visible.

Prioridad: alta.

## Backlog recomendado

### Sprint A - Datos maestros y fichas criticas

- Completar ficha cliente: direccion, giro, representante, contacto facturacion, notas y multiples vehiculos.
- Calcular deuda real en ficha cliente.
- Deduplicar productos o separar contratos activos/historicos.
- Crear ficha contrato detallada.
- Agregar editar/desactivar cliente con auditoria.

Estado: implementado como base funcional en `019_client_master_data`. Quedan mejoras futuras sobre versionado avanzado de contrato y reglas de reajuste.

### Sprint B - Seguridad administrativa

- Forzar cambio de clave inicial/reset.
- Cambio de clave propia desde perfil.
- Bloquear desactivacion del ultimo admin activo.
- Permitir editar usuario/cambiar rol con motivo.
- Agregar historial de sesiones/accesos por usuario.

### Sprint C - Documentos y tareas con seguimiento real

- Motivo obligatorio al rechazar documentos.
- Responsable/proxima accion documental.
- Comentarios y adjuntos en tareas.
- Vinculo clickeable al origen de tarea.
- Alertas automaticas por documentos vencidos/rechazados.

### Sprint D - Operacion fisica

- Ampliar ficha espacio con ubicacion, dimensiones, caracteristicas e historial.
- Exigir motivo al liberar manualmente.
- Ampliar pase de visita con patente, telefono, empresa y autorizador.
- Adjuntos/evidencia en bitacora de turno.

### Sprint E - Finanzas para control real

- Ficha de cuenta por cobrar.
- Ajustes financieros con motivo: descuentos, condonaciones, multas.
- Centro de costo y aprobacion de gastos.
- Reportes con formula visible y fecha de corte.
- SII mock/local listo para demo/piloto; emision real al final, cuando se defina proveedor.
