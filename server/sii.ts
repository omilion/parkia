import { db } from "./db";

export type SiiStatus = "pending" | "accepted" | "rejected";

export type SiiReadiness = {
  ready: boolean;
  mode: string;
  provider: string;
  environment: string;
  checks: { key: string; label: string; ok: boolean; target: string }[];
};

function isProduction() {
  return process.env.NODE_ENV === "production";
}

type InvoiceRow = {
  id: number;
  folio: number;
  type: "boleta" | "factura_exenta" | "factura_afecta";
  client_id: number;
  client_name: string;
  client_rut: string | null;
  client_email: string | null;
  client_address: string | null;
  client_commune: string | null;
  client_city: string | null;
  client_business_activity: string | null;
  billing_contact_email: string | null;
  amount: number;
  payment_id: number | null;
  contract_id: number | null;
  payment_date: string | null;
  status_sii: SiiStatus;
};

const documentTypeLabels: Record<string, string> = {
  boleta: "Boleta",
  factura_exenta: "Factura exenta",
  factura_afecta: "Factura afecta",
};

function getConfig() {
  return db.prepare("SELECT * FROM system_config WHERE id = 1").get() as any;
}

export function getSiiReadiness(): SiiReadiness {
  const config = getConfig() || {};
  const mode = config.sii_mode || "mock";
  const provider = config.sii_provider || "local_mock";
  const localMockInRealMode = mode === "real" && provider === "local_mock";
  const realProviderPending = mode === "real" && provider === "external_provider";
  const checks = [
    { key: "company_name", label: "Razón social emisora", ok: Boolean(config.company_name), target: "/settings?tab=integrations" },
    { key: "company_rut", label: "RUT empresa emisora", ok: Boolean(config.company_rut), target: "/settings?tab=integrations" },
    { key: "company_address", label: "Dirección empresa emisora", ok: Boolean(config.company_address), target: "/settings?tab=integrations" },
    { key: "sii_mock_production", label: "Mock SII deshabilitado en produccion", ok: !(isProduction() && (mode === "mock" || (mode === "real" && provider === "local_mock"))), target: "/settings?tab=integrations" },
    { key: "sii_real_not_local_mock", label: "Modo real no usa proveedor local mock", ok: !localMockInRealMode, target: "/settings?tab=integrations" },
    { key: "sii_real_provider_implemented", label: "Proveedor SII real implementado", ok: !realProviderPending, target: "/settings?tab=integrations" },
  ];

  return {
    ready: mode !== "disabled" && checks.every(check => check.ok),
    mode,
    provider,
    environment: config.sii_environment || "demo",
    checks,
  };
}

function getInvoiceForSii(invoiceId: number) {
  return db.prepare(`
    SELECT i.*,
           c.id as contract_id,
           p.id as payment_id,
           p.payment_date,
           cl.name as client_name,
           cl.rut as client_rut,
           cl.email as client_email,
           cl.address as client_address,
           cl.commune as client_commune,
           cl.city as client_city,
           cl.business_activity as client_business_activity,
           cl.billing_contact_email
    FROM invoices i
    LEFT JOIN payments p ON p.id = i.payment_id
    LEFT JOIN contracts c ON c.id = COALESCE(i.contract_id, p.contract_id)
    JOIN clients cl ON cl.id = i.client_id
    WHERE i.id = ?
  `).get(invoiceId) as InvoiceRow | undefined;
}

function validateInvoice(invoice: InvoiceRow, readiness: SiiReadiness) {
  const missing = readiness.checks
    .filter(check => !check.ok)
    .map(check => check.label);

  if (!invoice.client_name) missing.push("Nombre cliente");
  if (!invoice.client_rut) missing.push("RUT cliente");
  if (invoice.type !== "boleta") {
    if (!invoice.client_business_activity) missing.push("Giro cliente");
    if (!invoice.client_address) missing.push("Dirección cliente");
    if (!invoice.client_commune) missing.push("Comuna cliente");
  }
  if (!Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0) missing.push("Monto positivo");

  return missing;
}

function buildPayload(invoice: InvoiceRow, readiness: SiiReadiness) {
  const config = getConfig() || {};
  const net = invoice.type === "factura_afecta" ? Math.round(Number(invoice.amount) / 1.19) : Number(invoice.amount);
  const tax = invoice.type === "factura_afecta" ? Number(invoice.amount) - net : 0;

  return {
    provider: readiness.provider,
    environment: readiness.environment,
    document: {
      type: invoice.type,
      label: documentTypeLabels[invoice.type],
      folio: invoice.folio,
      amount_total: Number(invoice.amount),
      amount_net: net,
      tax_amount: tax,
      issued_at: new Date().toISOString(),
    },
    issuer: {
      name: config.company_name,
      rut: config.company_rut,
      address: config.company_address,
    },
    receiver: {
      name: invoice.client_name,
      rut: invoice.client_rut,
      email: invoice.billing_contact_email || invoice.client_email,
      address: invoice.client_address,
      commune: invoice.client_commune,
      city: invoice.client_city,
      business_activity: invoice.client_business_activity,
    },
    references: {
      invoice_id: invoice.id,
      payment_id: invoice.payment_id,
      contract_id: invoice.contract_id,
    },
  };
}

function pdfEscape(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function pdfLine(x: number, y: number, size: number, text: string) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`;
}

function buildMockPdf(payload: any, trackId: string) {
  const rows = [
    "Documento tributario simulado - Parkia",
    "Comprobante local para pruebas, sin validez tributaria.",
    `Proveedor: ${payload.provider}`,
    `Ambiente: ${payload.environment}`,
    `Track ID: ${trackId}`,
    `Tipo: ${payload.document.label}`,
    `Folio: ${payload.document.folio}`,
    `Emisor: ${payload.issuer.name} (${payload.issuer.rut})`,
    `Receptor: ${payload.receiver.name} (${payload.receiver.rut})`,
    `Neto: ${payload.document.amount_net}`,
    `IVA: ${payload.document.tax_amount}`,
    `Total: ${payload.document.amount_total}`,
  ];

  const commands = [
    pdfLine(50, 790, 18, rows[0]),
    pdfLine(50, 766, 11, rows[1]),
    "0.2 w 50 750 m 545 750 l S",
  ];
  let y = 720;
  for (const row of rows.slice(2)) {
    commands.push(pdfLine(55, y, 11, row));
    y -= 24;
  }
  commands.push(pdfLine(55, 120, 9, "Generado por proveedor local mock. No reemplaza DTE SII real."));

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

function buildMockXml(payload: any, trackId: string) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<dteMock>",
    `  <provider>${payload.provider}</provider>`,
    `  <environment>${payload.environment}</environment>`,
    `  <trackId>${trackId}</trackId>`,
    `  <type>${payload.document.type}</type>`,
    `  <folio>${payload.document.folio}</folio>`,
    `  <issuerRut>${payload.issuer.rut}</issuerRut>`,
    `  <receiverRut>${payload.receiver.rut}</receiverRut>`,
    `  <amount>${payload.document.amount_total}</amount>`,
    "</dteMock>",
  ].join("\n");
}

export function issueInvoiceWithConfiguredProvider(invoiceId: number, staffId?: number | null) {
  const invoice = getInvoiceForSii(invoiceId);
  if (!invoice) throw new Error("Documento tributario no encontrado");

  const readiness = getSiiReadiness();
  if (readiness.mode === "disabled") {
    throw new Error("La emisión SII está deshabilitada hasta definir proveedor");
  }

  if (isProduction() && (readiness.mode === "mock" || (readiness.mode === "real" && readiness.provider === "local_mock"))) {
    throw new Error("La emision SII mock no esta permitida en produccion");
  }

  if (readiness.mode === "real") {
    throw new Error("Proveedor SII real no implementado. Mantenga el modo deshabilitado o use mock local solo para demo/piloto.");
  }

  if (readiness.provider !== "local_mock") {
    throw new Error("Proveedor SII externo no implementado. No se emitio ni envio ningun DTE real.");
  }

  const missing = validateInvoice(invoice, readiness);
  if (missing.length > 0) {
    const validationJson = JSON.stringify(missing);
    db.prepare(`
      UPDATE invoices
      SET validation_errors_json = ?, status_detail = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(validationJson, "Faltan datos obligatorios para emitir", invoice.id);
    throw new Error(`Faltan datos para emitir: ${missing.join(", ")}`);
  }

  const payload = buildPayload(invoice, readiness);
  const now = new Date().toISOString();
  const trackId = `MOCK-${invoice.folio}-${invoice.id}`;
  const externalId = `LOCAL-${invoice.id}-${invoice.folio}`;
  const response = {
    ok: true,
    provider: readiness.provider,
    environment: readiness.environment,
    external_id: externalId,
    track_id: trackId,
    status: "accepted",
    message: "Documento aceptado por proveedor local mock",
    simulated: true,
  };

  const pdfContent = buildMockPdf(payload, trackId).toString("base64");
  const xmlContent = buildMockXml(payload, trackId);

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE invoices
      SET provider = ?,
          provider_mode = ?,
          external_id = ?,
          track_id = ?,
          status_sii = 'accepted',
          status_detail = ?,
          rejection_reason = NULL,
          validation_errors_json = NULL,
          sii_payload_json = ?,
          sii_response_json = ?,
          pdf_content = ?,
          xml_content = ?,
          issued_at = COALESCE(issued_at, ?),
          accepted_at = ?,
          rejected_at = NULL,
          last_sync_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      readiness.provider,
      readiness.mode,
      externalId,
      trackId,
      response.message,
      JSON.stringify(payload),
      JSON.stringify(response),
      pdfContent,
      xmlContent,
      now,
      now,
      now,
      now,
      invoice.id,
    );

    db.prepare(`
      INSERT INTO sii_events (invoice_id, staff_id, provider, event_type, status, payload_json, response_json)
      VALUES (?, ?, ?, 'issued', 'accepted', ?, ?)
    `).run(invoice.id, staffId || null, readiness.provider, JSON.stringify(payload), JSON.stringify(response));
  });

  transaction();
  return { invoiceId: invoice.id, status: "accepted", trackId, externalId, provider: readiness.provider };
}

export function syncInvoiceWithConfiguredProvider(invoiceId: number, staffId?: number | null) {
  const invoice = getInvoiceForSii(invoiceId);
  if (!invoice) throw new Error("Documento tributario no encontrado");
  const readiness = getSiiReadiness();
  if (readiness.mode === "disabled") {
    throw new Error("La emision SII esta deshabilitada hasta definir proveedor");
  }
  if (readiness.mode === "real" || readiness.provider !== "local_mock") {
    throw new Error("Proveedor SII real no implementado. No se consulto ningun servicio externo.");
  }

  const now = new Date().toISOString();
  const response = {
    ok: true,
    provider: "local_mock",
    status: invoice.status_sii,
    message: invoice.status_sii === "pending" ? "Documento pendiente en proveedor local mock" : "Estado confirmado por proveedor local mock",
    simulated: true,
  };

  db.prepare(`
    UPDATE invoices
    SET last_sync_at = ?, status_detail = COALESCE(status_detail, ?), sii_response_json = ?, updated_at = ?
    WHERE id = ?
  `).run(now, response.message, JSON.stringify(response), now, invoice.id);

  db.prepare(`
    INSERT INTO sii_events (invoice_id, staff_id, provider, event_type, status, response_json)
    VALUES (?, ?, ?, 'synced', ?, ?)
  `).run(invoice.id, staffId || null, "local_mock", invoice.status_sii, JSON.stringify(response));

  return { invoiceId: invoice.id, status: invoice.status_sii, message: response.message };
}
