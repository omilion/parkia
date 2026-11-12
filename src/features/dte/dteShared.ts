import { apiFetchJson } from '../../lib/api';

/** Tipos y utilidades del asistente de facturación electrónica (SII). */

export type DteStepKey = 'emisor' | 'certificate' | 'connection' | 'caf' | 'test_document' | 'production';

export type DteOnboarding = {
  status: 'unconfigured' | 'testing' | 'certified' | 'production';
  environment: 'certificacion' | 'produccion';
  productionAllowed: boolean;
  settings: {
    rut_emisor: string | null; razon_social: string | null; giro: string | null; acteco: number[]; direccion: string | null;
    comuna: string | null; ciudad: string | null; sii_unidad: string | null; codigo_sucursal_sii: number | null; rut_envia: string | null;
    auto_emit_boleta: boolean; resolucion_numero: number | null; resolucion_fecha: string | null; live_since: string | null;
  };
  connection: { ok: boolean | null; checkedAt: string | null; message: string | null };
  certificate: { subjectName: string | null; subjectRut: string | null; issuer: string | null; validFrom: string; validTo: string; daysLeft: number; expired: boolean; fingerprint: string } | null;
  cafs: Array<{ id: number; environment: 'certificacion' | 'produccion'; dte_type: number; folio_from: number; folio_to: number; next_folio: number; remaining: number; authorized_at: string; expires_at: string | null; status: string }>;
  certification: { sent: number; accepted: number };
  counts: Record<string, number>;
  steps: Array<{ key: DteStepKey; done: boolean }>;
  alerts: Array<{ level: 'error' | 'warning'; code: string; message: string }>;
};

export type DteDocumentListItem = {
  id: number; environment: 'certificacion' | 'produccion'; dte_type: number; folio: number; issued_at: string;
  receptor_rut: string | null; receptor_razon: string | null; total: number; status: string; status_detail: string | null;
  track_id: string | null; source_type: string | null; source_id: string | null; send_attempts: number; created_at: string;
};

export const dteOnboardingQueryKey = ['dte', 'onboarding'] as const;
export const fetchDteOnboarding = (signal?: AbortSignal) => apiFetchJson<DteOnboarding>('/api/dte/onboarding', { signal });

export const DTE_TYPE_NAMES: Record<number, string> = {
  33: 'Factura', 34: 'Factura exenta', 39: 'Boleta', 41: 'Boleta exenta', 56: 'Nota de débito', 61: 'Nota de crédito',
};

export const DTE_STATUS: Record<string, { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  queued: { label: 'En cola', tone: 'warning' },
  sent: { label: 'Enviado al SII', tone: 'info' },
  accepted: { label: 'Aceptado', tone: 'success' },
  accepted_with_objections: { label: 'Aceptado con reparos', tone: 'warning' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  voided: { label: 'Anulado', tone: 'neutral' },
};

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Lee un archivo como base64 sin el prefijo data:. */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    // Los CAF del SII vienen en ISO-8859-1.
    reader.readAsText(file, 'ISO-8859-1');
  });
}

export function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}-${month}-${year}`;
}

export const money = (value: number) => `$${Math.round(Number(value || 0)).toLocaleString('es-CL')}`;

/** Abre la representación impresa y lanza el diálogo de impresión cuando carga. */
export function openPrintView(documentId: number, format: 'thermal' | 'letter') {
  const printWindow = window.open(`/api/dte/documents/${documentId}/print?format=${format}`, '_blank');
  printWindow?.addEventListener('load', () => printWindow.print());
}
