/**
 * Documento de recibo neutro: una lista de bloques que luego se dibuja como bytes ESC/POS (impresora térmica
 * por Bluetooth o USB) o como HTML de 58/80 mm (diálogo de impresión del sistema). Así el contenido de
 * los tickets vive en un solo lugar y los dos formatos nunca divergen.
 */

export type Align = 'left' | 'center' | 'right';

export type ReceiptBlock =
  | { type: 'text'; text: string; align?: Align; bold?: boolean; size?: 1 | 2 | 3 }
  | { type: 'row'; left: string; right: string; bold?: boolean }
  | { type: 'rule' }
  | { type: 'qr'; value: string; caption?: string }
  | { type: 'image'; pngBase64: string; caption?: string }
  | { type: 'feed'; lines?: number };

export type ReceiptDocument = { title: string; blocks: ReceiptBlock[] };

export const money = (amount: number) => `$${Math.round(amount).toLocaleString('es-CL')}`;

/** dd-mm-aaaa hh:mm en la zona horaria de la sucursal. */
export function formatDateTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('es-CL', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}`;
}

export function formatDuration(minutes: number) {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours ? `${hours} h ${rest} min` : `${rest} min`;
}

export function entryTicketDocument(input: {
  company: string;
  branch: string;
  plate: string;
  entryAt: Date;
  spaceName: string | null;
  vehicleLabel: string;
  /** Enlace de pago en línea; sin él (ticket antiguo) no se imprime QR. */
  payUrl: string | null;
  timeZone: string;
}): ReceiptDocument {
  return {
    title: `Ticket de entrada ${input.plate}`,
    blocks: [
      { type: 'text', text: input.company, align: 'center', bold: true, size: 2 },
      { type: 'text', text: input.branch, align: 'center' },
      { type: 'rule' },
      { type: 'text', text: 'TICKET DE ENTRADA', align: 'center', bold: true },
      { type: 'text', text: input.plate, align: 'center', bold: true, size: 3 },
      { type: 'rule' },
      { type: 'row', left: 'Entrada', right: formatDateTime(input.entryAt, input.timeZone) },
      { type: 'row', left: 'Vehículo', right: input.vehicleLabel },
      { type: 'row', left: 'Plaza', right: input.spaceName || 'Sin asignar' },
      ...(input.payUrl ? [{ type: 'rule' } as const, { type: 'qr', value: input.payUrl, caption: 'Escanea para pagar desde tu teléfono' } as const] : []),
      { type: 'rule' },
      { type: 'text', text: 'Conserve este ticket. En caso de pérdida se cobra el tiempo real de permanencia.', align: 'center' },
      { type: 'feed', lines: 3 },
    ],
  };
}

export function exitReceiptDocument(input: {
  company: string;
  companyRut: string | null;
  branch: string;
  plate: string;
  entryAt: Date;
  paidAt: Date;
  durationMins: number;
  amount: number;
  methodLabel: string;
  timeZone: string;
  /** Boleta electrónica ya emitida (con su timbre). Sin conexión o antes de emitirse es null. */
  boleta: { folio: number; typeLabel: string; tedPngBase64: string | null } | null;
}): ReceiptDocument {
  return {
    title: `Comprobante ${input.plate}`,
    blocks: [
      { type: 'text', text: input.company, align: 'center', bold: true, size: 2 },
      ...(input.companyRut ? [{ type: 'text', text: `RUT ${input.companyRut}`, align: 'center' } as const] : []),
      { type: 'text', text: input.branch, align: 'center' },
      { type: 'rule' },
      { type: 'text', text: input.boleta ? `${input.boleta.typeLabel.toUpperCase()} N° ${input.boleta.folio}` : 'COMPROBANTE DE PAGO', align: 'center', bold: true },
      { type: 'row', left: 'Patente', right: input.plate, bold: true },
      { type: 'row', left: 'Entrada', right: formatDateTime(input.entryAt, input.timeZone) },
      { type: 'row', left: 'Pago', right: formatDateTime(input.paidAt, input.timeZone) },
      { type: 'row', left: 'Tiempo', right: formatDuration(input.durationMins) },
      { type: 'row', left: 'Medio', right: input.methodLabel },
      { type: 'rule' },
      { type: 'row', left: 'TOTAL', right: money(input.amount), bold: true },
      { type: 'rule' },
      ...(input.boleta?.tedPngBase64
        // VERIFICAR-SII: el instructivo fija el texto exacto y el tamaño mínimo del timbre; revisar al certificar.
        ? [{ type: 'image', pngBase64: input.boleta.tedPngBase64, caption: 'Timbre Electrónico SII\nVerifique este documento en www.sii.cl' } as const]
        : [{ type: 'text', text: input.boleta ? 'Boleta electrónica emitida.' : 'La boleta electrónica se emite al confirmarse el pago en el servidor.', align: 'center' } as const]),
      { type: 'text', text: 'Gracias por su visita', align: 'center' },
      { type: 'feed', lines: 3 },
    ],
  };
}
