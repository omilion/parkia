# Fase 2: correcciones de la revisión

Fecha: 2026-11-11. Cierre: 2026-11-12.

## Finanzas

`src/features/finance/pages/FinancePage.tsx` contiene ahora el shell (114 líneas), en lugar de la página de unas 4.275 líneas. Sus páginas y once diálogos se cargan con imports dinámicos.

| Ruta | Página |
| --- | --- |
| `/finanzas/pagos` | `PaymentsPage.tsx` |
| `/finanzas/cobranza` | `CollectionsPage.tsx` |
| `/finanzas/banco` | `BankPage.tsx` |
| `/finanzas/gastos` | `ExpensesPage.tsx` |
| `/finanzas/reportes` | `ReportsPage.tsx` |
| `/finanzas/cierres` | `ClosuresPage.tsx` |
| `/finanzas/documentos-tributarios` | `InvoicesPage.tsx` |

Los enlaces anteriores `/finance?tab=...` se redirigen conservando filtros y referencias. La sección activa se deriva de la ruta, por lo que funciona con recarga y navegación atrás/adelante.

Los datos del servidor pertenecen a `hooks/useFinanceData.ts`. Las consultas se habilitan por sección; abrir Pagos no solicita datos ni código de Gastos, DTE o Reportes. Las selecciones y estados de interfaz se organizan en hooks de pagos, banco, gastos, cobranza, reportes y DTE. Las acciones se separaron en módulos de banco, pagos, cobranza, gastos, reportes y DTE; los filtros y totales derivados están en `useFinanceSelectors`. El coordinador conserva la navegación y los efectos que comunican dominios. Tiene 567 líneas y tres llamadas propias a `useState` (antes, 1.536 líneas).

Las tablas de pagos, gastos y documentos tributarios usan `DataView`: tarjetas en teléfono y tabla desde 768 px. Se conservaron sus acciones y estados vacíos.

## Accesos y Plazas

`AccessPage.tsx` es un shell de 81 líneas. Se separaron actividad, pases, bitácora, historial, tarifas y formularios. Sus dos tablas usan `DataView`; la carga y el sondeo de datos utilizan Query.

`SpacesPage.tsx` es un shell de 105 líneas. Se separaron inventario, visitas, lista/grilla, mapa, editor y nueve paneles/diálogos. Las tres tablas de visitas, pagos y cierres usan `DataView`. El teléfono recibe una lista de plazas; el mapa admite zoom y arrastre y el editor se habilita desde tablet. Las acciones se separaron en inventario, visitas, mapas y edición; los estados también se agrupan por dominio. El coordinador tiene 439 líneas y dos llamadas propias a `useState` (antes, 1.027 líneas y 42 estados).

## Componentes y datos

El catálogo está en `src/ui/README.md`. `MoneyInput`, `PlateInput`, `RutInput`, `PageHeader` y `Skeleton` ya existían; ahora tienen uso en los nuevos flujos. Se añadieron `Dialog`, `Tabs` y `LoadingState`, y se integró el esqueleto en `DataView`.

Tareas usa Query, `FilterBar`, `LoadingState`, `PageHeader` y formularios independientes. La tarjeta, la edición en línea y el seguimiento son componentes propios; las etiquetas y utilidades están en `taskShared.ts`. La página bajó de 812 a 511 líneas. Configuración usa Query, navegación por secciones, `Dialog`, `PageHeader` y un formulario general independiente.

Las listas principales de los once módulos y Operar usan TanStack Query. El proveedor se desmonta al cerrar sesión. Los formularios de operación, nueva tarea, configuración general, nuevo contrato, pago de abonados y alta de cliente usan react-hook-form y Zod. El esquema de alta de cliente también lo usa la API. Las reglas compartidas se encuentran en `shared/schemas/` y se reutilizan en las rutas de la API. La sección siguiente cubre la migración de los formularios secundarios.

## Escrituras y errores

Las escrituras de la interfaz pasan por mutaciones de Query. `src/lib/useApiMutation.ts` proporciona transporte con credenciales, errores legibles, ausencia de reintentos automáticos y política de invalidación entre módulos, incluida Auditoría. Las mutaciones de formularios nuevos declaran esa misma política como metadatos; `DataProvider` la aplica desde `MutationCache`. Un aviso común permite ver y descartar errores. Algunos controladores siguen usando el adaptador `request` para leer la respuesta, pero ya reciben valores validados.

Una prueba analiza el código y rechaza llamadas HTTP de escritura fuera de `mutationFn`. Otra interrumpe la conexión al crear un cliente, comprueba que conserva sus campos y permite reintentar; exige que la lista se refresque tras guardar sin recargar. No se presenta la conversión del transporte como conversión de todos los formularios a RHF.

## Formularios secundarios

Los formularios de datos que quedaban con `FormData` o estado manual usan react-hook-form y Zod. Cada handler recibe valores ya validados y tipados, no el evento del formulario. Los errores aparecen bajo cada campo, con `aria-invalid` y `role="alert"`; las etiquetas quedaron asociadas por `htmlFor`.

| Módulo | Formularios |
| --- | --- |
| Finanzas | Ajuste de pago, reversa de abono, abono desde cartola (con tope por saldo), edición de movimiento, gasto, gestión de cobranza, presupuesto |
| Plazas | Alta y edición de plaza, mapa aéreo, ticket de entrada, cobro de visita (motivo obligatorio si se cobra menos), arqueo de caja |
| Accesos | Pase de visita (término posterior al inicio), autorización manual, tarifa, apertura de turno, novedad, cierre de turno con verificaciones |
| Clientes | Edición de ficha (RUT y correos validados), vehículo, documento |
| Contratos | Edición de términos (término igual o posterior al inicio) |
| Personal | Alta, edición y reinicio de clave; los dos modales hechos a mano pasaron a la primitiva `Dialog` |
| Configuración | Integraciones (modo SII y credenciales) |
| Operar | Conteo del cierre de caja |
| Sesión | Login y cambio de clave; el cambio de clave estaba duplicado en `App.tsx` y en el encabezado y ahora es un solo componente |
| Tareas | Edición en línea y seguimiento |
| Simulador LPR | Lectura de patente |

Las reglas están en `shared/schemas/` (`common`, `finance`, `spaces`, `access`, `clients`, `documents`, `contracts`, `staff`, `settings`, `tasks`, `auth`) y las rutas de la API importan esas mismas reglas en lugar de definir las suyas. Los límites de la API se conservaron; solo cambió que un campo vacío llega como `null` en lugar de fallar.

Quedan dos formularios sin `useForm`, a propósito: la búsqueda de ticket por patente (un filtro de un campo) y la carga del contrato firmado (solo un archivo, validado con la misma regla de Documentos).

Una prueba recorre `src/` y falla si aparece `new FormData(` o un `<form>` sin `useForm` que no esté en esa lista de excepciones. Otra exige que cada módulo de `shared/schemas/` lo use también el servidor.

Para no superar el presupuesto de carga inicial, el login, el cambio de clave y el panel del simulador se descargan cuando se muestran; Zod y react-hook-form no forman parte del arranque.

## Clientes y Contratos

Clientes separa el alta y la ficha; sus siete paneles se cargan por demanda. Contratos separa alta, detalle, edición, cambio de estado, renovación y contrato firmado. Sus diálogos usan la primitiva común con control del foco y cierre por teclado. Ambas fichas consultan con Query y reciben invalidaciones tras guardar.

## Verificación

Última ejecución completa: 2026-11-12.

- `npm run lint`: aprobado.
- `npm run build`: aprobado, con archivos independientes para páginas y diálogos.
- `npm test`: 88 pruebas. La de bloqueo de login (`persists login lockout attempts...`) falla en algunas ejecuciones con `ECONNRESET` antes de enviar credenciales; es inestabilidad de la conexión en la prueba, no de la validación. Las demás pasan siempre.
- `npm run test:dte`: 25 aprobadas.
- `npm run test:e2e`: 40 aprobadas (incluye 4 de formularios secundarios y 2 de convenciones).
- Capturas de las doce rutas principales en los cinco tamaños del plan.
- Detección de desborde en contenedores reales a 360, 390, 768 y 1024 px, incluso sin desborde del documento; se excluyen las pestañas, cuyo scroll es intencional. Las subvistas se recorren a 360, 768 y 1024 px.
- Una prueba introduce una tabla de 720 px en un contenedor de 300 px y exige detectar el desborde. La ampliación encontró y corrigió desbordes reales de Contratos y Auditoría en tablet; esta última se verifica también con los eventos generados por los recorridos anteriores.
- Recorridos de entrada, cobro, salida y cierre para guardia y cajero; pago de abonado, contrato por pasos, tareas, configuración y mapa móvil.
- Pruebas de rutas financieras, carga diferida, error de red y campos inválidos.
- Formularios secundarios: gasto con errores por campo y alta válida; clave de personal que no coincide (sin enviar a la API); cierre de turno sin verificaciones ni resumen; plaza con precio vacío (no se envía como cero).
- axe WCAG A/AA y 2.1 en las doce rutas principales y las siete secciones de Finanzas, a 360 y 768 px; además, Operar con rol guardia. La ruta duplicada de Finanzas se comprueba por sus siete destinos. Se corrigieron contraste, controles sin nombre y roles ARIA. Los diálogos secundarios no se consideran auditados automáticamente por esta cobertura.
- Presupuesto de inicio inferior a 200 KB comprimidos de JavaScript y CSS, verificado en navegador. Los gráficos del inicio usan componentes ligeros con leyendas y datos accesibles.

## Estado

Fase 2 cerrada. Quedan pendientes que no bloquean el cierre:

- Inicio (762 líneas) y Configuración (664) siguen siendo archivos grandes.
- El proyecto compila sin `strict` y sin `@types/react`. Sin modo estricto, TypeScript no detecta que un handler reciba un evento en vez de valores (la prueba de convenciones cubre ese caso). Activarlo es un trabajo propio.
- axe no recorre los diálogos abiertos.
- La prueba inestable de bloqueo de login.

Esta nota registra las correcciones y su evidencia.
