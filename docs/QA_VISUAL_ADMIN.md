# QA visual administrador post-sprint

Fecha: 2026-05-15  
Alcance: usuario `admin` en desktop, tablet y mobile.  
Objetivo: validar que los 5 sprints de administrador quedaron operables, legibles y sin fricciones visuales graves antes de una demo o validacion con cliente.

## Preparacion

- Iniciar sesion como administrador.
- Confirmar que el sistema carga sin pantallas en blanco.
- Confirmar que el usuario puede navegar por todos los modulos del sidebar.
- Probar con datos reales o semilla suficientemente poblada: clientes, contratos, pagos, gastos, documentos, tareas, espacios y accesos.
- Mantener abierta la consola del navegador y registrar errores visibles.
- Si una accion descarga CSV/PDF, validar que el archivo se descarga aunque no existan filas.

## Viewports sugeridos

| Tipo | Viewport | Objetivo |
| --- | --- | --- |
| Desktop base | 1440x900 | Validar uso normal administrador. |
| Desktop bajo | 1366x768 | Detectar cards, tablas o modales demasiado altos. |
| Tablet vertical | 768x1024 | Validar sidebar responsive, tabs, tablas y formularios. |
| Tablet horizontal | 1024x768 | Validar densidad de datos y drawers. |
| Mobile grande | 430x932 | Validar navegacion inferior, header, cards y scroll horizontal. |
| Mobile chico | 390x844 | Detectar textos cortados y botones fuera de pantalla. |

## Criterios globales de aceptacion

- No hay textos rotos por encoding, `undefined`, `NaN`, fechas `31/12/1969` o datos nulos mal presentados.
- Los botones iconograficos tienen proposito claro y estado visual de hover/focus.
- Todo boton visible ejecuta una accion, abre un flujo o esta deshabilitado con razon comprensible.
- Tabs, filtros, drawers y modales no quedan tapados por header, sidebar ni navegacion movil.
- Las tablas grandes tienen scroll horizontal en tablet/mobile y no rompen el ancho de la pantalla.
- Los estados vacios explican que falta y, cuando corresponde, ofrecen una accion siguiente.
- Las acciones sensibles muestran confirmacion, motivo o feedback despues de ejecutarse.
- Las descargas/exportaciones funcionan tambien sin registros.
- La consola del navegador no muestra errores durante los flujos principales.

## Dashboard

Flujos a probar:
- Entrar a `/` y esperar carga completa de KPIs, graficos, alertas y listas.
- Revisar alertas prioritarias y abrir sus acciones.
- Crear tarea desde una alerta.
- Abrir alertas financieras y confirmar que navegan a la pestana correcta de Finanzas.
- Revisar ultimos pagos, contratos por vencer, ocupacion y accesos recientes.
- Abrir/cerrar campana de notificaciones.

Criterios de aceptacion:
- Los KPIs se leen sin superposicion en todos los viewports.
- Los graficos no aparecen cortados, vacios ni con warnings visibles.
- Las fechas nulas aparecen como `Sin fecha` o texto equivalente, nunca como fecha falsa.
- Las cards clickeables tienen respuesta clara.
- En mobile, las alertas y acciones quedan tocables sin zoom.

Pendientes conocidos de produccion:
- Definir si existira vista ejecutiva de dueno con margen, caja y ocupacion como foco principal.
- Agregar filtros por rango de fecha cuando exista historico operacional grande.

## Clientes

Flujos a probar:
- Listar, buscar y filtrar clientes.
- Crear cliente y validar campos obligatorios.
- Abrir ficha de cliente.
- Revisar contratos, documentos, pagos, vehiculos y datos de contacto.
- Subir o descargar documentos asociados si hay datos.
- Archivar cliente y revisar confirmacion/motivo si aplica.

Criterios de aceptacion:
- La tabla no se corta en tablet/mobile.
- La ficha mantiene jerarquia clara entre datos maestros, deuda, documentos y contratos.
- Los formularios no tienen labels ambiguos ni campos fuera de pantalla.
- Las acciones primarias son distinguibles de acciones secundarias.

Pendientes conocidos de produccion:
- Validacion formal de RUT.
- Normalizacion de telefono/email.
- Confirmar campos finales de onboarding: giro, contacto secundario, direccion de facturacion y autorizados.

## Contratos

Flujos a probar:
- Listar contratos por estado.
- Crear contrato con cliente y espacio disponible.
- Intentar crear contrato con datos incompletos.
- Renovar contrato.
- Suspender, reactivar y terminar contrato con motivo.
- Descargar PDF o archivo generado.
- Revisar contrato desde ficha de cliente si aplica.

Criterios de aceptacion:
- Estados y fechas son legibles en tabla y ficha.
- Acciones peligrosas no quedan junto a acciones primarias sin diferenciacion visual.
- Los modales/drawers se pueden cerrar y no pierden contexto.
- En mobile, el usuario puede llegar a acciones de contrato sin desplazamiento confuso.

Pendientes conocidos de produccion:
- Plantilla legal final.
- Definir garantias, reajustes y reglas comerciales reales.

## Documentos

Flujos a probar:
- Entrar a Documentos y revisar cola de revision.
- Filtrar por estado, entidad, vencimiento o busqueda.
- Abrir detalle/documento.
- Aprobar, rechazar o comentar documento.
- Descargar archivo.
- Revisar estados vacios.

Criterios de aceptacion:
- El estado documental se entiende sin leer codigo de color solamente.
- Las acciones de aprobar/rechazar piden informacion suficiente.
- La tabla no pierde columnas clave en tablet/mobile.
- Si no hay documentos, el estado vacio orienta el siguiente paso.

Pendientes conocidos de produccion:
- Politica final de vencimientos por tipo de documento.
- Versionado mas visible cuando se reemplace un archivo.

## Tareas

Flujos a probar:
- Listar tareas globales.
- Usar cards de resumen: vencen hoy, atrasadas y criticas activas.
- Filtrar por estado, categoria, prioridad, origen y asignado.
- Crear tarea.
- Abrir detalle, comentar, adjuntar evidencia y cerrar con nota cuando aplique.
- Revisar tareas creadas desde alertas del dashboard.

Criterios de aceptacion:
- Cada card filtra exactamente lo que promete.
- Los filtros combinados no se pisan visualmente.
- Prioridad, vencimiento y estado son visibles sin abrir el detalle.
- El flujo de cierre deja feedback claro.

Pendientes conocidos de produccion:
- SLA por categoria.
- Vistas guardadas por rol si aumenta el volumen.

## Espacios

Flujos a probar:
- Revisar inventario por estado, tipo, ubicacion y tarifa.
- Crear espacio con datos fisicos suficientes.
- Abrir ficha de espacio.
- Marcar mantenimiento, liberar/ocupar y revisar historial.
- Ver espacios desde tablet/mobile para comparar disponibilidad.

Criterios de aceptacion:
- Estado del espacio se distingue rapidamente.
- Dimensiones, ubicacion y cliente asociado no quedan escondidos.
- Acciones operativas piden motivo cuando corresponde.
- En mobile, cards o tabla permiten identificar espacio sin perder contexto.

Pendientes conocidos de produccion:
- Mapa/plano visual del recinto si el cliente opera por patio, pasillo o zona.
- Checklist de entrega/devolucion con fotos.

## Finanzas

Flujos a probar:
- Entrar por `/finance` y por links profundos: `?tab=payments`, `?tab=collections`, `?tab=expenses`, `?tab=cgvc`, `?tab=invoices`, `?tab=reports`.
- Revisar Cuentas por Cobrar.
- Abrir ficha de cuenta por cobrar si esta disponible.
- Registrar pago o revisar flujo de pago.
- Crear accion de cobranza.
- Crear gasto, aprobar/rechazar y exportar CSV.
- Importar o revisar sincronizacion CGVC.
- Revisar Facturacion SII en modo mock/local y confirmar que se presenta como demo/piloto, no como emision real aceptada por SII.
- Revisar reportes, formulas y fecha de corte.

Criterios de aceptacion:
- Cada pestana carga su informacion bajo el menu de pestanas, no encima del resumen.
- Las tablas exportables descargan archivo con cabeceras aunque esten vacias.
- Montos, fechas de corte y formulas son visibles y consistentes.
- Acciones financieras sensibles tienen motivo, estado y feedback.
- La pestana SII distingue visualmente entre mock/local de demo y emision tributaria real pendiente de proveedor.
- En mobile, los totales principales siguen visibles antes del detalle.

Pendientes conocidos de produccion:
- SII real queda pendiente hasta definir proveedor e integrar API/certificacion; el mock/local esta listo para demo/piloto y no debe operar como emision real en produccion.
- Reemplazar prompts simples por modales completos en aprobaciones sensibles.
- Confirmar plan contable, categorias finales de gastos y centros de costo con cliente.

## Seguridad

Flujos a probar:
- Entrar a modulo de accesos/seguridad.
- Revisar monitor en vivo.
- Crear visita o pase temporal.
- Ejecutar apertura manual con motivo.
- Revisar auditoria de acceso.
- Usar Bitacora de Turno desde `/access?tab=shift-log`.
- Registrar seguimiento y comprobar que queda visible.

Criterios de aceptacion:
- El flujo de guardia se puede operar en tablet/mobile.
- Apertura manual no parece accion accidental.
- Bitacora separa turno actual, novedades, pendientes y cierre.
- Los seguimientos pendientes quedan trazables y accionables.

Pendientes conocidos de produccion:
- Definir hardware real: barrera, camara, QR, lector o integracion externa.
- Definir modo dedicado para porteria si se operara desde tablet fija.

## Auditoria

Flujos a probar:
- Entrar a Auditoria como admin.
- Filtrar por actor, accion, entidad y fecha.
- Buscar una accion sensible reciente.
- Exportar CSV.
- Confirmar que no admin no deberia acceder a esta vista en prueba de roles separada.

Criterios de aceptacion:
- La tabla mantiene actor, accion, entidad y fecha visibles.
- Los filtros tienen feedback claro cuando no hay resultados.
- Exportar no depende de que existan filas.
- Acciones sensibles de finanzas, accesos, contratos, personal y backups aparecen registradas.

Pendientes conocidos de produccion:
- Retencion legal de auditoria.
- Filtros por severidad o entidad cuando aumente el volumen.

## Personal

Flujos a probar:
- Listar usuarios.
- Crear usuario real de administracion, finanzas y guardia.
- Forzar cambio de clave.
- Resetear clave.
- Bloquear/desbloquear usuario con motivo.
- Revisar que el usuario conectado no pueda autodesactivarse.

Criterios de aceptacion:
- Roles y estados se entienden sin abrir detalle.
- Acciones de seguridad no quedan disponibles sin confirmacion.
- Formularios de usuario tienen campos suficientes y labels claros.
- En mobile, acciones de usuario no se mezclan con datos de contacto.

Pendientes conocidos de produccion:
- Cambiar clave inicial `admin123`.
- Definir politica de contrasenas, 2FA y recuperacion de cuenta.

## Configuracion

Flujos a probar:
- Revisar datos generales de empresa.
- Guardar datos legales.
- Revisar readiness/health de operacion.
- Crear backup y descargarlo.
- Revisar configuracion de tasa de recuperacion.
- Confirmar que los mensajes de advertencia productiva son claros.

Criterios de aceptacion:
- Las advertencias de produccion se entienden y priorizan correctamente.
- Guardar configuracion entrega feedback claro.
- Backups muestran estado, fecha y accion disponible.
- En tablet/mobile, formularios no quedan partidos de forma confusa.

Pendientes conocidos de produccion:
- Completar datos legales reales.
- Configurar `APP_URL`, `NODE_ENV=production`, dominio HTTPS, rutas persistentes de DB/storage/backups.
- Definir politica de backups y restauracion.

## Reporte de ejecucion sugerido

Registrar cada modulo con este formato:

| Modulo | Desktop | Tablet | Mobile | Consola limpia | Pendiente |
| --- | --- | --- | --- | --- | --- |
| Dashboard | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Clientes | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Contratos | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Documentos | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Tareas | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Espacios | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Finanzas | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Seguridad | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Auditoria | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Personal | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |
| Configuracion | OK/Pendiente | OK/Pendiente | OK/Pendiente | Si/No | Nota |

## Bloqueantes para demo

- Pantalla principal de un modulo no carga.
- Accion primaria no responde.
- Tabla clave se corta sin posibilidad de scroll.
- Modal/drawer impide cerrar o guardar.
- Error visible en consola durante flujo normal.
- Exportacion prometida no descarga.
- Datos financieros muestran montos, fechas o estados inconsistentes.
- SII mock/local se presenta como documento tributario real emitido, aceptado o enviado al SII.
- Accion sensible se ejecuta sin confirmacion, motivo o feedback.

## Cierre

La revision se considera aprobada cuando todos los modulos estan `OK` en desktop y al menos `OK con observaciones menores` en tablet/mobile, sin bloqueantes de demo y con pendientes de produccion registrados como decisiones de negocio o infraestructura.
