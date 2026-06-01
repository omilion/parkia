import type { Express } from "express";
import { mkdirSync, readdirSync, statSync } from "fs";
import path from "path";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { hashPassword } from "../auth/password";
import { getCurrentUser, requireAnyRole, revokeUserSessions } from "../auth/sessions";
import { db } from "../db";
import { getParkiaEnv } from "../env";
import { recordStaffAccessEvent } from "../staffAccess";
import { optionalTextSchema, parseBody } from "../validation";

const createStaffSchema = z.object({
  name: z.string().trim().min(1),
  rut: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: optionalTextSchema,
  role: z.enum(["admin", "finance", "guard", "cashier"]),
  password: z.string().min(8).optional(),
});

const updateStaffStatusSchema = z.object({
  status: z.enum(["active", "inactive"]),
  reason: z.string().trim().min(3).max(500),
});

const updateStaffSchema = z.object({
  name: z.string().trim().min(1),
  rut: z.string().trim().min(1),
  email: z.string().trim().email(),
  phone: optionalTextSchema,
  role: z.enum(["admin", "finance", "guard", "cashier"]),
  reason: z.string().trim().min(3).max(500),
});

const resetStaffPasswordSchema = z.object({
  password: z.string().min(8),
  reason: z.string().trim().min(3).max(500),
});

const updateTotemSchema = z.object({
  maintenance_mode: z.coerce.boolean(),
});

const updateConfigSchema = z.object({
  grace_days: z.coerce.number().int().min(0).optional(),
  late_interest: z.coerce.number().min(0).optional(),
  overdue_recovery_rate: z.coerce.number().min(0).max(100).optional(),
  company_name: optionalTextSchema,
  company_rut: optionalTextSchema,
  company_address: optionalTextSchema,
  sii_api_key: optionalTextSchema,
  sii_provider: z.enum(["local_mock", "external_provider"]).optional(),
  sii_mode: z.enum(["disabled", "mock", "real"]).optional(),
  sii_environment: z.enum(["demo", "production"]).optional(),
  bank_api_key: optionalTextSchema,
}).partial();

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  action: optionalTextSchema,
  entity_type: optionalTextSchema,
  staff_id: z.coerce.number().int().positive().optional(),
  from: optionalTextSchema,
  to: optionalTextSchema,
  q: optionalTextSchema,
});

const importTemplates = [
  {
    id: "clients",
    label: "Clientes y vehiculos",
    description: "Base comercial para personas, empresas, facturacion y patente principal.",
    columns: [
      "Nombre",
      "RUT",
      "Correo",
      "Teléfono",
      "Tipo",
      "Patente",
      "Dirección",
      "Comuna",
      "Ciudad",
      "Giro",
      "Representante legal",
      "RUT representante legal",
      "Contacto facturación",
      "Correo facturación",
      "Teléfono facturación",
      "Notas",
    ],
    rows: [
      ["Cliente Ejemplo", "11.111.111-1", "cliente@example.com", "+56911111111", "Persona natural", "ABCD-11", "Av. Ejemplo 123", "Santiago", "Santiago", "", "", "", "Cliente Ejemplo", "cliente@example.com", "+56911111111", "Cliente inicial"],
      ["Empresa Ejemplo SpA", "22.222.222-2", "empresa@example.com", "+56922222222", "Empresa", "", "Av. Empresa 456", "Providencia", "Santiago", "Servicios", "Representante Legal", "12.345.678-9", "Finanzas Empresa", "finanzas@empresa.cl", "+56922222222", "Empresa inicial"],
    ],
  },
  {
    id: "spaces",
    label: "Plazas de estacionamiento",
    description: "Inventario inicial de plazas por sucursal, estado, tarifa mensual y ubicacion.",
    columns: ["Sucursal", "Nombre", "Estado", "Precio mensual", "Ubicacion", "Nivel", "Ancho m", "Largo m", "Alto m", "Caracteristicas", "Notas"],
    rows: [
      ["Sucursal Principal", "A-01", "Disponible", "65000", "Sector norte", "1", "2.5", "5", "2.2", "Techado, camara", "Plaza inicial"],
      ["Sucursal Principal", "E-12", "Mantencion", "65000", "Patio exterior", "0", "2.5", "5", "", "Descubierto", "Revisar demarcacion"],
    ],
  },
  {
    id: "subscribers",
    label: "Abonados",
    description: "Carga base para clientes con contrato mensual, vehiculo principal y plaza asignada.",
    columns: ["RUT cliente", "Nombre cliente", "Correo", "Telefono", "Patente", "Sucursal", "Plaza", "Fecha inicio", "Fecha termino", "Mensualidad", "Dia facturacion", "Garantia", "Documento facturacion", "Notas"],
    rows: [
      ["11.111.111-1", "Cliente Abonado", "abonado@example.com", "+56911111111", "ABCD-11", "Sucursal Principal", "A-01", "2026-06-01", "", "65000", "5", "65000", "boleta", "Abonado mensual"],
    ],
  },
  {
    id: "contracts",
    label: "Contratos",
    description: "Contratos vigentes vinculados por RUT de cliente y nombre de espacio.",
    columns: ["RUT cliente", "Espacio", "Fecha inicio", "Fecha término", "Mensualidad", "Día facturación", "Garantía", "Documento facturación", "Notas"],
    rows: [
      ["11.111.111-1", "Estacionamiento A-01", "2026-05-01", "", "65000", "5", "65000", "boleta", "Contrato mensual"],
    ],
  },
  {
    id: "payments",
    label: "Saldos y pagos",
    description: "Cuotas pendientes o historicas para dejar la cobranza al dia.",
    columns: ["Contrato", "RUT cliente", "Monto", "Fecha de vencimiento", "Estado", "Fecha de pago", "Método", "Referencia"],
    rows: [
      ["", "11.111.111-1", "85000", "2026-05-05", "Pendiente", "", "", "Saldo inicial mayo"],
      ["", "22.222.222-2", "65000", "2026-04-05", "Pagado", "2026-04-04", "Transferencia", "TRX-123"],
    ],
  },
  {
    id: "expenses",
    label: "Gastos",
    description: "Gastos por pagar o pagados para iniciar finanzas con costos reales.",
    columns: ["Fecha", "Categoría", "Proveedor", "RUT proveedor", "Descripción", "Monto neto", "Impuesto", "Monto total", "Tipo documento", "Número documento", "Método de pago", "Estado de pago", "Fecha de pago", "Fecha de vencimiento", "Notas"],
    rows: [
      ["2026-05-10", "Mantención", "Proveedor Mantencion", "76.111.222-3", "Mantencion porton", "100000", "19000", "119000", "Factura", "F-123", "Transferencia", "Pendiente", "", "2026-05-30", "Carga inicial"],
    ],
  },
  {
    id: "bank-movements",
    label: "Cartola bancaria",
    description: "Movimientos bancarios para conciliacion manual o automatica.",
    columns: ["Fecha", "Glosa", "RUT", "Monto", "Notas"],
    rows: [
      ["2026-05-12", "TRANSFERENCIA CLIENTE EJEMPLO", "11.111.111-1", "85000", "Carga inicial cartola"],
      ["2026-05-13", "PAGO PROVEEDOR MANTENCION", "76.111.222-3", "-119000", "Gasto"],
    ],
  },
  {
    id: "rates",
    label: "Tarifas de visitas",
    description: "Tarifas operativas para cobro por minuto, periodo de gracia y estacionamiento de visitantes.",
    columns: ["Tipo", "Tarifa por minuto", "Minutos de gracia", "Sucursal", "Notas"],
    rows: [
      ["visitor", "50", "10", "Sucursal Principal", "Tarifa general de visita"],
      ["overnight", "35", "0", "Sucursal Principal", "Tarifa nocturna referencial"],
    ],
  },
];

function getBackupRoot() {
  return path.resolve(getParkiaEnv("PARKIA_BACKUP_PATH", "TIOLUCHIN_BACKUP_PATH", path.join(process.cwd(), "backups")));
}

function isBackupFileName(fileName: string) {
  return /^(parkia|tioluchin)-.+\.sqlite(\.gz)?$/.test(fileName) || /^parkia-full-.+\.tar\.gz$/.test(fileName);
}

function getBackupPath(fileName: string) {
  if (!isBackupFileName(fileName)) throw new Error("Nombre de respaldo invÃ¡lido");
  const backupRoot = getBackupRoot();
  const resolved = path.resolve(backupRoot, fileName);
  if (!resolved.startsWith(`${backupRoot}${path.sep}`)) throw new Error("Ruta de respaldo invÃ¡lida");
  return resolved;
}

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: unknown[][]) {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

const auditActionLabels: Record<string, string> = {
  "payment.registered": "Pago registrado",
  "payment_adjustment.created": "Ajuste financiero creado",
  "bank_movement.reconciled": "Movimiento bancario conciliado",
  "bank_movement.allocated": "Abono aplicado desde cartola",
  "payment_allocation.reversed": "Abono reversado",
  "expense.created": "Gasto creado",
  "expense.updated": "Gasto actualizado",
  "expense.status_updated": "Estado de gasto actualizado",
  "guard_shift_log.opened": "Bitácora de turno abierta",
  "guard_shift_log.closed": "Bitácora de turno cerrada",
  "guard_shift_log.entry_created": "Novedad de turno creada",
  "access.denied_resolved_by_override": "Acceso denegado resuelto por apertura manual",
  "access.manual_override": "Apertura manual registrada",
  "dashboard_alert.task_created": "Tarea creada desde alerta",
  "operational_task.created": "Tarea operacional creada",
  "operational_task.completed": "Tarea operacional cerrada",
  "staff.password_reset": "Contraseña de usuario reiniciada",
  "staff.status_updated": "Estado de usuario actualizado",
  "staff.role_updated": "Rol de usuario actualizado",
  "finance_month.closed": "Mes financiero cerrado",
  "finance_month.reopened": "Mes financiero reabierto",
  "document.updated": "Documento actualizado",
};

const auditEntityLabels: Record<string, string> = {
  payment: "Pago",
  payment_adjustment: "Ajuste financiero",
  bank_movement: "Movimiento bancario",
  payment_allocation: "Abono",
  expense: "Gasto",
  guard_shift_log: "Bitácora de turno",
  guard_shift_log_entry: "Novedad de turno",
  access_log: "Registro de acceso",
  dashboard_alert: "Alerta dashboard",
  operational_task: "Tarea operacional",
  staff: "Usuario",
  monthly_finance_closure: "Cierre financiero",
  document: "Documento",
};

function auditLabel(map: Record<string, string>, value: unknown) {
  const key = String(value ?? "");
  return map[key] || key.replace(/[._]/g, " ");
}

function buildAuditFilters(query: unknown) {
  const parsed = auditQuerySchema.safeParse(query);
  if (!parsed.success) return { error: "Filtros de auditoria invalidos" };

  const where: string[] = [];
  const params: unknown[] = [];
  const { action, entity_type, staff_id, from, to, q } = parsed.data;

  if (action) {
    where.push("a.action = ?");
    params.push(action);
  }
  if (entity_type) {
    where.push("a.entity_type = ?");
    params.push(entity_type);
  }
  if (staff_id) {
    where.push("a.staff_id = ?");
    params.push(staff_id);
  }
  if (from) {
    where.push("date(a.created_at) >= date(?)");
    params.push(from);
  }
  if (to) {
    where.push("date(a.created_at) <= date(?)");
    params.push(to);
  }
  if (q) {
    const like = `%${q}%`;
    where.push("(a.action LIKE ? OR a.entity_type LIKE ? OR a.entity_id LIKE ? OR a.metadata LIKE ? OR s.name LIKE ? OR s.email LIKE ?)");
    params.push(like, like, like, like, like, like);
  }

  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
    limit: parsed.data.limit,
  };
}

export function registerAdminRoutes(app: Express) {
  app.use("/api/import/templates", requireAnyRole(["admin", "finance"]));
  app.use(["/api/staff", "/api/config", "/api/totems", "/api/audit-events", "/api/backups"], requireAnyRole(["admin"]));

  // Staff & Config API
  app.get("/api/staff", (req, res) => {
    const staff = db.prepare(`
      SELECT id, name, rut, email, phone, role, status, last_access, must_change_password, password_changed_at, updated_at
      FROM staff
      ORDER BY status ASC, role ASC, name ASC
    `).all().map((user: any) => ({ ...user, must_change_password: Boolean(user.must_change_password) }));
    res.json(staff);
  });

  app.post("/api/staff", (req, res) => {
    const body = parseBody(createStaffSchema, req.body, res);
    if (!body) return;

    const { name, rut, email, phone, role, password } = body;
    try {
      const result = db.prepare(`
        INSERT INTO staff (name, rut, email, phone, role, password_hash, must_change_password)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(name, rut, email, phone, role, hashPassword(password || "Cambiar123!"));
      recordAuditEvent(req, {
        action: "staff.created",
        entityType: "staff",
        entityId: result.lastInsertRowid,
        metadata: { email, role, must_change_password: true },
      });
      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/staff/:id/access-events", (req, res) => {
    const staff = db.prepare("SELECT id FROM staff WHERE id = ?").get(req.params.id);
    if (!staff) return res.status(404).json({ error: "Usuario no encontrado" });

    const events = db.prepare(`
      SELECT id, staff_id, event_type, ip_address, user_agent, metadata, created_at
      FROM staff_access_events
      WHERE staff_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 80
    `).all(req.params.id);
    res.json(events);
  });

  app.patch("/api/staff/:id", (req, res) => {
    const body = parseBody(updateStaffSchema, req.body, res);
    if (!body) return;

    const currentUser = getCurrentUser(req);
    const staff = db.prepare("SELECT id, name, rut, email, phone, role, status FROM staff WHERE id = ?").get(req.params.id) as { id: number, name: string, rut: string, email: string, phone: string | null, role: string, status: string } | undefined;
    if (!staff) return res.status(404).json({ error: "Usuario no encontrado" });

    const roleChanged = staff.role !== body.role;
    if (staff.id === currentUser?.id && roleChanged && body.role !== "admin") {
      return res.status(400).json({ error: "No puedes quitarte tu propio rol administrador" });
    }

    if (staff.role === "admin" && staff.status === "active" && roleChanged && body.role !== "admin") {
      const activeAdmins = db.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'admin' AND status = 'active' AND id != ?").get(staff.id) as { count: number };
      if (activeAdmins.count === 0) {
        return res.status(400).json({ error: "Debe existir al menos un administrador activo" });
      }
    }

    try {
      db.prepare(`
        UPDATE staff
        SET name = ?, rut = ?, email = ?, phone = ?, role = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(body.name, body.rut, body.email, body.phone, body.role, staff.id);

      if (roleChanged) revokeUserSessions(staff.id);

      recordAuditEvent(req, {
        action: roleChanged ? "staff.role_updated" : "staff.profile_updated",
        entityType: "staff",
        entityId: staff.id,
        metadata: {
          reason: body.reason,
          previous: { name: staff.name, rut: staff.rut, email: staff.email, phone: staff.phone, role: staff.role },
          current: { name: body.name, rut: body.rut, email: body.email, phone: body.phone, role: body.role },
          sessions_revoked: roleChanged,
        },
      });
      recordStaffAccessEvent(req, {
        staffId: staff.id,
        eventType: roleChanged ? "role_changed" : "profile_updated",
        metadata: { reason: body.reason, previous_role: staff.role, role: body.role },
      });
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.patch("/api/staff/:id/status", (req, res) => {
    const body = parseBody(updateStaffStatusSchema, req.body, res);
    if (!body) return;

    const { status } = body;
    const currentUser = getCurrentUser(req);
    const staff = db.prepare("SELECT id, email, role, status FROM staff WHERE id = ?").get(req.params.id) as { id: number, email: string, role: string, status: string } | undefined;
    if (!staff) return res.status(404).json({ error: "Usuario no encontrado" });

    if (staff.id === currentUser?.id && status === "inactive") {
      return res.status(400).json({ error: "No puedes desactivar tu propio usuario" });
    }

    if (staff.role === "admin" && staff.status === "active" && status === "inactive") {
      const activeAdmins = db.prepare("SELECT COUNT(*) as count FROM staff WHERE role = 'admin' AND status = 'active' AND id != ?").get(staff.id) as { count: number };
      if (activeAdmins.count === 0) {
        return res.status(400).json({ error: "Debe existir al menos un administrador activo" });
      }
    }

    db.prepare("UPDATE staff SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, staff.id);
    if (status === "inactive") revokeUserSessions(staff.id);
    recordStaffAccessEvent(req, {
      staffId: staff.id,
      eventType: "status_changed",
      metadata: { previous_status: staff.status, status, reason: body.reason },
    });
    recordAuditEvent(req, {
      action: "staff.status_updated",
      entityType: "staff",
      entityId: staff.id,
      metadata: { email: staff.email, role: staff.role, previous_status: staff.status, status, reason: body.reason },
    });
    res.json({ success: true });
  });

  app.post("/api/staff/:id/password", (req, res) => {
    const body = parseBody(resetStaffPasswordSchema, req.body, res);
    if (!body) return;

    const staff = db.prepare("SELECT id, email FROM staff WHERE id = ?").get(req.params.id) as { id: number, email: string } | undefined;
    if (!staff) return res.status(404).json({ error: "Usuario no encontrado" });

    db.prepare(`
      UPDATE staff
      SET password_hash = ?, must_change_password = 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(hashPassword(body.password), staff.id);
    revokeUserSessions(staff.id);
    recordStaffAccessEvent(req, { staffId: staff.id, eventType: "password_reset", metadata: { email: staff.email, reason: body.reason } });
    recordAuditEvent(req, {
      action: "staff.password_reset",
      entityType: "staff",
      entityId: staff.id,
      metadata: { email: staff.email, reason: body.reason },
    });
    res.json({ success: true });
  });

  app.get("/api/config", (req, res) => {
    const config = db.prepare("SELECT * FROM system_config WHERE id = 1").get();
    res.json(config || {});
  });

  app.patch("/api/config", (req, res) => {
    const body = parseBody(updateConfigSchema, req.body, res);
    if (!body) return;

    const fields = Object.keys(body);
    if (fields.length === 0) return res.status(400).json({ error: "No valid config fields provided" });

    const sets = fields.map(f => `${f} = ?`).join(", ");
    const values = Object.values(body);
    db.prepare(`UPDATE system_config SET ${sets} WHERE id = 1`).run(...values);
    recordAuditEvent(req, {
      action: "config.updated",
      entityType: "system_config",
      entityId: 1,
      metadata: { fields },
    });
    res.json({ success: true });
  });

  app.get("/api/totems", (req, res) => {
    const totems = db.prepare("SELECT * FROM totems").all();
    res.json(totems);
  });

  app.patch("/api/totems/:id", (req, res) => {
    const body = parseBody(updateTotemSchema, req.body, res);
    if (!body) return;

    const { maintenance_mode } = body;
    db.prepare("UPDATE totems SET maintenance_mode = ? WHERE id = ?").run(maintenance_mode ? 1 : 0, req.params.id);
    recordAuditEvent(req, {
      action: "totem.maintenance_updated",
      entityType: "totem",
      entityId: req.params.id,
      metadata: { maintenance_mode },
    });
    res.json({ success: true });
  });

  app.get("/api/audit-events", (req, res) => {
    const filters = buildAuditFilters(req.query);
    if ("error" in filters) return res.status(400).json({ error: filters.error });

    const events = db.prepare(`
      SELECT a.*, s.name as staff_name, s.email as staff_email
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `).all(...filters.params, filters.limit);

    res.json(events);
  });

  app.get("/api/audit-events/summary", (req, res) => {
    const filters = buildAuditFilters(req.query);
    if ("error" in filters) return res.status(400).json({ error: filters.error });

    const total = db.prepare(`
      SELECT COUNT(*) as count
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
    `).get(...filters.params) as { count: number };

    const byAction = db.prepare(`
      SELECT a.action, COUNT(*) as count
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
      GROUP BY a.action
      ORDER BY count DESC, a.action ASC
      LIMIT 8
    `).all(...filters.params);

    const byEntity = db.prepare(`
      SELECT a.entity_type, COUNT(*) as count
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
      GROUP BY a.entity_type
      ORDER BY count DESC, a.entity_type ASC
      LIMIT 8
    `).all(...filters.params);

    const byUser = db.prepare(`
      SELECT COALESCE(s.name, 'Sistema') as staff_name, COALESCE(s.email, '') as staff_email, COUNT(*) as count
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
      GROUP BY COALESCE(s.name, 'Sistema'), COALESCE(s.email, '')
      ORDER BY count DESC, staff_name ASC
      LIMIT 8
    `).all(...filters.params);

    res.json({ total: total.count, byAction, byEntity, byUser });
  });

  app.get("/api/audit-events/export.csv", (req, res) => {
    const filters = buildAuditFilters({ ...req.query, limit: 500 });
    if ("error" in filters) return res.status(400).json({ error: filters.error });

    const events = db.prepare(`
      SELECT a.id, a.created_at, s.name as staff_name, s.email as staff_email, a.action,
             a.entity_type, a.entity_id, a.metadata, a.ip_address
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      ${filters.whereSql}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ?
    `).all(...filters.params, filters.limit) as Record<string, unknown>[];

    const csv = toCsv([
      ["ID", "Fecha", "Usuario", "Correo usuario", "Acción", "Tipo entidad", "ID entidad", "Detalle técnico", "IP"],
      ...events.map((event) => [
        event.id,
        event.created_at,
        event.staff_name,
        event.staff_email,
        auditLabel(auditActionLabels, event.action),
        auditLabel(auditEntityLabels, event.entity_type),
        event.entity_id,
        event.metadata,
        event.ip_address,
      ]),
    ]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"auditoria.csv\"");
    res.send(csv);
  });

  app.get("/api/import/templates", (_req, res) => {
    res.json({
      templates: importTemplates.map(({ id, label, description, columns }) => ({ id, label, description, columns })),
    });
  });

  app.get("/api/import/templates/:id.csv", (req, res) => {
    const template = importTemplates.find((item) => item.id === req.params.id);
    if (!template) return res.status(404).json({ error: "Plantilla no encontrada" });

    const csv = toCsv([template.columns, ...template.rows]);
    recordAuditEvent(req, {
      action: "import_template.downloaded",
      entityType: "import_template",
      entityId: template.id,
      metadata: { label: template.label },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${template.id}.csv"`);
    res.send(csv);
  });

  app.get("/api/backups/database", (_req, res) => {
    const backupRoot = getBackupRoot();
    mkdirSync(backupRoot, { recursive: true });
    const backups = readdirSync(backupRoot)
      .filter(isBackupFileName)
      .map((fileName) => {
        const stats = statSync(path.join(backupRoot, fileName));
        return {
          fileName,
          path: path.join(backupRoot, fileName),
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);

    res.json({ backups });
  });

  app.get("/api/backups/database/:fileName", (req, res, next) => {
    try {
      const backupPath = getBackupPath(req.params.fileName);
      statSync(backupPath);
      res.download(backupPath, req.params.fileName);
    } catch (error) {
      if (error instanceof Error && error.message.includes("respaldo inv")) {
        return res.status(400).json({ error: error.message });
      }
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return res.status(404).json({ error: "Respaldo no encontrado" });
      }
      next(error);
    }
  });

  app.post("/api/backups/database", async (req, res, next) => {
    try {
      const backupRoot = getBackupRoot();
      mkdirSync(backupRoot, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `parkia-${timestamp}.sqlite`;
      const backupPath = path.join(backupRoot, filename);
      await db.backup(backupPath);
      const stats = statSync(backupPath);

      recordAuditEvent(req, {
        action: "database.backup_created",
        entityType: "database_backup",
        entityId: filename,
        metadata: {
          path: backupPath,
          sizeBytes: stats.size,
        },
      });

      res.json({
        success: true,
        backup: {
          fileName: filename,
          path: backupPath,
          sizeBytes: stats.size,
          createdAt: stats.birthtime.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });
}
