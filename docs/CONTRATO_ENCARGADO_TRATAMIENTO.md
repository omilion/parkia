# Contrato de Encargado de Tratamiento de Datos Personales (Ley N° 21.719)

> **Plantilla estándar** entre la Empresa Cliente (**"Responsable del Tratamiento"**) y **Parkia** (**"Encargado del Tratamiento"**), complementaria a los Términos de Servicio SaaS.

## 1. Partes y Objeto

- **Responsable del Tratamiento:** La razón social individualizada en la cuenta del tenant en Parkia (en adelante, el **Responsable**).
- **Encargado del Tratamiento:** `[RAZÓN SOCIAL PARKIA / PRESTADOR]`, RUT `[RUT PARKIA]`, domicilio `[DOMICILIO]` (en adelante, **Parkia** o el **Encargado**).

El presente contrato regula el tratamiento de datos personales que Parkia efectúa por cuenta del Responsable para la prestación de la plataforma SaaS de gestión de estacionamientos, control de accesos, cobranza de abonados y facturación electrónica.

## 2. Naturaleza, Finalidad y Categorías de Datos

- **Finalidades:** Operación de turnos de portería, registro de ingresos y salidas por patente, gestión de contratos de abonados, cobro en línea y emisión de Documentos Tributarios Electrónicos (DTE).
- **Categorías de titulares:** Abonados (personas naturales y representantes de personas jurídicas), conductores ocasionales, personal operativo y usuarios administradores del Responsable.
- **Datos tratados:** Nombre completo, RUT, correo electrónico, teléfono, dirección, patente vehicular, historial de entradas/salidas y registros de pago.

## 3. Obligaciones del Encargado (Ley N° 21.719)

1. **Instrucciones documentadas:** Tratar los datos únicamente conforme a las instrucciones del Responsable y para la prestación del servicio contratado, sin utilizarlos para fines propios ni comercialización a terceros.
2. **Confidencialidad:** Garantizar que todo el personal autorizado que acceda a los datos esté sujeto a deber de confidencialidad.
3. **Medidas de seguridad:** Mantener cifrado en tránsito (TLS), contraseñas con hash seguro (`scrypt`), aislamiento lógico por `tenant_id` y Row-Level Security (RLS) en base de datos, control de acceso por roles, autenticación multifactor (2FA TOTP) opcional y auditoría de suplantación de soporte (`platform_admin`).
4. **Asistencia en derechos de los titulares:** Proveer herramientas técnicas de exportación (`GET /api/privacy/titular/export`) y supresión/anonimización (`POST /api/privacy/titular/delete`) para que el Responsable responda dentro de los plazos legales de la Ley N° 21.719.
5. **Notificación de brechas de seguridad:** Informar al Responsable sin dilación indebida, y dentro del plazo máximo exigido por la normativa vigente desde que tome conocimiento, cualquier incidente de seguridad que comprometa datos personales.
6. **Subencargados:** El Responsable autoriza el uso de subencargados necesarios para la infraestructura (alojamiento en la nube, envío de correo transaccional y pasarelas de pago), quienes quedan sujetos a obligaciones equivalentes de confidencialidad y seguridad.
7. **Término y devolución/supresión:** Al término de la relación contractual, Parkia mantendrá habilitada la exportación completa de datos (`GET /api/tenant/export`) durante el período de gracia y procederá a la supresión o anonimización irreversible una vez vencidos los plazos operativos y tributarios aplicables.

## 4. Registro de Consentimiento y Trazabilidad

Parkia registra la aceptación electrónica de este contrato y de la Política de Privacidad en la tabla `privacy_consents` (versión de política, fecha/hora, identificador del titular, dirección IP y agente de usuario).

