import { existsSync, rmSync } from "fs";
import path from "path";
import { hashPassword } from "../auth/password";
import { getStorageRoot, storeDocumentBuffer } from "../storage";

const DEMO_TAG = "[DEMO-DEEP]";
const DEMO_FOLDER = "demo-deep";

type DemoIds = {
  adminId: number;
  financeId: number;
  guardId: number;
  clients: Record<string, number>;
  spaces: Record<string, number>;
  contracts: Record<string, number>;
  payments: Record<string, number>;
  bankMovements: Record<string, number>;
  tasks: Record<string, number>;
  shifts: Record<string, number>;
};

function getId(db: any, sql: string, ...params: any[]) {
  const row = db.prepare(sql).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`No se pudo resolver ID demo: ${sql}`);
  return row.id;
}

function insert(db: any, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params).lastInsertRowid as number;
}

function demoPdf(label: string) {
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 140] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 72 >>
stream
BT /F1 12 Tf 24 96 Td (${label.replace(/[()\\]/g, "")}) Tj 0 -20 Td (${DEMO_TAG}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000264 00000 n 
0000000387 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
457
%%EOF`;
  return Buffer.from(content, "utf8");
}

function storeDemoDocument(label: string, fileName: string) {
  return storeDocumentBuffer({
    fileName,
    mimeType: "application/pdf",
    buffer: demoPdf(label),
    folder: DEMO_FOLDER,
  });
}

function removeDemoFiles() {
  const storageRoot = path.resolve(getStorageRoot());
  const demoDir = path.resolve(storageRoot, DEMO_FOLDER);
  if (!demoDir.startsWith(`${storageRoot}${path.sep}`)) throw new Error("Ruta demo inválida");
  if (existsSync(demoDir)) rmSync(demoDir, { recursive: true, force: true });
}

export function purgeDeepDemoData(db: any) {
  const run = db.transaction(() => {
    const demoClientIds = db.prepare("SELECT id FROM clients WHERE notes LIKE ?").all(`%${DEMO_TAG}%`).map((row: any) => row.id);
    const demoSpaceIds = db.prepare("SELECT id FROM spaces WHERE notes LIKE ?").all(`%${DEMO_TAG}%`).map((row: any) => row.id);
    const demoContractIds = db.prepare("SELECT id FROM contracts WHERE notes LIKE ?").all(`%${DEMO_TAG}%`).map((row: any) => row.id);
    const demoPaymentIds = db.prepare(`
      SELECT id FROM payments
      WHERE reference LIKE 'DEMO-%'
         OR contract_id IN (SELECT id FROM contracts WHERE notes LIKE ?)
    `).all(`%${DEMO_TAG}%`).map((row: any) => row.id);
    const demoBankIds = db.prepare("SELECT id FROM bank_movements WHERE description LIKE '[DEMO]%'").all().map((row: any) => row.id);
    const demoTaskIds = db.prepare(`
      SELECT id FROM operational_tasks
      WHERE source_type = 'demo_deep' OR description LIKE ? OR title LIKE '[DEMO]%'
    `).all(`%${DEMO_TAG}%`).map((row: any) => row.id);
    const demoShiftIds = db.prepare("SELECT id FROM guard_shift_logs WHERE opening_notes LIKE ?").all(`%${DEMO_TAG}%`).map((row: any) => row.id);

    db.prepare("DELETE FROM task_attachments WHERE file_path LIKE ?").run(`${DEMO_FOLDER}/%`);
    if (demoTaskIds.length) {
      const placeholders = demoTaskIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM task_comments WHERE task_id IN (${placeholders})`).run(...demoTaskIds);
    }

    db.prepare("DELETE FROM shift_log_entry_attachments WHERE file_path LIKE ?").run(`${DEMO_FOLDER}/%`);
    if (demoShiftIds.length) {
      const placeholders = demoShiftIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM guard_shift_log_entries WHERE shift_log_id IN (${placeholders})`).run(...demoShiftIds);
    }
    if (demoTaskIds.length) {
      const placeholders = demoTaskIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM guard_shift_log_entries WHERE task_id IN (${placeholders})`).run(...demoTaskIds);
      db.prepare(`DELETE FROM operational_tasks WHERE id IN (${placeholders})`).run(...demoTaskIds);
    }

    db.prepare("DELETE FROM staff_access_events WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE '%.demo@parkia.local')").run();
    db.prepare("DELETE FROM audit_events WHERE action LIKE 'demo.%' OR metadata LIKE ?").run(`%${DEMO_TAG}%`);
    db.prepare("DELETE FROM monthly_finance_closures WHERE accepted_pending_note LIKE ? OR monthly_snapshot_json LIKE ?").run(`%${DEMO_TAG}%`, `%${DEMO_TAG}%`);

    if (demoPaymentIds.length) {
      const placeholders = demoPaymentIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM payment_adjustments WHERE payment_id IN (${placeholders})`).run(...demoPaymentIds);
      db.prepare(`DELETE FROM collection_actions WHERE payment_id IN (${placeholders})`).run(...demoPaymentIds);
    }
    if (demoPaymentIds.length || demoBankIds.length) {
      const paymentClause = demoPaymentIds.length ? `payment_id IN (${demoPaymentIds.map(() => "?").join(",")})` : "0";
      const bankClause = demoBankIds.length ? `bank_movement_id IN (${demoBankIds.map(() => "?").join(",")})` : "0";
      db.prepare(`DELETE FROM payment_allocations WHERE ${paymentClause} OR ${bankClause}`).run(...demoPaymentIds, ...demoBankIds);
    }

    db.prepare("DELETE FROM documents WHERE file_path LIKE ? OR notes LIKE ?").run(`${DEMO_FOLDER}/%`, `%${DEMO_TAG}%`);
    if (demoPaymentIds.length) {
      const placeholders = demoPaymentIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM invoices WHERE payment_id IN (${placeholders}) OR folio >= 900000`).run(...demoPaymentIds);
      db.prepare(`DELETE FROM payments WHERE id IN (${placeholders})`).run(...demoPaymentIds);
    } else {
      db.prepare("DELETE FROM invoices WHERE folio >= 900000").run();
    }

    db.prepare("DELETE FROM expenses WHERE notes LIKE ? OR document_number LIKE 'DEMO-%'").run(`%${DEMO_TAG}%`);
    if (demoBankIds.length) {
      const placeholders = demoBankIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM bank_movements WHERE id IN (${placeholders})`).run(...demoBankIds);
    }
    db.prepare("DELETE FROM financial_budgets WHERE notes LIKE ?").run(`%${DEMO_TAG}%`);

    db.prepare("DELETE FROM access_logs WHERE reason LIKE ? OR authorized_by LIKE 'Demo %'").run(`%${DEMO_TAG}%`);
    db.prepare("DELETE FROM visitor_tickets WHERE plate LIKE 'DEMO%' OR plate IN ('QA-1001', 'PR-2040', 'MT-8822')").run();
    db.prepare("DELETE FROM visitor_passes WHERE qr_token LIKE 'demo-deep-%'").run();
    db.prepare("DELETE FROM space_status_history WHERE source = 'demo_deep' OR reason LIKE ?").run(`%${DEMO_TAG}%`);
    if (demoShiftIds.length) {
      const placeholders = demoShiftIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM guard_shift_logs WHERE id IN (${placeholders})`).run(...demoShiftIds);
    }

    if (demoContractIds.length) {
      const placeholders = demoContractIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM contracts WHERE id IN (${placeholders})`).run(...demoContractIds);
    }
    db.prepare("DELETE FROM vehicles WHERE notes LIKE ? OR plate IN ('DEMO-10', 'DEMO-20', 'DEMO-30', 'QA-1001', 'PR-2040', 'MT-8822')").run(`%${DEMO_TAG}%`);
    if (demoSpaceIds.length) {
      const placeholders = demoSpaceIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM spaces WHERE id IN (${placeholders})`).run(...demoSpaceIds);
    }
    if (demoClientIds.length) {
      const placeholders = demoClientIds.map(() => "?").join(",");
      db.prepare(`DELETE FROM clients WHERE id IN (${placeholders})`).run(...demoClientIds);
    }
    db.prepare("DELETE FROM staff WHERE email LIKE '%.demo@parkia.local'").run();
  });

  run();
  removeDemoFiles();
}

function seedStaff(db: any) {
  const password = hashPassword("Cambiar123!");
  const staff = [
    ["Gloria Núñez", "44.444.444-4", "guard.demo@parkia.local", "+56944112233", "guard"],
    ["Paula Rojas", "55.555.555-5", "finance.demo@parkia.local", "+56955223344", "finance"],
    ["Emilio Salas", "66.666.666-6", "admin.demo@parkia.local", "+56966334455", "admin"],
  ];

  for (const item of staff) {
    db.prepare(`
      INSERT INTO staff (name, rut, email, phone, role, status, password_hash, must_change_password, password_changed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, 0, datetime('now', '-20 day'), datetime('now'))
    `).run(...item, password);
  }
}

function seedClientsSpacesContracts(db: any, ids: DemoIds) {
  const clients = [
    ["Comercial Los Aromos SpA", "76.123.456-7", "contacto@losaromos.cl", "+56961234567", "company", "active", "Av. Matta 1440", "Santiago", "Santiago", "Venta de repuestos automotrices", "María Torres", "13.333.333-3", "Claudia Pizarro", "finanzas@losaromos.cl", "+56961234568", `${DEMO_TAG} Cliente empresa con dos estacionamientos y facturación al día.`],
    ["Rodrigo Fuentes", "15.555.555-5", "rodrigo.fuentes@example.cl", "+56975551234", "natural", "active", "Los Olmos 221", "Ñuñoa", "Santiago", "", "", "", "Rodrigo Fuentes", "rodrigo.fuentes@example.cl", "+56975551234", `${DEMO_TAG} Cliente natural con mora controlada.`],
    ["Constructora Norte Chico Ltda", "77.654.321-0", "operaciones@nortechico.cl", "+56987654321", "company", "active", "Camino Industrial 8080", "Quilicura", "Santiago", "Construcción y montaje", "Sergio Leiva", "14.444.444-4", "Daniela Mora", "pagos@nortechico.cl", "+56987654322", `${DEMO_TAG} Cliente empresa con estacionamiento y visitas recurrentes de proveedores.`],
    ["Carolina Reyes", "16.666.666-6", "carolina.reyes@example.cl", "+56973337777", "natural", "archived", "Pasaje Las Dalias 78", "La Florida", "Santiago", "", "", "", "Carolina Reyes", "carolina.reyes@example.cl", "+56973337777", `${DEMO_TAG} Cliente archivado con contrato terminado para validar historial.`],
  ];
  for (const client of clients) {
    db.prepare(`
      INSERT INTO clients (
        name, rut, email, phone, type, status, address, commune, city, business_activity,
        legal_representative_name, legal_representative_rut, billing_contact_name,
        billing_contact_email, billing_contact_phone, notes, financial_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'up-to-date')
    `).run(...client);
  }
  for (const rut of ["76.123.456-7", "15.555.555-5", "77.654.321-0", "16.666.666-6"]) {
    ids.clients[rut] = getId(db, "SELECT id FROM clients WHERE rut = ?", rut);
  }

  const spaces = [
    ["Estacionamiento Demo A10", "parking", "occupied", 62000, "Nivel -1", "Ala norte", 2.5, 5, 2.1, "CCTV, portón automático", `${DEMO_TAG} Plaza techada con acceso por tótem principal.`],
    ["Estacionamiento Demo A11", "parking", "occupied", 62000, "Nivel -1", "Ala norte", 2.5, 5, 2.1, "CCTV, cercano a ascensor", `${DEMO_TAG} Plaza asignada a cliente natural con mora.`],
    ["Estacionamiento Demo B05", "parking", "available", 58000, "Nivel 0", "Patio central", 2.4, 4.8, 2.4, "Exterior, iluminación nocturna", `${DEMO_TAG} Disponible para simulación comercial.`],
    ["Estacionamiento Demo C12", "parking", "occupied", 145000, "Nivel 1", "Sector estacionamientos", 3.2, 4.5, 2.6, "Rack metálico, sensor humo", `${DEMO_TAG} Estacionamiento empresa con seguimiento documental.`],
    ["Estacionamiento Demo C13", "parking", "maintenance", 135000, "Nivel 1", "Sector estacionamientos", 3, 4, 2.5, "Requiere reparación chapa", `${DEMO_TAG} En mantención por incidente de turno.`],
    ["Estacionamiento Demo D02", "parking", "occupied", 55000, "Nivel 0", "Patio sur", 2.4, 4.6, 2.3, "Exterior", `${DEMO_TAG} Contrato que será terminado para historial.`],
  ];
  for (const space of spaces) {
    db.prepare(`
      INSERT INTO spaces (name, type, status, price, location, level, width_m, length_m, height_m, features, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '-1 day'))
    `).run(...space);
  }
  for (const name of spaces.map((space) => space[0])) {
    ids.spaces[String(name)] = getId(db, "SELECT id FROM spaces WHERE name = ?", name);
  }

  const vehicles = [
    [ids.clients["76.123.456-7"], "DEMO-10", "Hyundai", "Tucson", "Blanco", `${DEMO_TAG} Vehículo principal autorizado.`],
    [ids.clients["76.123.456-7"], "QA-1001", "Toyota", "Hilux", "Gris", `${DEMO_TAG} Camioneta de operaciones.`],
    [ids.clients["15.555.555-5"], "DEMO-20", "Mazda", "CX-5", "Azul", `${DEMO_TAG} Vehículo cliente natural.`],
    [ids.clients["77.654.321-0"], "PR-2040", "Peugeot", "Partner", "Blanco", `${DEMO_TAG} Proveedor frecuente.`],
    [ids.clients["16.666.666-6"], "DEMO-30", "Kia", "Morning", "Rojo", `${DEMO_TAG} Vehículo de contrato terminado.`],
  ];
  for (const vehicle of vehicles) {
    db.prepare("INSERT INTO vehicles (client_id, plate, brand, model, color, notes) VALUES (?, ?, ?, ?, ?, ?)").run(...vehicle);
  }

  const contracts = [
    ["aromos-parking", ids.clients["76.123.456-7"], ids.spaces["Estacionamiento Demo A10"], "2025-10-01", null, 62000, 5, 62000, "factura_afecta", "active", `${DEMO_TAG} Contrato empresa, pago automático por transferencia.`],
    ["fuentes-parking", ids.clients["15.555.555-5"], ids.spaces["Estacionamiento Demo A11"], "2025-11-15", null, 62000, 10, 62000, "boleta", "active", `${DEMO_TAG} Contrato con mora y acciones de cobranza.`],
    ["norte-estacionamiento", ids.clients["77.654.321-0"], ids.spaces["Estacionamiento Demo C12"], "2025-08-01", null, 145000, 1, 145000, "factura_exenta", "active", `${DEMO_TAG} Estacionamiento con revisión documental pendiente.`],
    ["reyes-terminated", ids.clients["16.666.666-6"], ids.spaces["Estacionamiento Demo D02"], "2025-03-01", "2026-03-31", 55000, 5, 55000, "boleta", "terminated", `${DEMO_TAG} Contrato terminado para validar historial y auditoría.`],
  ];
  for (const contract of contracts) {
    const [key, ...values] = contract;
    const id = insert(db, `
      INSERT INTO contracts (
        client_id, space_id, start_date, end_date, monthly_fee, billing_day, deposit_amount,
        billing_document_type, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...values);
    ids.contracts[String(key)] = id;
  }
}

function seedFinance(db: any, ids: DemoIds) {
  const payments = [
    ["aromos-apr", ids.contracts["aromos-parking"], 62000, "2026-04-05", "paid", "2026-04-04 10:12:00", "transfer", "DEMO-PAGO-AROMOS-ABR"],
    ["aromos-may", ids.contracts["aromos-parking"], 62000, "2026-05-05", "pending", null, null, "DEMO-PAGO-AROMOS-MAY"],
    ["fuentes-apr", ids.contracts["fuentes-parking"], 62000, "2026-04-10", "overdue", null, null, "DEMO-PAGO-FUENTES-ABR"],
    ["fuentes-may", ids.contracts["fuentes-parking"], 62000, "2026-05-10", "pending", null, null, "DEMO-PAGO-FUENTES-MAY"],
    ["norte-apr", ids.contracts["norte-estacionamiento"], 145000, "2026-04-01", "paid", "2026-04-02 12:30:00", "transfer", "DEMO-PAGO-NORTE-ABR"],
    ["norte-may", ids.contracts["norte-estacionamiento"], 145000, "2026-05-01", "pending", null, null, "DEMO-PAGO-NORTE-MAY"],
    ["reyes-mar", ids.contracts["reyes-terminated"], 55000, "2026-03-05", "paid", "2026-03-05 09:20:00", "card", "DEMO-PAGO-REYES-CIERRE"],
  ];
  for (const payment of payments) {
    const [key, ...values] = payment;
    ids.payments[String(key)] = insert(db, `
      INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method, reference)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, ...values);
  }

  const bankMovements = [
    ["aromos-transfer", "2026-04-04", "[DEMO] TRANSFERENCIA COMERCIAL LOS AROMOS", "76.123.456-7", 62000, "reconciled", "Conciliado contra arriendo abril."],
    ["norte-transfer", "2026-04-02", "[DEMO] TRANSFERENCIA CONSTRUCTORA NORTE CHICO", "77.654.321-0", 145000, "reconciled", "Conciliado contra estacionamiento abril."],
    ["fuentes-partial", "2026-05-12", "[DEMO] ABONO RODRIGO FUENTES", "15.555.555-5", 30000, "partial", "Abono parcial pendiente de completar."],
    ["unknown", "2026-05-14", "[DEMO] DEPOSITO SIN IDENTIFICAR", "99.999.999-9", 45000, "pending", "Revisar con administración."],
  ];
  for (const movement of bankMovements) {
    const [key, ...values] = movement;
    ids.bankMovements[String(key)] = insert(db, "INSERT INTO bank_movements (date, description, rut, amount, status, notes) VALUES (?, ?, ?, ?, ?, ?)", ...values);
  }

  db.prepare("INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, created_at) VALUES (?, ?, ?, ?, datetime('now', '-14 day'))")
    .run(ids.payments["aromos-apr"], ids.bankMovements["aromos-transfer"], 62000, `${DEMO_TAG} Conciliación automática exacta.`);
  db.prepare("INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, created_at) VALUES (?, ?, ?, ?, datetime('now', '-13 day'))")
    .run(ids.payments["norte-apr"], ids.bankMovements["norte-transfer"], 145000, `${DEMO_TAG} Conciliación automática exacta.`);
  db.prepare("INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, created_at) VALUES (?, ?, ?, ?, datetime('now', '-3 day'))")
    .run(ids.payments["fuentes-apr"], ids.bankMovements["fuentes-partial"], 30000, `${DEMO_TAG} Abono parcial informado por cliente.`);

  db.prepare("INSERT INTO collection_actions (payment_id, staff_id, channel, note, next_action_at, status, created_at) VALUES (?, ?, 'whatsapp', ?, '2026-05-20', 'open', datetime('now', '-2 day'))")
    .run(ids.payments["fuentes-apr"], ids.financeId, `${DEMO_TAG} Cliente indica que transferirá diferencia el viernes.`);
  db.prepare("INSERT INTO payment_adjustments (payment_id, staff_id, type, amount, previous_amount, new_amount, reason, created_at) VALUES (?, ?, 'fee', 2500, 62000, 64500, ?, datetime('now', '-1 day'))")
    .run(ids.payments["fuentes-apr"], ids.financeId, `${DEMO_TAG} Cargo administrativo por atraso documentado.`);

  db.prepare(`
    INSERT INTO invoices (folio, type, client_id, amount, status_sii, payment_id, contract_id, provider, provider_mode, external_id, status_detail, issued_at)
    VALUES (900001, 'factura_afecta', ?, 62000, 'accepted', ?, ?, 'local_mock', 'mock', 'DEMO-SII-900001', ?, '2026-04-04 10:15:00')
  `).run(ids.clients["76.123.456-7"], ids.payments["aromos-apr"], ids.contracts["aromos-parking"], `${DEMO_TAG} Documento aceptado en modo demo.`);
  db.prepare(`
    INSERT INTO invoices (folio, type, client_id, amount, status_sii, payment_id, contract_id, provider, provider_mode, external_id, status_detail, issued_at)
    VALUES (900002, 'factura_exenta', ?, 145000, 'pending', ?, ?, 'local_mock', 'mock', 'DEMO-SII-900002', ?, '2026-04-02 12:35:00')
  `).run(ids.clients["77.654.321-0"], ids.payments["norte-apr"], ids.contracts["norte-estacionamiento"], `${DEMO_TAG} Pendiente de sincronización demo.`);

  const expenses = [
    ["2026-04-08", "maintenance", "Cerrajería Rápida SpA", "76.789.111-2", "Cambio de chapa estacionamiento C13", 68000, 12920, 80920, "invoice", "DEMO-FA-101", "transfer", "paid", "2026-04-10", "2026-04-15", "maintenance", "approved", ids.adminId, "2026-04-09 15:00:00", `${DEMO_TAG} Gasto asociado a mantención correctiva.`],
    ["2026-05-03", "utilities", "Enel Distribución", "96.800.570-7", "Cuenta eléctrica abril", 118000, 22420, 140420, "invoice", "DEMO-ENEL-044", "automatic", "pending", null, "2026-05-20", "utilities", "pending", null, null, `${DEMO_TAG} Pago programado de servicios básicos.`],
    ["2026-05-12", "supplies", "Seguridad Total Ltda", "77.111.222-3", "Credenciales RFID y talonarios", 39000, 7410, 46410, "invoice", "DEMO-ST-778", "transfer", "overdue", null, "2026-05-16", "access", "pending", null, null, `${DEMO_TAG} Pendiente por validación de recepción.`],
  ];
  for (const expense of expenses) {
    db.prepare(`
      INSERT INTO expenses (
        date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
        document_type, document_number, payment_method, payment_status, paid_at, due_date, cost_center,
        approval_status, approved_by_staff_id, approved_at, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...expense);
  }

  const budgets = [
    ["2026-05", "maintenance", 180000, `${DEMO_TAG} Incluye mantención preventiva portones y chapa estacionamiento.`],
    ["2026-05", "utilities", 150000, `${DEMO_TAG} Electricidad, agua y monitoreo.`],
    ["2026-05", "admin", 95000, `${DEMO_TAG} Papelería, software y gestión administrativa.`],
  ];
  for (const budget of budgets) {
    db.prepare("INSERT INTO financial_budgets (month, category, planned_amount, notes) VALUES (?, ?, ?, ?)").run(...budget);
  }

  db.prepare(`
    INSERT INTO monthly_finance_closures (
      month, status, closed_by_staff_id, closed_at, accepted_pending_note,
      monthly_snapshot_json, operational_snapshot_json
    ) VALUES ('2026-04', 'closed', ?, '2026-05-01 18:30:00', ?, ?, ?)
  `).run(
    ids.financeId,
    `${DEMO_TAG} Cierre demo con una factura SII pendiente de sincronización.`,
    JSON.stringify({ tag: DEMO_TAG, income: 207000, expenses: 80920, pending: 62000 }),
    JSON.stringify({ tag: DEMO_TAG, occupiedSpaces: 4, incidents: 2, overduePayments: 1 }),
  );
}

function seedDocumentsTasks(db: any, ids: DemoIds) {
  const documents = [
    ["client", ids.clients["76.123.456-7"], "RUT empresa y representante", "identity", "approved", "2027-05-01", null, ids.financeId, null, "rut-los-aromos-demo.pdf"],
    ["contract", ids.contracts["norte-estacionamiento"], "Contrato firmado estacionamiento C12", "contract", "pending", null, `${DEMO_TAG} Falta segunda firma del representante.`, ids.financeId, "2026-05-21", "contrato-norte-demo.pdf"],
    ["payment", ids.payments["fuentes-apr"], "Comprobante abono parcial", "receipt", "rejected", null, `${DEMO_TAG} Imagen ilegible, solicitar respaldo bancario.`, ids.financeId, "2026-05-19", "abono-fuentes-demo.pdf"],
    ["client", ids.clients["15.555.555-5"], "Mandato PAC", "mandate", "expired", "2026-05-10", `${DEMO_TAG} Mandato vencido, pendiente renovación.`, ids.financeId, "2026-05-20", "mandato-fuentes-demo.pdf"],
  ];

  for (const doc of documents) {
    const [entityType, entityId, label, documentType, status, expiresAt, notes, assigneeId, nextActionAt, fileName] = doc;
    const stored = storeDemoDocument(String(label), String(fileName));
    db.prepare(`
      INSERT INTO documents (
        entity_type, entity_id, label, document_type, status, expires_at, notes,
        file_path, file_name, mime_type, size_bytes, assigned_staff_id, next_action_at,
        reviewed_by_staff_id, reviewed_at, rejection_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityType, entityId, label, documentType, status, expiresAt, notes,
      stored.filePath, stored.fileName, stored.mimeType, stored.sizeBytes, assigneeId, nextActionAt,
      status === "approved" ? ids.adminId : null,
      status === "approved" ? "2026-05-02 09:00:00" : null,
      status === "rejected" ? "No se distingue número de operación." : null,
    );
  }

  const tasks = [
    ["documentos-norte", "[DEMO] Regularizar contrato Norte Chico", `${DEMO_TAG} Contactar a Daniela Mora para firma pendiente del contrato C12.`, "documents", "high", "in_progress", ids.financeId, "demo_deep", "documentos-norte", "2026-05-21", ids.adminId],
    ["cobranza-fuentes", "[DEMO] Cobranza diferencia Rodrigo Fuentes", `${DEMO_TAG} Confirmar pago de saldo pendiente y actualizar acción de cobranza.`, "finance", "high", "open", ids.financeId, "demo_deep", "cobranza-fuentes", "2026-05-20", ids.financeId],
    ["mantencion-c13", "[DEMO] Revisar cierre de chapa estacionamiento C13", `${DEMO_TAG} Validar trabajo de cerrajería y cambiar estado de espacio si corresponde.`, "maintenance", "medium", "open", ids.guardId, "demo_deep", "mantencion-c13", "2026-05-19", ids.guardId],
    ["auditoria-acceso", "[DEMO] Auditar apertura manual nocturna", `${DEMO_TAG} Revisar bitácora y registro de cámara por apertura manual.`, "access", "critical", "done", ids.adminId, "demo_deep", "auditoria-acceso", "2026-05-15", ids.guardId],
  ];

  for (const task of tasks) {
    const [key, ...values] = task;
    const taskId = insert(db, `
      INSERT INTO operational_tasks (
        title, description, category, priority, status, assigned_staff_id, source_type, source_id,
        due_date, created_by_staff_id, completed_at, completed_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'done' THEN '2026-05-15 11:00:00' ELSE NULL END, CASE WHEN ? = 'done' THEN ? ELSE NULL END)
    `, ...values, values[4], values[4], `${DEMO_TAG} Revisado por administración.`);
    ids.tasks[String(key)] = taskId;

    db.prepare("INSERT INTO task_comments (task_id, staff_id, note, created_at) VALUES (?, ?, ?, datetime('now', '-1 day'))")
      .run(taskId, ids.adminId, `${DEMO_TAG} Comentario de seguimiento para validar trazabilidad.`);
  }

  const stored = storeDemoDocument("Adjunto tarea mantención C13", "tarea-mantencion-c13-demo.pdf");
  db.prepare("INSERT INTO task_attachments (task_id, staff_id, label, file_path, file_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(ids.tasks["mantencion-c13"], ids.guardId, "Foto cierre estacionamiento C13", stored.filePath, stored.fileName, stored.mimeType, stored.sizeBytes);
}

function seedAccessAndShifts(db: any, ids: DemoIds) {
  db.prepare(`
    INSERT INTO visitor_passes (
      name, rut, type, reason, associated_space_id, valid_from, valid_to, qr_token,
      status, plate, phone, company, authorized_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("Mauricio Vega", "17.777.777-7", "provider", "Retiro de materiales estacionamiento C12", ids.spaces["Estacionamiento Demo C12"], "2026-05-17 08:00:00", "2026-05-17 18:00:00", "demo-deep-provider-001", "completed", "PR-2040", "+56977778888", "Transportes Vega", "Gloria Núñez", "2026-05-16 17:20:00");
  db.prepare(`
    INSERT INTO visitor_passes (
      name, rut, type, reason, associated_space_id, valid_from, valid_to, qr_token,
      status, plate, phone, company, authorized_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("Andrea Soto", "18.888.888-8", "maintenance", "Reparación chapa C13", ids.spaces["Estacionamiento Demo C13"], "2026-05-18 09:00:00", "2026-05-18 13:00:00", "demo-deep-maint-001", "inside", "MT-8822", "+56988889999", "Cerrajería Rápida SpA", "Carlos Mendez", "2026-05-18 08:30:00");

  db.prepare("INSERT INTO visitor_tickets (plate, entry_time, exit_time, amount, status, payment_method, space_id) VALUES ('QA-1001', '2026-05-17 10:05:00', '2026-05-17 11:00:00', 0, 'completed', NULL, ?)")
    .run(ids.spaces["Estacionamiento Demo A10"]);
  db.prepare("INSERT INTO visitor_tickets (plate, entry_time, amount, status, space_id) VALUES ('DEMO99', '2026-05-18 08:45:00', 2500, 'active', ?)")
    .run(ids.spaces["Estacionamiento Demo B05"]);

  const logs = [
    [ids.clients["76.123.456-7"], null, ids.spaces["Estacionamiento Demo A10"], "entry", "authorized", "card", `${DEMO_TAG} Entrada cliente autorizado.`, "Demo tótem entrada", "DEMO-10", "2026-05-17 08:12:00"],
    [ids.clients["76.123.456-7"], null, ids.spaces["Estacionamiento Demo A10"], "exit", "authorized", "card", `${DEMO_TAG} Salida cliente autorizado.`, "Demo tótem salida", "DEMO-10", "2026-05-17 18:04:00"],
    [null, null, ids.spaces["Estacionamiento Demo C13"], "entry", "authorized", "qr", `${DEMO_TAG} Ingreso visita mantención.`, "Demo Gloria Núñez", "MT-8822", "2026-05-18 09:07:00"],
    [null, null, ids.spaces["Estacionamiento Demo B05"], "exit", "denied", "qr", `${DEMO_TAG} Ticket impago fuera de gracia.`, "Demo tótem salida", "DEMO99", "2026-05-18 11:15:00"],
    [null, null, ids.spaces["Estacionamiento Demo B05"], "exit", "authorized", "manual", `${DEMO_TAG} Apertura manual aprobada por administración.`, "Demo Carlos Mendez", "DEMO99", "2026-05-18 11:22:00"],
  ];
  const accessLogIds: number[] = [];
  for (const log of logs) {
    accessLogIds.push(insert(db, `
      INSERT INTO access_logs (client_id, visitor_id, space_id, access_type, status, method, reason, authorized_by, plate, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...log));
  }
  db.prepare("UPDATE access_logs SET resolved_by_access_log_id = ?, resolved_at = '2026-05-18 11:22:00', resolution_note = ? WHERE id = ?")
    .run(accessLogIds[4], `${DEMO_TAG} Guardia verificó pago en caja manual.`, accessLogIds[3]);

  db.prepare("INSERT INTO space_status_history (space_id, staff_id, previous_status, status, reason, source, created_at) VALUES (?, ?, 'occupied', 'maintenance', ?, 'demo_deep', '2026-05-17 20:10:00')")
    .run(ids.spaces["Estacionamiento Demo C13"], ids.guardId, `${DEMO_TAG} Chapa trabada reportada en turno noche.`);

  const shifts = [
    ["guard-night-17", ids.guardId, "2026-05-17", "night", `${DEMO_TAG} Turno noche iniciado con 4 visitas programadas.`, "Se entrega estacionamiento C13 en mantención y ticket DEMO99 pendiente de regularizar.", "Caja sin diferencias. Efectivo $32.500.", "closed", "2026-05-17 20:00:00", "2026-05-18 08:00:00"],
    ["guard-morning-18", ids.guardId, "2026-05-18", "morning", `${DEMO_TAG} Turno mañana con mantención C13 en curso.`, "Pendiente validar cierre de trabajo con administración.", "Caja inicial $20.000.", "open", "2026-05-18 08:00:00", null],
  ];
  for (const shift of shifts) {
    const [key, ...values] = shift;
    ids.shifts[String(key)] = insert(db, `
      INSERT INTO guard_shift_logs (staff_id, shift_date, shift_name, opening_notes, handover_notes, cash_count_note, status, opened_at, closed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...values);
  }

  const entries = [
    [ids.shifts["guard-night-17"], ids.guardId, ids.tasks["auditoria-acceso"], "incident", "critical", "Apertura manual posterior a denegación", `${DEMO_TAG} Tótem denegó salida DEMO99; se resolvió con apertura manual documentada.`, ids.spaces["Estacionamiento Demo B05"], accessLogIds[3], 1, "2026-05-18 11:22:00", "2026-05-17 23:22:00"],
    [ids.shifts["guard-night-17"], ids.guardId, ids.tasks["mantencion-c13"], "maintenance", "high", "Chapa estacionamiento C13 trabada", `${DEMO_TAG} Se dejó estacionamiento en mantención y se notificó a administración.`, ids.spaces["Estacionamiento Demo C13"], null, 1, null, "2026-05-17 21:10:00"],
    [ids.shifts["guard-morning-18"], ids.guardId, null, "visitor", "medium", "Ingreso técnico cerrajería", `${DEMO_TAG} Andrea Soto ingresa con pase de mantención y patente MT-8822.`, ids.spaces["Estacionamiento Demo C13"], accessLogIds[2], 0, null, "2026-05-18 09:07:00"],
    [ids.shifts["guard-morning-18"], ids.guardId, null, "payment", "medium", "Cliente informa abono parcial", `${DEMO_TAG} Rodrigo Fuentes informa transferencia parcial; se deriva a finanzas.`, ids.spaces["Estacionamiento Demo A11"], null, 1, null, "2026-05-18 10:30:00"],
  ];
  for (const entry of entries) {
    const entryId = insert(db, `
      INSERT INTO guard_shift_log_entries (
        shift_log_id, staff_id, task_id, category, priority, title, detail, related_space_id,
        related_access_log_id, follow_up_required, resolved_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ...entry);
    if (entry[3] === "maintenance") {
      const stored = storeDemoDocument("Adjunto bitácora guardia C13", "bitacora-c13-demo.pdf");
      db.prepare("INSERT INTO shift_log_entry_attachments (shift_log_entry_id, staff_id, label, file_path, file_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .run(entryId, ids.guardId, "Foto chapa C13", stored.filePath, stored.fileName, stored.mimeType, stored.sizeBytes);
    }
  }
}

function seedAuditEvents(db: any, ids: DemoIds) {
  const events = [
    [ids.adminId, "demo.seed.created", "demo_seed", "deep", JSON.stringify({ tag: DEMO_TAG, scope: "all_modules" }), "127.0.0.1", "demo-seed"],
    [ids.guardId, "access.manual_override", "access_log", "demo", JSON.stringify({ tag: DEMO_TAG, plate: "DEMO99", reason: "ticket impago resuelto manualmente" }), "127.0.0.1", "demo-seed"],
    [ids.financeId, "payment.collection_action_created", "payment", String(ids.payments["fuentes-apr"]), JSON.stringify({ tag: DEMO_TAG, channel: "whatsapp" }), "127.0.0.1", "demo-seed"],
    [ids.adminId, "space.status_changed", "space", String(ids.spaces["Estacionamiento Demo C13"]), JSON.stringify({ tag: DEMO_TAG, status: "maintenance" }), "127.0.0.1", "demo-seed"],
  ];
  for (const event of events) {
    db.prepare("INSERT INTO audit_events (staff_id, action, entity_type, entity_id, metadata, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-1 day'))")
      .run(...event.slice(0, 6));
  }
}

export function seedDeepDemoData(db: any) {
  purgeDeepDemoData(db);

  const run = db.transaction(() => {
    const ids: DemoIds = {
      adminId: getId(db, "SELECT id FROM staff WHERE email = 'admin@parkia.local'"),
      financeId: getId(db, "SELECT id FROM staff WHERE email = 'finance@parkia.local'"),
      guardId: getId(db, "SELECT id FROM staff WHERE email = 'cmendez@parkia.local'"),
      clients: {},
      spaces: {},
      contracts: {},
      payments: {},
      bankMovements: {},
      tasks: {},
      shifts: {},
    };

    seedStaff(db);
    seedClientsSpacesContracts(db, ids);
    seedFinance(db, ids);
    seedDocumentsTasks(db, ids);
    seedAccessAndShifts(db, ids);
    seedAuditEvents(db, ids);
  });

  run();
}
