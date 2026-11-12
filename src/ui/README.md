# Interfaz compartida de Parkia

Los componentes se importan desde `src/ui/index.ts`.

| Archivo | Componentes |
| --- | --- |
| `Button.tsx` | `Button`, `IconButton`, estados de carga y tamaños táctiles |
| `Field.tsx` | `Field`, `Input`, `Select`, `Textarea`, `MoneyInput`, `PlateInput`, `RutInput`, `DateInput` |
| `DataView.tsx` | Una definición de columnas; tabla desde 768 px y tarjetas debajo |
| `FilterBar.tsx` | Filtros en línea o en una hoja inferior |
| `Sheet.tsx` | Panel lateral/hoja inferior con foco, Escape y pie fijo opcional |
| `Dialog.tsx` | Diálogo centrado/hoja inferior con la misma gestión de foco |
| `Tabs.tsx` | Pestañas con flechas, Home/End y estado controlado o en la URL |
| `Display.tsx` | `PageHeader`, `Badge`, `StatCard`, `EmptyState`, `Skeleton` |
| `LoadingState.tsx` | Esqueletos con anuncio de carga para lectores de pantalla |

`MoneyInput` entrega un número mediante `onValueChange`; con react-hook-form se usa `Controller`.
`PlateInput` y `RutInput` admiten `register` y normalizan el texto antes del `onChange`.
`Field` recibe `htmlFor`, que debe coincidir con el identificador del control.

En `DataView`, `primary` define el encabezado de cada tarjeta y `fullWidthOnMobile` reserva una fila completa para formularios o acciones. Las columnas móviles conservan sus etiquetas. No se debe convertir una tabla únicamente mediante CSS ni ocultar columnas que contengan acciones necesarias.

Los datos de servidor pertenecen a TanStack Query dentro de `DataProvider`. Este proveedor se desmonta al cerrar sesión para descartar la caché del usuario. Las escrituras deben invalidar las consultas afectadas y no tienen reintentos automáticos.

Los formularios nuevos de contratos, tareas, configuración general, operación y pago de abonados usan react-hook-form y esquemas de `shared/schemas`. La API reutiliza las reglas compartidas y sigue comprobando permisos y pertenencia al tenant.

Para escribir se usa `useApiMutation` de `src/lib/useApiMutation.ts`: `json` devuelve el resultado o lanza un error; `request` conserva la interfaz `Response` de los formularios heredados. La invalidaci?n se define en `invalidatedDomains`, incluida la actualizaci?n de otros m?dulos y Auditor?a. Las mutaciones nativas de Query declaran la misma lista en `meta.invalidates`; `DataProvider` la aplica con `MutationCache`.

`MutationErrorNotice` presenta los errores de guardado. Los formularios deben conservar sus valores al fallar y deshabilitar la acci?n mientras se guarda. `tests/e2e/mutations.spec.ts` comprueba la ausencia de escrituras directas y la recuperaci?n tras un fallo de conexi?n.
