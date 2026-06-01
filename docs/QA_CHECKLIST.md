# Checklist QA Manual por Modulo

Usar este checklist antes de entregar una version al cliente o despues de cambios grandes. Ejecutar con usuarios reales de prueba para `admin`, `finance` y `guard`.

## Preparacion

- Confirmar que `npm run lint`, `npm run build` y `npm test` pasan.
- Confirmar que `/api/health` responde `status: ok`.
- Confirmar que no hay cambios sin respaldar en git.
- Probar en desktop, tablet y movil: 1366x768, 768x1024 y 390x844.
- Validar que no existan textos cortados, botones inaccesibles, tablas sin scroll o menus fuera de pantalla.

## Autenticacion y Roles

- Login correcto para admin, finance y guard.
- Login invalido muestra error claro.
- Logout invalida la sesion.
- Cambio de clave exige clave actual y confirmacion.
- Cada rol ve solo sus modulos permitidos.
- Cada rol recibe 403 si intenta acceder a APIs fuera de permiso.

## Dashboard

- Carga sin errores para cada rol.
- Las alertas corresponden al rol conectado.
- Crear tarea desde alerta no duplica si ya existe una tarea activa.
- El indicador de recaudacion compara contra el mes anterior real.
- En movil las tarjetas se apilan sin desbordar y las acciones de alerta quedan tocables.
- La campana de notificaciones abre/cierra sin salirse del viewport.

## Clientes

- Lista, busqueda y filtros cargan.
- Crear cliente exige nombre, RUT y datos minimos.
- Importar CSV reporta filas creadas y omitidas.
- Ficha de cliente muestra contratos, documentos, pagos y datos de contacto.
- Subida de documentos funciona y permite descargar.
- En movil los formularios y tablas mantienen scroll horizontal o apilado legible.

## Espacios

- Admin puede crear espacios con tipo, codigo, estado y tarifa.
- Finance puede revisar inventario sin acciones operativas indebidas.
- Guard no ve datos financieros sensibles.
- Marcar mantenimiento libera/bloquea segun corresponda.
- Ocupar/liberar espacio registra evento y no rompe contratos activos.
- En tablet las tarjetas permiten comparar estado, tipo y cliente.

## Contratos

- Crear contrato valida cliente, espacio disponible, fechas y tarifa.
- No permite contrato sobre espacio ocupado.
- Renovar actualiza vencimiento.
- Terminar contrato libera el espacio y exige motivo.
- Generar PDF descarga archivo util.
- Importar contrato masivo informa errores por fila.

## Finanzas

- Resumen carga sin error.
- Cuentas por cobrar muestran pendientes, pagadas y vencidas.
- Registrar pago actualiza estado y genera comprobante/factura interna.
- Cobranza permite crear acciones y seguimiento.
- Gastos permite crear, editar estado, subir respaldo y exportar CSV aunque no haya filas.
- Conciliacion bancaria importa CSV, evita duplicados y deja no matcheados editables con nota.
- Reportes exportan CSV con cabeceras aun sin datos.
- Cierre mensual bloquea cambios y permite reapertura controlada.
- Proyeccion considera ingresos, gastos, mora y tasa de recuperacion.

## Facturacion SII Mock/Local

- La pestana o flujo SII carga sin error con datos de prueba.
- El usuario ve claramente que el modo actual es mock/local para demo o piloto.
- Generar o simular un documento no lo marca como emitido, enviado o aceptado por SII real.
- Folios, estados, XML/PDF o respuestas visibles se identifican como simulados/locales cuando correspondan.
- No se solicitan ni exponen credenciales reales de proveedor SII en el flujo mock/local.
- El sistema permite registrar referencia interna o comprobante local sin prometer validez tributaria.
- Los mensajes de produccion indican que la emision real queda pendiente hasta definir proveedor e integrar API/certificacion.
- En mobile/tablet, las advertencias de mock/local se leen antes de ejecutar acciones de facturacion.
- Auditoria registra la accion como simulacion/local, no como envio tributario real.
- Si el cliente requiere factura real, el flujo documenta que debe emitirse por proceso externo vigente.

## Guardia y Accesos

- Monitor en vivo actualiza accesos.
- Pase de visita crea QR/token y permite copiar.
- Apertura manual exige motivo y queda auditada.
- Bitacora de turno permite abrir turno, registrar novedades y cerrar con traspaso.
- Seguimientos pendientes crean tarea global y aparecen en dashboard.
- Pendientes heredados se ven en el siguiente turno y pueden resolverse.
- Exportar bitacora y seguimientos descarga CSV con cabeceras.
- En movil la pestana Bitacora de Turno es accesible desde `/access?tab=shift-log`.

## Tareas

- Lista muestra solo categorias permitidas por rol.
- Crear tarea exige titulo y categoria permitida.
- Cambiar prioridad, estado, asignado y vencimiento funciona.
- Cerrar tarea critica o de alerta exige nota.
- Historial muestra cambios relevantes.
- Filtros por estado, categoria, prioridad y origen no se pisan entre si.

## Documentos

- Cola de revision muestra pendientes, rechazados y vencidos.
- Descargar documento funciona.
- Aprobar/rechazar exige datos suficientes.
- Filtros por entidad, estado y busqueda funcionan.
- Alertas de documentos aparecen solo a roles autorizados.

## Auditoria

- Admin puede filtrar por actor, accion, entidad y fecha.
- Exportacion CSV incluye cabeceras.
- Acciones sensibles aparecen: login, contratos, pagos, staff, backups, accesos manuales.
- Roles no admin no pueden acceder.

## Personal y Configuracion

- Crear usuario real con rol correcto.
- Reset de clave revoca sesiones anteriores.
- Desactivar usuario exige motivo y no permite autodesactivarse.
- Configuracion guarda datos legales.
- Operacion muestra healthcheck, readiness y respaldos.
- Crear y descargar backup funciona.

## Criterios de Salida

- Sin errores visibles en consola del navegador durante flujos principales.
- Sin estados "No se pudo cargar" en pantallas principales con datos validos.
- Exportaciones disponibles descargan archivo aunque la tabla este vacia.
- Las acciones destructivas o sensibles quedan auditadas.
- El checklist critico de `docs/OPERATIONS.md` no tiene bloqueos para produccion.
