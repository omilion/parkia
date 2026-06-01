type ContractPdfData = {
  id: number;
  client_name: string;
  client_rut: string;
  client_email: string | null;
  client_phone: string | null;
  space_name: string;
  space_type: "parking";
  start_date: string;
  end_date: string | null;
  monthly_fee: number;
  billing_day: number;
  deposit_amount: number | null;
  billing_document_type: string;
  status: string;
  notes: string | null;
};

function pdfEscape(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", maximumFractionDigits: 0 }).format(value);
}

function splitText(text: string, maxLength = 92) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textLine(x: number, y: number, size: number, text: string) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfEscape(text)}) Tj ET`;
}

export function createContractPdfBuffer(contract: ContractPdfData) {
  const contractCode = `CON-2026-${String(contract.id).padStart(3, "0")}`;
  const rows = [
    ["Cliente", contract.client_name],
    ["RUT", contract.client_rut],
    ["Correo", contract.client_email || "No informado"],
    ["Telefono", contract.client_phone || "No informado"],
    ["Espacio", `${contract.space_name} (Estacionamiento)`],
    ["Fecha inicio", contract.start_date],
    ["Fecha termino", contract.end_date || "Indefinido"],
    ["Tarifa mensual", formatCurrency(contract.monthly_fee)],
    ["Dia de cobro", String(contract.billing_day)],
    ["Garantia / Deposito", formatCurrency(contract.deposit_amount || 0)],
    ["Documento cobro", contract.billing_document_type],
    ["Estado", contract.status],
  ];

  const commands: string[] = [];
  commands.push(textLine(50, 790, 18, `Contrato de Arriendo ${contractCode}`));
  commands.push(textLine(50, 768, 10, "Parkia - Documento generado para revision y firma"));
  commands.push("0.2 w 50 752 m 545 752 l S");

  let y = 720;
  for (const [label, value] of rows) {
    commands.push(textLine(55, y, 10, `${label}:`));
    commands.push(textLine(190, y, 10, value));
    y -= 22;
  }

  y -= 12;
  commands.push(textLine(50, y, 13, "Condiciones"));
  y -= 24;
  const conditionLines = splitText(
    "El cliente declara recibir el espacio individualizado y se obliga al pago mensual indicado, ademas de cumplir las normas operacionales y administrativas establecidas por Parkia."
  );
  for (const line of conditionLines) {
    commands.push(textLine(55, y, 10, line));
    y -= 16;
  }

  const notes = contract.notes || "Sin notas internas registradas.";
  for (const line of splitText(`Notas: ${notes}`)) {
    commands.push(textLine(55, y, 10, line));
    y -= 16;
  }

  commands.push("50 150 m 230 150 l S");
  commands.push("365 150 m 545 150 l S");
  commands.push(textLine(100, 132, 10, "Arrendador"));
  commands.push(textLine(425, 132, 10, "Cliente"));

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

export function createSimpleReportPdfBuffer(input: { title: string; subtitle?: string; rows: Array<[string, string | number]> }) {
  const commands: string[] = [];
  commands.push(textLine(50, 790, 18, input.title));
  if (input.subtitle) commands.push(textLine(50, 768, 10, input.subtitle));
  commands.push("0.2 w 50 752 m 545 752 l S");

  let y = 724;
  for (const [label, value] of input.rows) {
    if (y < 72) break;
    commands.push(textLine(55, y, 10, `${label}:`));
    commands.push(textLine(280, y, 10, String(value)));
    y -= 20;
  }

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
