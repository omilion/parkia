# Política de Retención y Protección de Datos Personales (Ley N° 21.719)

Este documento define los plazos de conservación, anonimización y supresión de datos personales tratados por **Parkia** en su calidad de encargado del tratamiento para cada empresa cliente (responsable del tratamiento), en cumplimiento de la Ley N° 21.719 sobre Protección de los Datos Personales (Chile) y las obligaciones tributarias del Servicio de Impuestos Internos (SII).

## 1. Tabla de retención por tabla y categoría de datos

| Tabla / Categoría | Datos personales involucrados | Plazo de retención operativa | Acción al vencer el plazo | Excepción legal / tributaria |
| --- | --- | --- | --- | --- |
| `visitor_tickets` (tickets ocasionales) | `plate` (patente), metadatos de entrada/salida | **90 días** desde el cierre (`completed`) o pago | Anonimización de `plate` (`ANON-<id>`) y registro de `anonymized_at` | Si está asociado a `dte_documents` / `invoices`, el documento tributario conserva monto, folio y fecha por 6 años |
| `visitor_ticket_quotes` / `access_logs` | `plate`, dirección IP / agente | **90 días** desde creación | Purga o anonimización de patente/IP | Ninguna salvo investigación de incidente |
| `auth_sessions` / `auth_password_resets` / `auth_email_verifications` / `auth_login_attempts` | `ip_address`, `user_agent`, hashes de token, `email` | **30 días** tras expiración o revocación | Eliminación física (`sessions.cleanup` + `privacy.retention`) | Ninguna |
| `clients` y `vehicles` (abonados inactivos) | `name`, `rut`, `email`, `phone`, `address`, `plate` | **24 meses** tras término del último contrato activo (`archived` / sin contratos vigentes) | Anonimización de campos identificatorios (`name = 'Titular Anonimizado'`, `rut/email/phone/address = NULL`) y `anonymized_at` | `invoices`, `payments` y `dte_documents` mantienen montos, folios y fechas por **6 años** (Art. 200 Código Tributario) |
| `staff` (personal desvinculado) | `name`, `rut`, `email`, `phone` | **36 meses** desde paso a `inactive` | Anonimización de contacto/nombre/RUT conservando integridad referencial en auditoría | Registros laborales/previsionales del responsable fuera de Parkia |
| `privacy_consents` | `subject_identifier`, `purpose`, `policy_version`, `ip_address` | **5 años** desde otorgamiento o revocación | Conservación como prueba de cumplimiento (Art. 12 Ley 21.719) | Obligación legal de trazabilidad de consentimiento |
| `dte_documents` / `invoices` / `payments` | Montos, fechas, folios SII, razón social tributaria | **6 años** desde emisión/pago | Conservación íntegra sin supresión durante el plazo tributario | Art. 17 y Art. 200 del Código Tributario (Chile) |
| `audit_events` | `actor_id`, `action`, `details` | **24 meses** | Purga de metadatos personales no tributarios tras vencimiento | Trazabilidad de seguridad e imputaciones |

## 2. Derechos ARCO+ (Acceso, Rectificación, Supresión y Portabilidad)

Los administradores del tenant pueden atender solicitudes de titulares mediante los endpoints y la sección **Privacidad (Ley 21.719)**:

- **Exportación / Portabilidad (`GET /api/privacy/titular/export?rut=...&plate=...&email=...`):** entrega en JSON todos los registros asociados al titular dentro del tenant (ficha de cliente, vehículos, contratos, tickets, pagos, documentos tributarios y consentimientos registrados).
- **Supresión / Anonimización (`POST /api/privacy/titular/delete`):** elimina o anonimiza los datos personales identificatorios del titular (`clients`, `vehicles`, `visitor_tickets`, `staff`) y registra `anonymized_at` junto con un evento en `audit_events`. Los documentos tributarios (`invoices`, `dte_documents`, `payments`) preservan sus montos, folios y fechas conforme al Código Tributario.

## 3. Ejecución automática

El job `"privacy.retention"` (`runPrivacyRetentionJob` en `server/modules/saas/privacy.ts`) se ejecuta periódicamente para anonimizar automáticamente tickets de visita cerrados con más de 90 días (`PARKIA_PRIVACY_TICKET_RETENTION_DAYS`, configurable) y purgar registros de intentos/verificaciones expirados.

