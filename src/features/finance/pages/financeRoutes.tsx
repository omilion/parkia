import { Navigate, useSearchParams } from 'react-router-dom';
import type { FinanceTab } from './financeShared';

export const financePaths: Record<FinanceTab, string> = {
  payments: '/finanzas/pagos',
  collections: '/finanzas/cobranza',
  expenses: '/finanzas/gastos',
  cgvc: '/finanzas/banco',
  invoices: '/finanzas/documentos-tributarios',
  reports: '/finanzas/reportes',
  closures: '/finanzas/cierres',
};
export function financeTabFromPath(path: string): FinanceTab {
  return (Object.entries(financePaths).find(([, value]) => value === path)?.[0] as FinanceTab) || 'payments';
}
/** Conserva enlaces guardados, filtros y referencias a pagos de versiones anteriores. */
export function FinanceRedirect() {
  const [params] = useSearchParams();
  const requested = params.get('tab') as FinanceTab;
  const tab = params.has('expenseId') ? 'expenses' : params.has('paymentId') ? 'payments' : Object.hasOwn(financePaths, requested) ? requested : 'payments';
  const next = new URLSearchParams(params);
  next.delete('tab');
  return <Navigate replace to={`${financePaths[tab]}${next.size ? `?${next}` : ''}`} />;
}
