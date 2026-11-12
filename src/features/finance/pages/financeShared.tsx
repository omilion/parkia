import React from 'react';

import { FileText } from 'lucide-react';
import { BankMovement, CollectionAction, Invoice, Payment, PaymentAdjustment, PaymentAllocation, StaffUser } from '../../../types';

type MovementSuggestion = {
  payment_id: number;
  score: number;
  reasons: string[];
};

type ExpenseMovementSuggestion = {
  bank_movement_id: number;
  movement: BankMovement;
  score: number;
  reasons: string[];
};

type PaymentReviewFilter = 'all' | 'open-to-close' | 'manual-without-receipt';

type ExpenseReviewFilter = 'all' | 'open-to-close' | 'paid-without-receipt' | 'without-due-date';

type PaymentReportMonthField = 'any' | 'due' | 'paid';

type ExpenseReportMonthField = 'any' | 'date' | 'paid';

const financeTabIds = ['payments', 'collections', 'expenses', 'cgvc', 'invoices', 'reports', 'closures'] as const;

type FinanceTab = typeof financeTabIds[number];

function isFinanceTab(value: string | null): value is FinanceTab {
  return financeTabIds.includes(value as FinanceTab);
}

type PaymentDetail = {
  payment: Payment & {
    client_email?: string | null;
    client_phone?: string | null;
    space_name?: string | null;
    monthly_fee?: number;
  };
  adjustments: PaymentAdjustment[];
  allocations: PaymentAllocation[];
  collectionActions: CollectionAction[];
  invoices: Invoice[];
  meta?: { cutOffDate?: string; formulas?: Record<string, string> };
};

type CollectionPayment = Payment & {
  client_email?: string | null;
  client_phone?: string | null;
};

type TaskAssignee = Pick<StaffUser, 'id' | 'name' | 'email' | 'role'>;

type SiiReadiness = {
  ready: boolean;
  mode: 'disabled' | 'mock' | 'real';
  provider: string;
  environment: string;
  checks: { key: string; label: string; ok: boolean; target: string }[];
};

const DTE_TYPE_LABELS: Record<Invoice['type'], string> = {
  boleta: 'boleta',
  factura_exenta: 'factura exenta',
  factura_afecta: 'factura afecta',
};

type DteResult = {
  type?: Invoice['type'];
  folio?: number | string | null;
};

function formatDteType(type?: Invoice['type'] | null, capitalize = false) {
  const label = type && type in DTE_TYPE_LABELS ? DTE_TYPE_LABELS[type] : 'documento tributario';
  return capitalize ? label.charAt(0).toUpperCase() + label.slice(1) : label;
}

function formatIssuedDteMessage(result: DteResult) {
  const documentLabel = formatDteType(result.type);
  const folioLabel = result.folio ? ` folio #${result.folio}` : '';
  return `${documentLabel}${folioLabel} preparado o procesado como DTE`;
}

function getInvoiceStatusLabel(invoice: Invoice) {
  if (invoice.status_sii === 'pending') return 'Preparado';
  if (invoice.status_sii === 'rejected') return 'Rechazado';
  return invoice.provider_mode === 'real' ? 'Aceptado por proveedor' : 'Procesado local';
}

const FinanceEmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-10 text-center">
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-600">
      <FileText className="h-6 w-6" />
    </div>
    <p className="text-sm font-bold text-slate-900">{title}</p>
    <p className="mt-2 text-sm text-slate-600">{description}</p>
    {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
  </div>
);

type FinancePageProps = {
  user: StaffUser;
};
export { financeTabIds, isFinanceTab, DTE_TYPE_LABELS, formatDteType, formatIssuedDteMessage, getInvoiceStatusLabel, FinanceEmptyState };
export type { MovementSuggestion, ExpenseMovementSuggestion, PaymentReviewFilter, ExpenseReviewFilter, PaymentReportMonthField, ExpenseReportMonthField, FinanceTab, PaymentDetail, CollectionPayment, TaskAssignee, SiiReadiness, DteResult, FinancePageProps };
