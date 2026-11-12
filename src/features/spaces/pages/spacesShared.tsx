import { Space, SpaceMapGeometry, SpaceMapLiveRegion, VisitorQuote, VisitorTicket } from '../../../types';

type ConfirmAction =
  | { type: 'open-barrier'; space: Space }
  | { type: 'force-release'; space: Space }
  | { type: 'mark-available'; space: Space; nextStatus: string }
  | null;

type SpaceDetail = {
  space: Space;
  access: Array<{
    id: number;
    access_type: string;
    status: string;
    reason?: string | null;
    plate?: string | null;
    timestamp: string;
    client_name?: string | null;
    visitor_name?: string | null;
  }>;
  history: Array<{
    id: number;
    previous_status?: string | null;
    status: string;
    reason?: string | null;
    source: string;
    created_at: string;
    staff_name?: string | null;
  }>;
};

type VisitorPaymentDraft = VisitorQuote & {
  ticket_id: number;
  plate: string;
  space_name?: string | null;
  method: string;
  amount: string;
};

type VisitorLookupResult = {
  ticket: VisitorTicket;
  quote?: VisitorQuote | null;
};

type VisitorPaymentHistoryItem = {
  ticket_id: number;
  receipt_number: string;
  plate: string;
  entry_time: string;
  paid_at: string;
  amount: number;
  payment_method: string;
  status: VisitorTicket['status'];
  cash_session_id: number | null;
  payment_override_reason: string | null;
  space_name: string | null;
  cashier_name: string | null;
  duration_mins: number | null;
  grace_period_mins: number | null;
  billable_mins: number | null;
  rate_per_minute: number | null;
  quoted_total: number | null;
  billing_mode: string | null;
};

const readErrorMessage = async (res: Response, fallback: string) => {
  try {
    const body = await res.json();
    return body.error || fallback;
  } catch {
    return fallback;
  }
};

const paymentMethodLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  automatic: 'Automático',
  other: 'Otro',
};

const liveStatusLabels: Record<SpaceMapLiveRegion['status'], string> = {
  available: 'Libre',
  monthly: 'Mensual',
  visitor: 'Visita',
  maintenance: 'Mantención',
  unknown: 'Sin dato',
};

const liveStatusClasses: Record<SpaceMapLiveRegion['status'], string> = {
  available: 'bg-emerald-500',
  monthly: 'bg-red-500',
  visitor: 'bg-orange-500',
  maintenance: 'bg-slate-400',
  unknown: 'bg-sky-300',
};

const liveStatusFill: Record<SpaceMapLiveRegion['status'], string> = {
  available: '#10b981',
  monthly: '#ef4444',
  visitor: '#f97316',
  maintenance: '#94a3b8',
  unknown: '#7dd3fc',
};

const EDITOR_REGION_COLOR = '#39ff14';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const getRectPath = (geometry: SpaceMapGeometry) => {
  if (geometry.type === 'polygon') {
    return geometry.points.map(point => `${point.x},${point.y}`).join(' ');
  }
  return undefined;
};

function formatCurrency(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString('es-CL')}`;
}
export { readErrorMessage, paymentMethodLabels, liveStatusLabels, liveStatusClasses, liveStatusFill, EDITOR_REGION_COLOR, clamp01, getRectPath, formatCurrency };
export type { ConfirmAction, SpaceDetail, VisitorPaymentDraft, VisitorLookupResult, VisitorPaymentHistoryItem };
