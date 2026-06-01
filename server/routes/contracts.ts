import type { Express } from "express";
import { z } from "zod";
import { recordAuditEvent } from "../audit";
import { requireAnyRole } from "../auth/sessions";
import { cancelContractReceivablesAfter, generateContractReceivables, reconcileContractFutureReceivables } from "../billing";
import { db } from "../db";
import { likeValue, paginatedResponse, parsePagination, queryText } from "../pagination";
import { createContractPdfBuffer } from "../pdf";
import { storeDocumentBuffer } from "../storage";
import { dateStringSchema, optionalTextSchema, parseBody } from "../validation";

const renewContractSchema = z.object({
  new_end_date: dateStringSchema,
});

const contractStatusActionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  effective_date: dateStringSchema.optional(),
});

const createContractSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  space_id: z.coerce.number().int().positive(),
  start_date: dateStringSchema,
  end_date: optionalTextSchema,
  monthly_fee: z.coerce.number().positive(),
  billing_day: z.coerce.number().int().min(1).max(31).default(5),
  deposit_amount: z.coerce.number().min(0).default(0),
  billing_document_type: z.enum(["boleta", "factura_exenta", "factura_afecta"]).default("boleta"),
  notes: optionalTextSchema,
});

const nullableDateStringSchema = z.preprocess(
  value => value === "" ? null : value,
  dateStringSchema.nullable().optional()
);

const updateContractSchema = z.object({
  start_date: dateStringSchema.optional(),
  end_date: nullableDateStringSchema,
  monthly_fee: z.coerce.number().positive().optional(),
  billing_day: z.coerce.number().int().min(1).max(31).optional(),
  deposit_amount: z.coerce.number().min(0).optional(),
  billing_document_type: z.enum(["boleta", "factura_exenta", "factura_afecta"]).optional(),
  notes: optionalTextSchema,
  reason: z.string().trim().min(3).max(500),
});

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function parseBranchIdQuery(value: unknown) {
  const branchId = Number(value);
  return Number.isInteger(branchId) && branchId > 0 ? branchId : null;
}

function getPrintableContract(contractId: string) {
  return db.prepare(`
    SELECT c.*,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.email as client_email,
           cl.phone as client_phone,
           s.name as space_name,
           s.type as space_type
    FROM contracts c
    JOIN clients cl ON c.client_id = cl.id
    JOIN spaces s ON c.space_id = s.id
    WHERE c.id = ?
  `).get(contractId) as any;
}

export function registerContractsRoutes(app: Express) {
  app.use("/api/contracts", requireAnyRole(["admin", "finance"]));

  app.post("/api/contracts/:id/renew", (req, res) => {
    const body = parseBody(renewContractSchema, req.body, res);
    if (!body) return;

    const { new_end_date } = body;
    const contract = db.prepare("SELECT id, status, end_date FROM contracts WHERE id = ?").get(req.params.id) as { id: number, status: string, end_date: string | null } | undefined;
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });
    if (contract.status !== "active") return res.status(400).json({ error: "Solo se pueden renovar contratos activos" });
    if (contract.end_date && new_end_date <= contract.end_date) {
      return res.status(400).json({ error: "La nueva fecha debe ser posterior al vencimiento actual" });
    }

    const transaction = db.transaction(() => {
      db.prepare("UPDATE contracts SET end_date = ? WHERE id = ?").run(new_end_date, req.params.id);
      return reconcileContractFutureReceivables(contract.id);
    });
    const receivables = transaction();

    recordAuditEvent(req, {
      action: "contract.renewed",
      entityType: "contract",
      entityId: req.params.id,
      metadata: { previous_end_date: contract.end_date, new_end_date, receivables },
    });
    res.json({ success: true, receivables });
  });

  app.post("/api/contracts/:id/suspend", (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    const contract = db.prepare("SELECT id, status FROM contracts WHERE id = ?").get(req.params.id) as { id: number, status: string } | undefined;
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });
    if (contract.status === "terminated") return res.status(400).json({ error: "No se puede suspender un contrato terminado" });
    if (contract.status === "suspended") return res.status(400).json({ error: "El contrato ya está suspendido" });

    db.prepare("UPDATE contracts SET status = 'suspended' WHERE id = ?").run(req.params.id);
    recordAuditEvent(req, {
      action: "contract.suspended",
      entityType: "contract",
      entityId: req.params.id,
      metadata: { reason: body.reason, effective_date: body.effective_date || null },
    });
    res.json({ success: true });
  });

  app.post("/api/contracts/:id/reactivate", (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    const contract = db.prepare("SELECT id, status FROM contracts WHERE id = ?").get(req.params.id) as { id: number, status: string } | undefined;
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });
    if (contract.status === "terminated") return res.status(400).json({ error: "No se puede reactivar un contrato terminado" });
    if (contract.status === "active") return res.status(400).json({ error: "El contrato ya está activo" });

    db.prepare("UPDATE contracts SET status = 'active' WHERE id = ?").run(req.params.id);
    recordAuditEvent(req, {
      action: "contract.reactivated",
      entityType: "contract",
      entityId: req.params.id,
      metadata: { reason: body.reason, effective_date: body.effective_date || null },
    });
    res.json({ success: true });
  });

  app.post("/api/contracts/:id/terminate", (req, res) => {
    const body = parseBody(contractStatusActionSchema, req.body, res);
    if (!body) return;

    const contract = db.prepare("SELECT id, space_id, status FROM contracts WHERE id = ?").get(req.params.id) as { id: number, space_id: number, status: string } | undefined;
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });
    if (contract.status === "terminated") return res.status(400).json({ error: "El contrato ya está terminado" });

    const effectiveDate = body.effective_date || todayDateString();
    const transaction = db.transaction(() => {
      db.prepare("UPDATE contracts SET status = 'terminated', end_date = ? WHERE id = ?").run(effectiveDate, req.params.id);
      db.prepare("UPDATE spaces SET status = 'available' WHERE id = ?").run(contract.space_id);
      return cancelContractReceivablesAfter(contract.id, effectiveDate);
    });
    try {
      const receivables = transaction();

      recordAuditEvent(req, {
        action: "contract.terminated",
        entityType: "contract",
        entityId: req.params.id,
        metadata: { reason: body.reason, effective_date: effectiveDate, space_id: contract.space_id, receivables },
      });
      res.json({ success: true, receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo terminar el contrato" });
    }
  });

  app.get("/api/contracts", (req, res) => {
    const pagination = parsePagination(req.query as Record<string, unknown>);
    const search = queryText(req.query.search);
    const status = queryText(req.query.status);
    const expiring = req.query.expiring === "true";
    const branchId = parseBranchIdQuery(req.query.branch_id);
    const params: any[] = [];
    let where = "WHERE 1=1";
    if (branchId) {
      where += " AND c.branch_id = ?";
      params.push(branchId);
    }
    if (status && status !== "all") {
      where += " AND c.status = ?";
      params.push(status);
    }
    if (expiring) {
      where += " AND c.status = 'active' AND c.end_date IS NOT NULL AND date(c.end_date) BETWEEN date('now') AND date('now', '+30 days')";
    }
    if (search) {
      const like = likeValue(search);
      where += `
        AND (
          cl.name LIKE ? OR cl.rut LIKE ? OR s.name LIKE ? OR CAST(c.id AS TEXT) LIKE ?
          OR EXISTS (SELECT 1 FROM vehicles v WHERE v.client_id = c.client_id AND COALESCE(v.status, 'active') = 'active' AND v.plate LIKE ?)
        )
      `;
      params.push(like, like, like, like, like);
    }

    const fromSql = `
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      JOIN spaces s ON c.space_id = s.id
      LEFT JOIN branches b ON b.id = c.branch_id
      ${where}
    `;
    const total = Number((db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...params) as { count: number }).count || 0);
    let listQuery = `
      SELECT c.*, cl.name as client_name, s.name as space_name, b.name as branch_name, b.code as branch_code,
      (SELECT plate FROM vehicles WHERE client_id = c.client_id AND COALESCE(status, 'active') = 'active' ORDER BY id LIMIT 1) as plate,
      (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates
      ${fromSql}
      ORDER BY c.start_date DESC
    `;
    const listParams = [...params];
    if (pagination.requested) {
      listQuery += " LIMIT ? OFFSET ?";
      listParams.push(pagination.pageSize, pagination.offset);
    }
    const contracts = db.prepare(listQuery).all(...listParams);
    res.json(pagination.requested ? paginatedResponse(contracts, total, pagination) : contracts);
  });

  app.get("/api/contracts/:id/detail", (req, res) => {
    const contract = db.prepare(`
      SELECT c.*,
        cl.name as client_name,
        cl.rut as client_rut,
        cl.email as client_email,
        cl.phone as client_phone,
        cl.type as client_type,
        cl.address as client_address,
        cl.business_activity as client_business_activity,
        cl.billing_contact_name,
        cl.billing_contact_email,
        cl.billing_contact_phone,
        s.name as space_name,
        s.type as space_type,
        s.price as space_price,
        b.name as branch_name,
        b.code as branch_code,
        (SELECT GROUP_CONCAT(plate) FROM vehicles WHERE client_id = c.client_id AND COALESCE(status, 'active') = 'active' ORDER BY id) as plates
      FROM contracts c
      JOIN clients cl ON c.client_id = cl.id
      JOIN spaces s ON c.space_id = s.id
      LEFT JOIN branches b ON b.id = c.branch_id
      WHERE c.id = ?
    `).get(req.params.id);
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });

    const payments = db.prepare(`
      SELECT p.*,
        COALESCE(alloc.allocated_amount, 0) as allocated_amount,
        CASE WHEN p.status IN ('pending', 'overdue')
          THEN MAX(p.amount - COALESCE(alloc.allocated_amount, 0), 0)
          ELSE 0
        END as remaining_amount
      FROM payments p
      LEFT JOIN (
        SELECT payment_id, SUM(amount) as allocated_amount
        FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY payment_id
      ) alloc ON alloc.payment_id = p.id
      WHERE p.contract_id = ?
      ORDER BY date(p.due_date) DESC, p.id DESC
    `).all(req.params.id);

    const documents = db.prepare(`
      SELECT id, entity_type, entity_id, label, document_type, status, expires_at, notes,
             file_name, mime_type, size_bytes, created_at
      FROM documents
      WHERE entity_type = 'contract' AND entity_id = ?
      ORDER BY created_at DESC
    `).all(req.params.id);

    const audit = db.prepare(`
      SELECT a.*, s.name as staff_name, s.email as staff_email
      FROM audit_events a
      LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.entity_type = 'contract' AND a.entity_id = ?
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 20
    `).all(req.params.id);

    res.json({ contract, payments, documents, audit });
  });

  app.patch("/api/contracts/:id", (req, res) => {
    const body = parseBody(updateContractSchema, req.body, res);
    if (!body) return;

    const existing = db.prepare(`
      SELECT id, client_id, space_id, start_date, end_date, monthly_fee, billing_day,
             deposit_amount, billing_document_type, notes, status
      FROM contracts
      WHERE id = ?
    `).get(req.params.id) as any | undefined;
    if (!existing) return res.status(404).json({ error: "Contrato no encontrado" });
    if (existing.status === "terminated") return res.status(400).json({ error: "No se puede editar un contrato terminado" });

    const next = {
      start_date: body.start_date ?? existing.start_date,
      end_date: body.end_date === undefined ? existing.end_date : body.end_date,
      monthly_fee: body.monthly_fee ?? existing.monthly_fee,
      billing_day: body.billing_day ?? existing.billing_day,
      deposit_amount: body.deposit_amount ?? existing.deposit_amount,
      billing_document_type: body.billing_document_type ?? existing.billing_document_type,
      notes: body.notes === undefined ? existing.notes : body.notes,
    };

    if (next.end_date && next.start_date > next.end_date) {
      return res.status(400).json({ error: "La fecha de termino no puede ser anterior al inicio" });
    }

    const fields = [
      "start_date",
      "end_date",
      "monthly_fee",
      "billing_day",
      "deposit_amount",
      "billing_document_type",
      "notes",
    ] as const;
    const changes = fields.reduce<Record<string, { previous: unknown, next: unknown }>>((acc, field) => {
      if (next[field] !== existing[field]) acc[field] = { previous: existing[field], next: next[field] };
      return acc;
    }, {});

    if (Object.keys(changes).length === 0) return res.status(400).json({ error: "No hay cambios para guardar" });

    const financialFieldsChanged = ["start_date", "end_date", "monthly_fee", "billing_day"].some(field => field in changes);

    try {
      const transaction = db.transaction(() => {
        db.prepare(`
          UPDATE contracts
          SET start_date = ?,
              end_date = ?,
              monthly_fee = ?,
              billing_day = ?,
              deposit_amount = ?,
              billing_document_type = ?,
              notes = ?
          WHERE id = ?
        `).run(
          next.start_date,
          next.end_date,
          next.monthly_fee,
          next.billing_day,
          next.deposit_amount,
          next.billing_document_type,
          next.notes,
          existing.id
        );

        return financialFieldsChanged ? reconcileContractFutureReceivables(existing.id) : null;
      });

      const receivables = transaction();
      recordAuditEvent(req, {
        action: "contract.updated",
        entityType: "contract",
        entityId: req.params.id,
        metadata: { reason: body.reason, changes, receivables },
      });
      res.json({ success: true, changes, receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo actualizar el contrato" });
    }
  });

  app.get("/api/contracts/:id/print", (req, res) => {
    const contract = getPrintableContract(req.params.id);

    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });

    recordAuditEvent(req, {
      action: "contract.printed",
      entityType: "contract",
      entityId: req.params.id,
      metadata: { client_id: contract.client_id, space_id: contract.space_id },
    });

    res.type("html").send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>Contrato CON-2026-${String(contract.id).padStart(3, "0")}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #0f172a; margin: 40px; line-height: 1.5; }
    header { border-bottom: 2px solid #0f172a; padding-bottom: 18px; margin-bottom: 28px; }
    h1 { font-size: 24px; margin: 0; }
    h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    td:first-child { width: 220px; color: #64748b; font-weight: bold; }
    .muted { color: #64748b; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 72px; }
    .signature { border-top: 1px solid #0f172a; text-align: center; padding-top: 10px; font-size: 13px; }
    @media print { body { margin: 24mm; } button { display: none; } }
  </style>
</head>
<body>
  <header>
    <h1>Contrato de Arriendo CON-2026-${String(contract.id).padStart(3, "0")}</h1>
    <p class="muted">Parkia - Documento generado para revision y firma</p>
  </header>

  <h2>Cliente</h2>
  <table>
    <tr><td>Nombre / Razón Social</td><td>${escapeHtml(contract.client_name)}</td></tr>
    <tr><td>RUT</td><td>${escapeHtml(contract.client_rut)}</td></tr>
    <tr><td>Correo</td><td>${escapeHtml(contract.client_email || "No informado")}</td></tr>
    <tr><td>Teléfono</td><td>${escapeHtml(contract.client_phone || "No informado")}</td></tr>
  </table>

  <h2>Arriendo</h2>
  <table>
    <tr><td>Espacio</td><td>${escapeHtml(contract.space_name)} (Estacionamiento)</td></tr>
    <tr><td>Fecha de inicio</td><td>${escapeHtml(contract.start_date)}</td></tr>
    <tr><td>Fecha de término</td><td>${escapeHtml(contract.end_date || "Indefinido")}</td></tr>
    <tr><td>Tarifa mensual</td><td>${escapeHtml(formatCurrency(contract.monthly_fee))}</td></tr>
    <tr><td>Día de cobro</td><td>${escapeHtml(contract.billing_day)}</td></tr>
    <tr><td>Garantía / Depósito</td><td>${escapeHtml(formatCurrency(contract.deposit_amount || 0))}</td></tr>
    <tr><td>Documento de cobro</td><td>${escapeHtml(contract.billing_document_type)}</td></tr>
    <tr><td>Estado</td><td>${escapeHtml(contract.status)}</td></tr>
  </table>

  <h2>Condiciones</h2>
  <p>El cliente declara recibir el espacio individualizado y se obliga al pago mensual indicado, ademas de cumplir las normas operacionales y administrativas establecidas por Parkia.</p>
  <p>${escapeHtml(contract.notes || "Sin notas internas registradas.")}</p>

  <div class="signatures">
    <div class="signature">Arrendador</div>
    <div class="signature">Cliente</div>
  </div>
</body>
</html>`);
  });

  app.get("/api/contracts/:id/pdf", (req, res) => {
    const contract = getPrintableContract(req.params.id);
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });

    const pdfBuffer = createContractPdfBuffer(contract);
    recordAuditEvent(req, {
      action: "contract.pdf.downloaded",
      entityType: "contract",
      entityId: req.params.id,
      metadata: { client_id: contract.client_id, space_id: contract.space_id },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="CON-2026-${String(contract.id).padStart(3, "0")}.pdf"`);
    res.send(pdfBuffer);
  });

  app.post("/api/contracts/:id/generate-pdf", (req, res) => {
    const contract = getPrintableContract(req.params.id);
    if (!contract) return res.status(404).json({ error: "Contrato no encontrado" });

    try {
      const pdfBuffer = createContractPdfBuffer(contract);
      const fileName = `CON-2026-${String(contract.id).padStart(3, "0")}.pdf`;
      const stored = storeDocumentBuffer({
        fileName,
        mimeType: "application/pdf",
        buffer: pdfBuffer,
        folder: "contract-documents",
      });

      const result = db.prepare(`
        INSERT INTO documents (
          entity_type, entity_id, label, document_type, status, notes,
          file_path, file_name, mime_type, size_bytes
        )
        VALUES ('contract', ?, ?, 'contract', 'received', ?, ?, ?, ?, ?)
      `).run(
        contract.id,
        `Contrato generado ${String(contract.id).padStart(3, "0")}`,
        "PDF generado automáticamente desde el sistema",
        stored.filePath,
        stored.fileName,
        stored.mimeType,
        stored.sizeBytes
      );

      recordAuditEvent(req, {
        action: "contract.pdf.generated",
        entityType: "contract",
        entityId: req.params.id,
        metadata: { document_id: result.lastInsertRowid, file_name: stored.fileName },
      });

      res.json({ success: true, id: result.lastInsertRowid });
    } catch (e: any) {
      res.status(400).json({ error: e.message || "No se pudo generar el PDF" });
    }
  });

  app.post("/api/contracts", (req, res) => {
    const body = parseBody(createContractSchema, req.body, res);
    if (!body) return;

    const {
      client_id,
      space_id,
      start_date,
      end_date,
      monthly_fee,
      billing_day,
      deposit_amount,
      billing_document_type,
      notes,
    } = body;

    const transaction = db.transaction(() => {
      const client = db.prepare("SELECT id, status FROM clients WHERE id = ?").get(client_id) as { id: number, status: string | null } | undefined;
      if (!client) throw new Error("Cliente no encontrado");
      if (client.status === "archived") throw new Error("No se puede crear un contrato para un cliente archivado");

      const space = db.prepare("SELECT id, status, branch_id FROM spaces WHERE id = ?").get(space_id) as { id: number, status: string, branch_id: number | null } | undefined;
      if (!space) throw new Error("Espacio no encontrado");
      if (space.status !== "available") throw new Error("El espacio no está disponible");

      const activeContract = db.prepare("SELECT id FROM contracts WHERE space_id = ? AND status = 'active'").get(space_id);
      if (activeContract) throw new Error("El espacio ya tiene un contrato activo");

      const result = db.prepare(`
        INSERT INTO contracts (
          client_id,
          space_id,
          start_date,
          end_date,
          monthly_fee,
          billing_day,
          deposit_amount,
          billing_document_type,
          notes,
          branch_id
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(client_id, space_id, start_date, end_date, monthly_fee, billing_day, deposit_amount, billing_document_type, notes, space.branch_id || null);

      db.prepare("UPDATE spaces SET status = 'occupied' WHERE id = ?").run(space_id);

      const contractId = Number(result.lastInsertRowid);
      const receivables = generateContractReceivables(contractId);

      return { id: contractId, branch_id: space.branch_id || null, receivables };
    });

    try {
      const result = transaction();
      recordAuditEvent(req, {
        action: "contract.created",
        entityType: "contract",
        entityId: result.id,
        metadata: { client_id, space_id, branch_id: result.branch_id, monthly_fee, billing_day, deposit_amount, billing_document_type, receivables: result.receivables },
      });
      recordAuditEvent(req, {
        action: "contract.receivables.generated",
        entityType: "contract",
        entityId: result.id,
        metadata: result.receivables,
      });
      res.json({ success: true, id: result.id, receivables: result.receivables });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });
}
