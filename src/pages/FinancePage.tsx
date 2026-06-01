import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Clock, Copy, CreditCard, Download, FileJson, FileText, Filter, Mail, MessageCircle, Pencil, Phone, RefreshCw, Search, Send, UploadCloud } from 'lucide-react';
import { BankMovement, Branch, CollectionAction, Expense, FinanceSummary, FinancialBudget, Invoice, Payment, PaymentAdjustment, PaymentAllocation, StaffUser } from '../types';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Drawer from '../components/ui/Drawer';
import Toast from '../components/ui/Toast';
import { apiFetchJson } from '../lib/api';
import { cn } from '../lib/utils';

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
const financeTabIds = ['payments', 'collections', 'expenses', 'cgvc', 'invoices', 'reports'] as const;
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
    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
      <FileText className="h-6 w-6" />
    </div>
    <p className="text-sm font-bold text-slate-900">{title}</p>
    <p className="mt-2 text-sm text-slate-500">{description}</p>
    {action && <div className="mt-5 flex flex-wrap justify-center gap-3">{action}</div>}
  </div>
);

type FinancePageProps = {
  user: StaffUser;
};

const FinancePage = ({ user }: FinancePageProps) => {
  const isAdmin = user.role === 'admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<FinanceTab>(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    return isFinanceTab(requestedTab) ? requestedTab : 'payments';
  });
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [movements, setMovements] = useState<BankMovement[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [collectionQueue, setCollectionQueue] = useState<CollectionAction[]>([]);
  const [openCollectionQueue, setOpenCollectionQueue] = useState<CollectionAction[]>([]);
  const [collectionsReport, setCollectionsReport] = useState<any>(null);
  const [delinquencyReport, setDelinquencyReport] = useState<any>(null);
  const [profitabilityReport, setProfitabilityReport] = useState<any>(null);
  const [monthlyCloseReport, setMonthlyCloseReport] = useState<any>(null);
  const [operationalCloseReport, setOperationalCloseReport] = useState<any>(null);
  const [monthlyClosure, setMonthlyClosure] = useState<any>(null);
  const [budgetReport, setBudgetReport] = useState<any>(null);
  const [cashFlowReport, setCashFlowReport] = useState<any>(null);
  const [budgets, setBudgets] = useState<FinancialBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [paymentDetail, setPaymentDetail] = useState<PaymentDetail | null>(null);
  const [adjustmentPayment, setAdjustmentPayment] = useState<Payment | null>(null);
  const [selectedMovement, setSelectedMovement] = useState<BankMovement | null>(null);
  const [editingMovement, setEditingMovement] = useState<BankMovement | null>(null);
  const [allocationPayment, setAllocationPayment] = useState<Payment | null>(null);
  const [reverseAllocation, setReverseAllocation] = useState<PaymentAllocation | null>(null);
  const [collectionPayment, setCollectionPayment] = useState<CollectionPayment | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [expensePaymentAction, setExpensePaymentAction] = useState<Expense | null>(null);
  const [expensePaymentNote, setExpensePaymentNote] = useState('');
  const [reconcilingExpense, setReconcilingExpense] = useState<Expense | null>(null);
  const [expenseMovementSuggestions, setExpenseMovementSuggestions] = useState<ExpenseMovementSuggestion[]>([]);
  const [isExpenseDrawerOpen, setIsExpenseDrawerOpen] = useState(false);
  const [collectionActions, setCollectionActions] = useState<CollectionAction[]>([]);
  const [historyPayment, setHistoryPayment] = useState<Payment | null>(null);
  const [movementAllocationHistory, setMovementAllocationHistory] = useState<PaymentAllocation[]>([]);
  const [paymentAllocationHistory, setPaymentAllocationHistory] = useState<PaymentAllocation[]>([]);
  const [movementSuggestions, setMovementSuggestions] = useState<MovementSuggestion[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSavingAdjustment, setIsSavingAdjustment] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isAllocating, setIsAllocating] = useState(false);
  const [isReversingAllocation, setIsReversingAllocation] = useState(false);
  const [isSavingCollectionAction, setIsSavingCollectionAction] = useState(false);
  const [isSavingExpense, setIsSavingExpense] = useState(false);
  const [isSavingBudget, setIsSavingBudget] = useState(false);
  const [isClosingMonth, setIsClosingMonth] = useState(false);
  const [isReconcilingExpense, setIsReconcilingExpense] = useState(false);
  const [isImportingBank, setIsImportingBank] = useState(false);
  const [isUpdatingMovement, setIsUpdatingMovement] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [paymentReviewFilter, setPaymentReviewFilter] = useState<PaymentReviewFilter>('all');
  const [paymentReportMonth, setPaymentReportMonth] = useState<string | null>(null);
  const [paymentReportMonthField, setPaymentReportMonthField] = useState<PaymentReportMonthField>('any');
  const [expenseStatus, setExpenseStatus] = useState<'all' | 'pending' | 'paid' | 'overdue' | 'cancelled'>('all');
  const [expenseCategory, setExpenseCategory] = useState<Expense['category'] | 'all'>('all');
  const [expenseDueFilter, setExpenseDueFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming'>('all');
  const [expenseReviewFilter, setExpenseReviewFilter] = useState<ExpenseReviewFilter>('all');
  const [expenseReportMonth, setExpenseReportMonth] = useState<string | null>(null);
  const [expenseReportMonthField, setExpenseReportMonthField] = useState<ExpenseReportMonthField>('any');
  const [reportMonth, setReportMonth] = useState(new Date().toISOString().slice(0, 7));
  const [monthlyCloseNote, setMonthlyCloseNote] = useState('');
  const [monthlyReopenReason, setMonthlyReopenReason] = useState('');
  const [collectionQueueStatus, setCollectionQueueStatus] = useState<'open' | 'done' | 'all'>('open');
  const [collectionQueueDue, setCollectionQueueDue] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'actionable'>('all');
  const [movementSearch, setMovementSearch] = useState('');
  const [movementStatus, setMovementStatus] = useState<'all' | 'attention' | 'pending' | 'partial' | 'reconciled'>('pending');
  const [movementReportMonth, setMovementReportMonth] = useState<string | null>(null);
  const [invoiceStatus, setInvoiceStatus] = useState<'all' | 'pending' | 'accepted' | 'rejected'>('all');
  const [siiReadiness, setSiiReadiness] = useState<SiiReadiness | null>(null);
  const [invoiceActionId, setInvoiceActionId] = useState<number | null>(null);
  const [selectedReceiptName, setSelectedReceiptName] = useState('');
  const [selectedExpenseReceiptName, setSelectedExpenseReceiptName] = useState('');
  const [taskAssignees, setTaskAssignees] = useState<TaskAssignee[]>([]);
  const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const focusedQueryRef = React.useRef('');

  const fileToReceipt = (file: File) => new Promise<{ fileName: string, mimeType: string, dataBase64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        fileName: file.name,
        mimeType: file.type,
        dataBase64: result.includes(',') ? result.split(',')[1] : result,
      });
    };
    reader.onerror = () => reject(new Error('No se pudo leer el comprobante'));
    reader.readAsDataURL(file);
  });

  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const withBranch = (url: string) => {
    if (selectedBranchId === 'all') return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}branch_id=${selectedBranchId}`;
  };

  const fetchData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const fetchJson = async <T,>(url: string, label: string, required = true): Promise<T | null> => {
        try {
          return await apiFetchJson<T>(url);
        } catch (error) {
          if (required) {
            const message = error instanceof Error ? error.message : label;
            throw new Error(message === 'No se pudo completar la solicitud' ? label : message);
          }
          return null;
        }
      };

      const [
        summaryData,
        branchesData,
        paymentsData,
        movementsData,
        invoicesData,
        expensesData,
        collectionQueueData,
        openCollectionQueueData,
        collectionsReportData,
        delinquencyReportData,
        profitabilityReportData,
        monthlyCloseReportData,
        operationalCloseReportData,
        monthlyClosureData,
        budgetReportData,
        cashFlowReportData,
        budgetsData,
        siiReadinessData,
      ] = await Promise.all([
        fetchJson<FinanceSummary>(withBranch('/api/finance/summary'), 'resumen financiero'),
        fetchJson<Branch[]>('/api/branches', 'sucursales', false),
        fetchJson<Payment[]>(withBranch('/api/finance/payments'), 'cuentas por cobrar'),
        fetchJson<BankMovement[]>('/api/finance/bank-movements', 'cartola bancaria'),
        fetchJson<Invoice[]>('/api/finance/invoices', 'facturacion'),
        fetchJson<Expense[]>(withBranch(`/api/finance/expenses?status=${expenseStatus}&category=${expenseCategory}&due=${expenseDueFilter}`), 'gastos'),
        fetchJson<CollectionAction[]>(withBranch(`/api/finance/collection-actions?status=${collectionQueueStatus}&due=${collectionQueueDue}`), 'cola de cobranza'),
        fetchJson<CollectionAction[]>(withBranch('/api/finance/collection-actions?status=open&due=all'), 'gestiones abiertas'),
        fetchJson<any>(withBranch('/api/finance/reports/collections'), 'reporte de cobranza', false),
        fetchJson<any>(withBranch('/api/finance/reports/delinquency'), 'reporte de morosidad', false),
        fetchJson<any>(withBranch('/api/finance/reports/profitability'), 'reporte de rentabilidad', false),
        fetchJson<any>(`/api/finance/reports/monthly-close?month=${reportMonth}`, 'cierre mensual', false),
        fetchJson<any>(`/api/finance/reports/operational-close?month=${reportMonth}`, 'cierre operacional', false),
        fetchJson<any>(`/api/finance/monthly-closures?month=${reportMonth}`, 'estado de cierre', false),
        fetchJson<any>(`/api/finance/reports/budget?month=${reportMonth}`, 'presupuesto', false),
        fetchJson<any>(`/api/finance/reports/cash-flow?month=${reportMonth}`, 'flujo de caja', false),
        fetchJson<any>(`/api/finance/budgets?month=${reportMonth}`, 'presupuestos', false),
        fetchJson<SiiReadiness>('/api/finance/invoices/readiness', 'estado SII', false),
      ]);

      setSummary(summaryData);
      setBranches(branchesData || []);
      setPayments(paymentsData || []);
      setMovements(movementsData || []);
      setInvoices(invoicesData || []);
      setExpenses(expensesData || []);
      setCollectionQueue(collectionQueueData || []);
      setOpenCollectionQueue(openCollectionQueueData || []);
      setCollectionsReport(collectionsReportData);
      setDelinquencyReport(delinquencyReportData);
      setProfitabilityReport(profitabilityReportData);
      setMonthlyCloseReport(monthlyCloseReportData);
      setOperationalCloseReport(operationalCloseReportData);
      setMonthlyClosure(monthlyClosureData?.closure || null);
      setBudgetReport(budgetReportData);
      setCashFlowReport(cashFlowReportData);
      setBudgets(budgetsData?.budgets || []);
      setSiiReadiness(siiReadinessData);
    } catch (error: any) {
      const message = error.message || 'la informacion financiera';
      setLoadError(message.startsWith('El servidor devolvio') ? message : `No se pudo cargar ${message}.`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [collectionQueueStatus, collectionQueueDue, expenseStatus, expenseCategory, expenseDueFilter, reportMonth, selectedBranchId]);

  useEffect(() => {
    apiFetchJson<TaskAssignee[]>('/api/tasks/assignees')
      .then(setTaskAssignees)
      .catch(() => setTaskAssignees([]));
  }, []);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    const nextTab = isFinanceTab(requestedTab) ? requestedTab : 'payments';
    setActiveTab((current) => current === nextTab ? current : nextTab);

    const nextReportMonth = searchParams.get('month');
    if (/^\d{4}-\d{2}$/.test(nextReportMonth || '')) {
      setReportMonth(nextReportMonth as string);
    }

    const nextExpenseStatus = searchParams.get('expenseStatus');
    if (['all', 'pending', 'paid', 'overdue', 'cancelled'].includes(nextExpenseStatus || '')) {
      setExpenseStatus(nextExpenseStatus as typeof expenseStatus);
    }
    const nextExpenseDue = searchParams.get('expenseDue');
    if (['all', 'overdue', 'today', 'upcoming'].includes(nextExpenseDue || '')) {
      setExpenseDueFilter(nextExpenseDue as typeof expenseDueFilter);
    }
    const nextCollectionStatus = searchParams.get('collectionStatus');
    if (['open', 'done', 'all'].includes(nextCollectionStatus || '')) {
      setCollectionQueueStatus(nextCollectionStatus as typeof collectionQueueStatus);
    }
    const nextCollectionDue = searchParams.get('collectionDue');
    if (['all', 'overdue', 'today', 'upcoming', 'actionable'].includes(nextCollectionDue || '')) {
      setCollectionQueueDue(nextCollectionDue as typeof collectionQueueDue);
    }
    const nextMovementStatus = searchParams.get('movementStatus');
    if (['all', 'attention', 'pending', 'partial', 'reconciled'].includes(nextMovementStatus || '')) {
      setMovementStatus(nextMovementStatus as typeof movementStatus);
    }
    const nextPaymentStatus = searchParams.get('paymentStatus');
    if (['all', 'pending', 'paid', 'overdue', 'cancelled'].includes(nextPaymentStatus || '')) {
      setPaymentStatus(nextPaymentStatus);
    }
  }, [searchParams]);

  const fetchAllocationHistory = async (params: URLSearchParams) => {
    const res = await fetch(`/api/finance/payment-allocations?${params.toString()}`);
    if (!res.ok) throw new Error('No se pudo cargar el historial');
    return res.json() as Promise<PaymentAllocation[]>;
  };

  const fetchCollectionActions = async (paymentId: number) => {
    const res = await fetch(`/api/finance/payments/${paymentId}/collection-actions`);
    if (!res.ok) throw new Error('No se pudo cargar la cobranza');
    return res.json() as Promise<CollectionAction[]>;
  };

  const requestAdminApproval = async (
    label: string,
    source?: { source_type: string; source_id: string | number; source_label: string }
  ) => {
    const adminAssignee = taskAssignees.find(assignee => assignee.role === 'admin');
    const sourceLine = source ? `\n\nOrigen: ${source.source_label} #${source.source_id}.` : '';
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Aprobación administrativa: ${label}`,
          description: `Solicitud creada por ${user.name} (${user.email}) desde Finanzas.\n\nAcción requerida: ${label}.${sourceLine}\n\nRevisar respaldo, motivo y trazabilidad antes de ejecutar.`,
          category: 'finance',
          priority: 'high',
          assigned_staff_id: adminAssignee?.id || null,
          source_type: source?.source_type || null,
          source_id: source ? String(source.source_id) : null,
          due_date: new Date().toISOString().slice(0, 10),
        }),
      });
      if (!res.ok) throw new Error('No se pudo crear la solicitud');
      setToast({ message: `Solicitud enviada a administración para ${label}.`, type: 'success' });
    } catch {
      setToast({ message: `No se pudo crear la solicitud. Registra manualmente la aprobación para ${label}.`, type: 'error' });
    }
  };

  const copyText = async (value: string | null | undefined, label: string) => {
    const text = value?.trim();
    if (!text) {
      setToast({ message: `${label} no disponible para este cliente.`, type: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setToast({ message: `${label} copiado.`, type: 'success' });
    } catch {
      setToast({ message: `No se pudo copiar ${label.toLowerCase()}.`, type: 'error' });
    }
  };

  const refreshInvoices = async () => {
    const [invoiceData, readinessData] = await Promise.all([
      apiFetchJson<Invoice[]>('/api/finance/invoices'),
      apiFetchJson<SiiReadiness>('/api/finance/invoices/readiness'),
    ]);
    setInvoices(invoiceData || []);
    setSiiReadiness(readinessData);
  };

  const handleIssueInvoice = async (invoice: Invoice) => {
    setInvoiceActionId(invoice.id);
    try {
      await apiFetchJson(`/api/finance/invoices/${invoice.id}/issue`, { method: 'POST' });
      setToast({
        message: `${formatDteType(invoice.type, true)} folio #${invoice.folio} procesado en mock local; no acredita aceptación real del SII.`,
        type: 'success',
      });
      await refreshInvoices();
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo procesar el documento tributario.', type: 'error' });
      await refreshInvoices().catch(() => undefined);
    } finally {
      setInvoiceActionId(null);
    }
  };

  const handleSyncInvoice = async (invoice: Invoice) => {
    setInvoiceActionId(invoice.id);
    try {
      await apiFetchJson(`/api/finance/invoices/${invoice.id}/sync`, { method: 'POST' });
      setToast({ message: `Estado DTE/proveedor actualizado para folio #${invoice.folio}.`, type: 'success' });
      await refreshInvoices();
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo sincronizar el documento tributario.', type: 'error' });
    } finally {
      setInvoiceActionId(null);
    }
  };

  const downloadInvoiceFile = (invoice: Invoice, format: 'pdf' | 'xml') => {
    window.location.href = `/api/finance/invoices/${invoice.id}/${format}`;
  };

  const normalizePhoneForWhatsApp = (phone: string | null | undefined) => {
    const digits = phone?.replace(/\D/g, '') || '';
    if (!digits) return '';
    if (digits.startsWith('56')) return digits;
    if (digits.length === 9) return `56${digits}`;
    return digits;
  };

  const buildCollectionMessage = (payment: CollectionPayment) => {
    const balance = Number(payment.remaining_amount ?? payment.amount ?? 0).toLocaleString();
    return `Hola ${payment.client_name || ''}, te contactamos desde Parkia por el saldo pendiente de $${balance} con vencimiento ${payment.due_date}. Por favor indícanos si ya fue transferido o la fecha estimada de pago.`;
  };

  const copyCollectionTemplate = (payment: CollectionPayment) => {
    copyText(buildCollectionMessage(payment), 'Plantilla de cobranza');
  };

  const openCollectionDrawer = async (payment: CollectionPayment) => {
    setCollectionPayment(payment);
    if ('client_email' in payment && 'client_phone' in payment) return;
    try {
      const detail = await apiFetchJson<PaymentDetail>(`/api/finance/payments/${payment.id}/detail`);
      setCollectionPayment(detail.payment);
    } catch {
      // La cobranza sigue operativa con los datos mínimos de la fila.
    }
  };

  const openPaymentDetail = async (payment: Payment) => {
    setPaymentDetail({ payment, adjustments: [], allocations: [], collectionActions: [], invoices: [] });
    try {
      const detail = await apiFetchJson<PaymentDetail>(`/api/finance/payments/${payment.id}/detail`);
      setPaymentDetail(detail);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo cargar la ficha de cuenta por cobrar', type: 'error' });
    }
  };

  const openPaymentDetailById = async (paymentId: number) => {
    const payment = payments.find(item => item.id === paymentId);
    if (payment) {
      await openPaymentDetail(payment);
      return;
    }

    try {
      const detail = await apiFetchJson<PaymentDetail>(`/api/finance/payments/${paymentId}/detail`);
      setPaymentDetail(detail);
    } catch (error: any) {
      focusedQueryRef.current = '';
      setToast({ message: error.message || 'No se pudo abrir el pago solicitado', type: 'error' });
    }
  };

  const openExpenseDrawerById = async (expenseId: number) => {
    const expense = expenses.find(item => item.id === expenseId);
    if (expense) {
      openExpenseDrawer(expense);
      return;
    }

    try {
      const allExpenses = await apiFetchJson<Expense[]>('/api/finance/expenses?status=all&category=all&due=all');
      const requestedExpense = allExpenses.find(item => item.id === expenseId);
      if (!requestedExpense) throw new Error('Gasto no encontrado');
      setExpenses(allExpenses);
      openExpenseDrawer(requestedExpense);
    } catch (error: any) {
      focusedQueryRef.current = '';
      setToast({ message: error.message || 'No se pudo abrir el gasto solicitado', type: 'error' });
    }
  };

  useEffect(() => {
    if (!selectedMovement) {
      setMovementSuggestions([]);
      setMovementAllocationHistory([]);
      return;
    }

    let cancelled = false;
    Promise.all([
      fetch(`/api/finance/bank-movements/${selectedMovement.id}/suggestions`)
      .then(async (res) => res.ok ? res.json() : { suggestions: [] })
        .catch(() => ({ suggestions: [] })),
      fetchAllocationHistory(new URLSearchParams({ bank_movement_id: String(selectedMovement.id) }))
        .catch(() => []),
    ]).then(([suggestionsResult, allocations]) => {
      if (cancelled) return;
      setMovementSuggestions(suggestionsResult.suggestions || []);
      setMovementAllocationHistory(allocations);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedMovement]);

  useEffect(() => {
    if (!historyPayment) {
      setPaymentAllocationHistory([]);
      return;
    }

    let cancelled = false;
    fetchAllocationHistory(new URLSearchParams({ payment_id: String(historyPayment.id) }))
      .then((allocations) => {
        if (!cancelled) setPaymentAllocationHistory(allocations);
      })
      .catch(() => {
        if (!cancelled) setPaymentAllocationHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [historyPayment]);

  useEffect(() => {
    if (!collectionPayment) {
      setCollectionActions([]);
      return;
    }

    let cancelled = false;
    fetchCollectionActions(collectionPayment.id)
      .then((actions) => {
        if (!cancelled) setCollectionActions(actions);
      })
      .catch(() => {
        if (!cancelled) setCollectionActions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [collectionPayment]);

  useEffect(() => {
    if (!reconcilingExpense) {
      setExpenseMovementSuggestions([]);
      return;
    }

    let cancelled = false;
    fetch(`/api/finance/expenses/${reconcilingExpense.id}/bank-suggestions`)
      .then(async (res) => res.ok ? res.json() : { suggestions: [] })
      .then((result) => {
        if (!cancelled) setExpenseMovementSuggestions(result.suggestions || []);
      })
      .catch(() => {
        if (!cancelled) setExpenseMovementSuggestions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [reconcilingExpense]);

  const handleSyncBank = async () => {
    setIsSyncing(true);
    const res = await fetch('/api/finance/sync-bank', { method: 'POST' });
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: `${result.message || 'Conciliacion automatica ejecutada sobre cartola importada.'} ${result.count} conciliados y ${result.unmatched ?? 0} pendientes para revisión.`,
        type: 'success'
      });
      setMovementStatus('pending');
      setSelectedMovement(null);
      fetchData();
    } else {
      setToast({ message: result.error || 'Error al conciliar cartola importada', type: 'error' });
    }
    setIsSyncing(false);
  };

  const downloadFile = async (url: string, fileName: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'No se pudo generar el archivo');
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo descargar el archivo', type: 'error' });
    }
  };

  const handleImportBankMovements = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setToast({ message: 'La cartola debe cargarse en formato CSV', type: 'error' });
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setToast({ message: 'La cartola no puede superar 2MB', type: 'error' });
      return;
    }

    setIsImportingBank(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const res = await fetch('/api/finance/bank-movements/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, dataBase64 }),
      });
      const result = await res.json();

      if (res.ok) {
        setToast({
          message: `Cartola importada: ${result.imported} nuevos, ${result.duplicated} duplicados, ${result.skipped} omitidos.`,
          type: 'success',
        });
        setMovementStatus('pending');
        fetchData();
      } else {
        setToast({ message: result.error || 'No se pudo importar la cartola', type: 'error' });
      }
    } catch {
      setToast({ message: 'No se pudo leer la cartola bancaria', type: 'error' });
    } finally {
      setIsImportingBank(false);
    }
  };

  const handleRegisterPayment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedPayment) return;

    setIsRegistering(true);
    const formData = new FormData(e.currentTarget);
    const receiptFile = formData.get('receipt');

    if (receiptFile instanceof File && receiptFile.size > 5 * 1024 * 1024) {
      setToast({ message: 'El comprobante no puede superar 5MB', type: 'error' });
      setIsRegistering(false);
      return;
    }

    const data: Record<string, unknown> = {
      method: formData.get('method'),
      payment_date: formData.get('payment_date'),
      reference: formData.get('reference'),
      note: formData.get('note'),
    };

    try {
      if (receiptFile instanceof File && receiptFile.size > 0) {
        data.receipt = await fileToReceipt(receiptFile);
      }
    } catch {
      setToast({ message: 'No se pudo leer el comprobante', type: 'error' });
      setIsRegistering(false);
      return;
    }

    const res = await fetch(`/api/finance/payments/${selectedPayment.id}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      const result = await res.json();
      setToast({ message: `Pago registrado por $${Number(result.paidAmount ?? result.amount ?? 0).toLocaleString()}. ${formatIssuedDteMessage(result)}.`, type: 'success' });
      setIsDrawerOpen(false);
      setSelectedPayment(null);
      setSelectedReceiptName('');
      fetchData();
    } else {
      const err = await res.json();
      setToast({ message: err.error || 'Error al registrar pago', type: 'error' });
    }
    setIsRegistering(false);
  };

  const handleManualReconcile = async (payment: Payment) => {
    if (!selectedMovement) return;

    setIsReconciling(true);
    const res = await fetch(`/api/finance/bank-movements/${selectedMovement.id}/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_id: payment.id,
        note: 'Vinculación manual desde finanzas',
      }),
    });

    const result = await res.json();
    if (res.ok) {
      setToast({ message: `Movimiento conciliado. ${formatIssuedDteMessage(result)}.`, type: 'success' });
      setSelectedMovement(null);
      fetchData();
    } else {
      setToast({ message: result.error || 'Error al conciliar movimiento', type: 'error' });
    }
    setIsReconciling(false);
  };

  const handleAllocateMovement = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedMovement || !allocationPayment) return;

    const formData = new FormData(e.currentTarget);
    setIsAllocating(true);
    const res = await fetch(`/api/finance/bank-movements/${selectedMovement.id}/allocate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_id: allocationPayment.id,
        amount: formData.get('amount'),
        note: formData.get('note'),
      }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({
        message: result.paymentFullyPaid
          ? `Abono aplicado y pago completado. ${formatIssuedDteMessage(result)}.`
          : 'Abono parcial aplicado. El pago queda con saldo pendiente.',
        type: 'success',
      });
      setAllocationPayment(null);
      setSelectedMovement(null);
      setMovementStatus(result.movementStatus || 'partial');
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo aplicar el abono', type: 'error' });
    }
    setIsAllocating(false);
  };

  const refreshAllocationHistoryPanels = async () => {
    await fetchData();
    if (selectedMovement) {
      fetchAllocationHistory(new URLSearchParams({ bank_movement_id: String(selectedMovement.id) }))
        .then(setMovementAllocationHistory)
        .catch(() => setMovementAllocationHistory([]));
    }
    if (historyPayment) {
      fetchAllocationHistory(new URLSearchParams({ payment_id: String(historyPayment.id) }))
        .then(setPaymentAllocationHistory)
        .catch(() => setPaymentAllocationHistory([]));
    }
  };

  const handleReverseAllocation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!reverseAllocation || reverseAllocation.reversed_at || isReversingAllocation) return;

    const formData = new FormData(e.currentTarget);
    const note = String(formData.get('note') || '').trim();
    if (note.length < 3) return;
    setIsReversingAllocation(true);
    const res = await fetch(`/api/finance/payment-allocations/${reverseAllocation.id}/reverse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Abono reversado y saldos recalculados.', type: 'success' });
      setReverseAllocation(null);
      await refreshAllocationHistoryPanels();
    } else {
      setToast({ message: result.error || 'No se pudo reversar el abono.', type: 'error' });
    }
    setIsReversingAllocation(false);
  };

  const handleCreateCollectionAction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!collectionPayment) return;

    const formData = new FormData(e.currentTarget);
    setIsSavingCollectionAction(true);
    const res = await fetch(`/api/finance/payments/${collectionPayment.id}/collection-actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: formData.get('channel'),
        note: formData.get('note'),
        next_action_at: formData.get('next_action_at') || null,
      }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Gestión de cobranza registrada.', type: 'success' });
      e.currentTarget.reset();
      const [actions] = await Promise.all([
        fetchCollectionActions(collectionPayment.id),
        fetchData(),
      ]);
      setCollectionActions(actions);
    } else {
      setToast({ message: result.error || 'No se pudo registrar la gestión.', type: 'error' });
    }
    setIsSavingCollectionAction(false);
  };

  const handleCreatePaymentAdjustment = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!adjustmentPayment) return;

    const formData = new FormData(e.currentTarget);
    setIsSavingAdjustment(true);
    const res = await fetch(`/api/finance/payments/${adjustmentPayment.id}/adjustments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: formData.get('type'),
        amount: formData.get('amount'),
        reason: formData.get('reason'),
      }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Ajuste financiero registrado con motivo.', type: 'success' });
      setAdjustmentPayment(null);
      await fetchData();
      if (paymentDetail?.payment.id === adjustmentPayment.id) {
        await openPaymentDetail({ ...adjustmentPayment, amount: result.adjustment.newAmount, status: result.adjustment.status });
      }
    } else {
      setToast({ message: result.error || 'No se pudo registrar el ajuste.', type: 'error' });
    }
    setIsSavingAdjustment(false);
  };

  const handleCompleteCollectionAction = async (action: CollectionAction) => {
    if (action.status === 'done' || isSavingCollectionAction) return;

    setIsSavingCollectionAction(true);
    const res = await fetch(`/api/finance/collection-actions/${action.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Seguimiento cerrado desde finanzas' }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Seguimiento cerrado.', type: 'success' });
      if (collectionPayment) {
        const [actions] = await Promise.all([
          fetchCollectionActions(collectionPayment.id),
          fetchData(),
        ]);
        setCollectionActions(actions);
      } else {
        await fetchData();
      }
    } else {
      setToast({ message: result.error || 'No se pudo cerrar el seguimiento.', type: 'error' });
    }
    setIsSavingCollectionAction(false);
  };

  const handleSaveExpense = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const receiptFile = formData.get('receipt') as File | null;

    setIsSavingExpense(true);
    try {
      const receipt = receiptFile && receiptFile.size > 0 ? await fileToReceipt(receiptFile) : undefined;
      const payload = {
        date: formData.get('date'),
        category: formData.get('category'),
        branch_id: formData.get('branch_id') || null,
        cost_center: formData.get('cost_center') || 'general',
        supplier_name: formData.get('supplier_name'),
        supplier_rut: formData.get('supplier_rut'),
        description: formData.get('description'),
        amount_net: formData.get('amount_net') || undefined,
        tax_amount: formData.get('tax_amount') || undefined,
        amount_total: formData.get('amount_total'),
        document_type: formData.get('document_type'),
        document_number: formData.get('document_number'),
        payment_method: formData.get('payment_method') || null,
        payment_status: formData.get('payment_status'),
        paid_at: formData.get('paid_at') || null,
        due_date: formData.get('due_date') || null,
        notes: formData.get('notes'),
        receipt,
      };
      const res = await fetch(editingExpense ? `/api/finance/expenses/${editingExpense.id}` : '/api/finance/expenses', {
        method: editingExpense ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (res.ok) {
        setToast({ message: editingExpense ? 'Gasto actualizado.' : 'Gasto registrado.', type: 'success' });
        setIsExpenseDrawerOpen(false);
        setEditingExpense(null);
        setSelectedExpenseReceiptName('');
        fetchData();
      } else {
        setToast({ message: result.error || 'No se pudo guardar el gasto.', type: 'error' });
      }
    } catch (error: any) {
      setToast({ message: error.message || 'No se pudo leer el comprobante.', type: 'error' });
    } finally {
      setIsSavingExpense(false);
    }
  };

  const closeExpensePaymentDialog = () => {
    setExpensePaymentAction(null);
    setExpensePaymentNote('');
  };

  const handleMarkExpensePaid = async () => {
    if (!expensePaymentAction) return;

    setIsSavingExpense(true);
    const res = await fetch(`/api/finance/expenses/${expensePaymentAction.id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_status: 'paid',
        paid_at: new Date().toISOString().slice(0, 10),
        payment_method: expensePaymentAction.payment_method || 'transfer',
        notes: expensePaymentNote,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Gasto marcado como pagado.', type: 'success' });
      closeExpensePaymentDialog();
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo actualizar el gasto.', type: 'error' });
    }
    setIsSavingExpense(false);
  };

  const handleApproveExpense = async (expense: Expense, approval_status: 'approved' | 'rejected') => {
    const note = window.prompt(approval_status === 'approved' ? 'Motivo de aprobación del gasto' : 'Motivo de rechazo del gasto');
    if (!note?.trim()) {
      setToast({ message: 'Debes ingresar una nota para cambiar aprobación.', type: 'error' });
      return;
    }

    setIsSavingExpense(true);
    const res = await fetch(`/api/finance/expenses/${expense.id}/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approval_status, note: note.trim() }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: approval_status === 'approved' ? 'Gasto aprobado.' : 'Gasto rechazado.', type: 'success' });
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo actualizar la aprobación.', type: 'error' });
    }
    setIsSavingExpense(false);
  };

  const handleSaveBudget = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setIsSavingBudget(true);
    const res = await fetch('/api/finance/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: reportMonth,
        category: formData.get('category'),
        planned_amount: formData.get('planned_amount'),
        notes: formData.get('notes'),
      }),
    });
    const result = await res.json();

    if (res.ok) {
      setToast({ message: 'Presupuesto actualizado.', type: 'success' });
      e.currentTarget.reset();
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo guardar el presupuesto.', type: 'error' });
    }
    setIsSavingBudget(false);
  };

  const handleCloseMonth = async () => {
    setIsClosingMonth(true);
    const res = await fetch('/api/finance/monthly-closures', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        month: reportMonth,
        accepted_pending_note: monthlyCloseNote,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({
        message: result.notificationTaskId ? 'Mes cerrado y tarea de pendientes creada.' : 'Mes cerrado correctamente.',
        type: 'success',
      });
      setMonthlyCloseNote('');
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo cerrar el mes.', type: 'error' });
    }
    setIsClosingMonth(false);
  };

  const handleReopenMonth = async () => {
    setIsClosingMonth(true);
    const res = await fetch(`/api/finance/monthly-closures/${reportMonth}/reopen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: monthlyReopenReason }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Mes reabierto y tarea de revisión creada.', type: 'success' });
      setMonthlyReopenReason('');
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo reabrir el mes.', type: 'error' });
    }
    setIsClosingMonth(false);
  };

  const handleReconcileExpenseMovement = async (movement: BankMovement) => {
    if (!reconcilingExpense) return;

    setIsReconcilingExpense(true);
    const res = await fetch(`/api/finance/expenses/${reconcilingExpense.id}/reconcile-bank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bank_movement_id: movement.id,
        note: `Gasto conciliado desde cartola: ${movement.description}`,
      }),
    });
    const result = await res.json();
    if (res.ok) {
      setToast({ message: 'Gasto conciliado con cartola bancaria.', type: 'success' });
      setReconcilingExpense(null);
      setExpenseMovementSuggestions([]);
      fetchData();
    } else {
      setToast({ message: result.error || 'No se pudo conciliar el gasto.', type: 'error' });
    }
    setIsReconcilingExpense(false);
  };

  const openCollectionPaymentFromAction = (action: CollectionAction) => {
    setCollectionPayment({
      id: action.payment_id,
      contract_id: Number(action.contract_id_display || 0),
      amount: Number(action.payment_amount || 0),
      due_date: action.payment_due_date || '',
      payment_date: null,
      status: action.payment_status || 'pending',
      method: null,
      reference: null,
      receipt_file_path: null,
      receipt_file_name: null,
      receipt_mime_type: null,
      client_name: action.client_name,
      client_rut: action.client_rut,
      contract_id_display: action.contract_id_display,
      remaining_amount: action.payment_remaining_amount,
    });
  };

  const handleUpdateMovement = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingMovement) return;

    const formData = new FormData(e.currentTarget);
    setIsUpdatingMovement(true);
    const res = await fetch(`/api/finance/bank-movements/${editingMovement.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: formData.get('date'),
        description: formData.get('description'),
        rut: formData.get('rut'),
        amount: formData.get('amount'),
        notes: formData.get('notes'),
      }),
    });

    if (res.ok) {
      setToast({ message: 'Movimiento actualizado para revisión manual.', type: 'success' });
      setEditingMovement(null);
      setSelectedMovement(null);
      fetchData();
    } else {
      const result = await res.json();
      setToast({ message: result.error || 'No se pudo actualizar el movimiento', type: 'error' });
    }
    setIsUpdatingMovement(false);
  };

  const handleMarkMovementPartial = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!editingMovement) return;

    const form = e.currentTarget.form;
    const note = String(new FormData(form || undefined).get('notes') || '').trim();
    if (note.length < 3) {
      setToast({ message: 'Agrega una nota para marcar el movimiento como parcial.', type: 'error' });
      return;
    }

    setIsUpdatingMovement(true);
    const res = await fetch(`/api/finance/bank-movements/${editingMovement.id}/mark-partial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    });

    if (res.ok) {
      setToast({ message: 'Movimiento marcado como parcial con nota de seguimiento.', type: 'success' });
      setEditingMovement(null);
      setSelectedMovement(null);
      setMovementStatus('partial');
      fetchData();
    } else {
      const result = await res.json();
      setToast({ message: result.error || 'No se pudo marcar como parcial', type: 'error' });
    }
    setIsUpdatingMovement(false);
  };

  const getReportMonthEnd = () => {
    const [year, month] = reportMonth.split('-').map(Number);
    if (!year || !month) return '9999-12-31';
    return new Date(year, month, 1).toISOString().slice(0, 10);
  };

  const resetPaymentReview = () => {
    setPaymentReviewFilter('all');
    setPaymentReportMonth(null);
    setPaymentReportMonthField('any');
  };

  const resetExpenseReview = () => {
    setExpenseReviewFilter('all');
    setExpenseReportMonth(null);
    setExpenseReportMonthField('any');
  };

  const filteredPayments = payments.filter(payment => {
    const query = paymentSearch.toLowerCase();
    const matchesSearch =
      payment.client_name?.toLowerCase().includes(query) ||
      payment.id.toString().includes(query) ||
      payment.contract_id_display?.toString().includes(query) ||
      payment.due_date?.toLowerCase().includes(query) ||
      payment.payment_date?.toLowerCase().includes(query) ||
      payment.reference?.toLowerCase().includes(query);
    const matchesStatus = paymentStatus === 'all' || payment.status === paymentStatus;
    const monthEnd = getReportMonthEnd();
    const matchesReportMonth = !paymentReportMonth ||
      (paymentReportMonthField === 'due' && payment.due_date?.startsWith(paymentReportMonth)) ||
      (paymentReportMonthField === 'paid' && payment.payment_date?.startsWith(paymentReportMonth)) ||
      (paymentReportMonthField === 'any' && (payment.due_date?.startsWith(paymentReportMonth) || payment.payment_date?.startsWith(paymentReportMonth)));
    const matchesReview =
      paymentReviewFilter === 'all' ||
      (paymentReviewFilter === 'open-to-close' && payment.due_date < monthEnd && ['pending', 'overdue'].includes(payment.status)) ||
      (paymentReviewFilter === 'manual-without-receipt' && payment.status === 'paid' && ['cash', 'card'].includes(payment.method || '') && !payment.receipt_file_path);
    return matchesSearch && matchesStatus && matchesReportMonth && matchesReview;
  });

  const suggestionByPaymentId = new Map<number, MovementSuggestion>(
    movementSuggestions.map(suggestion => [suggestion.payment_id, suggestion])
  );
  const pendingReconcilePayments = payments
    .filter(payment => payment.status !== 'paid')
    .sort((a, b) => (suggestionByPaymentId.get(b.id)?.score || 0) - (suggestionByPaymentId.get(a.id)?.score || 0));
  const pendingMovementsCount = movements.filter(movement => movement.status === 'pending').length;
  const partialMovementsCount = movements.filter(movement => movement.status === 'partial').length;
  const reconciledMovementsCount = movements.filter(movement => movement.status === 'reconciled').length;
  const todayIso = new Date().toISOString().slice(0, 10);
  const overdueReceivables = payments
    .filter(payment => payment.status === 'overdue')
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const unmanagedOverdueReceivables = overdueReceivables.filter(payment => Number(payment.open_collection_actions_count || 0) === 0);
  const overdueReceivablesTotal = overdueReceivables.reduce((sum, payment) => sum + Number(payment.remaining_amount ?? payment.amount ?? 0), 0);
  const openCollectionCount = openCollectionQueue.length;
  const overdueCollectionCount = openCollectionQueue.filter(action => action.next_action_at && action.next_action_at < todayIso).length;
  const todayCollectionCount = openCollectionQueue.filter(action => action.next_action_at === todayIso).length;
  const pendingExpenseCount = expenses.filter(expense => expense.payment_status === 'pending').length;
  const overdueExpenseCount = expenses.filter(expense => expense.payment_status === 'overdue').length;
  const todayExpenseCount = expenses.filter(expense => expense.payment_status === 'pending' && expense.due_date === todayIso).length;
  const hasPaymentFilters = paymentSearch.trim().length > 0 || paymentStatus !== 'all' || paymentReviewFilter !== 'all' || Boolean(paymentReportMonth);
  const hasExpenseFilters = expenseStatus !== 'all' || expenseCategory !== 'all' || expenseDueFilter !== 'all' || expenseReviewFilter !== 'all' || Boolean(expenseReportMonth);
  const hasMovementFilters = movementSearch.trim().length > 0 || movementStatus !== 'all' || Boolean(movementReportMonth);
  const hasReportActivity = Boolean(
    Number(monthlyCloseReport?.collectedCount || 0) ||
    Number(monthlyCloseReport?.paidExpensesCount || 0) ||
    Number(monthlyCloseReport?.billedCount || 0) ||
    Number(monthlyCloseReport?.accruedExpensesCount || 0) ||
    (budgetReport?.rows ?? []).length ||
    (cashFlowReport?.buckets ?? []).length
  );
  const expenseCategoryLabels: Record<Expense['category'], string> = {
    rent: 'Arriendo',
    maintenance: 'Mantención',
    utilities: 'Servicios',
    payroll: 'Sueldos',
    supplies: 'Insumos',
    taxes: 'Impuestos',
    admin: 'Administración',
    other: 'Otros',
  };
  const operationalStatusLabels: Record<string, string> = {
    ok: 'Listo',
    warning: 'Con observaciones',
    critical: 'Bloqueado',
  };
  const operationalStatusClasses: Record<string, string> = {
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    critical: 'bg-red-50 text-red-700 border-red-200',
  };
  const paymentReviewLabels: Record<PaymentReviewFilter, string> = {
    all: '',
    'open-to-close': 'Cobros abiertos al cierre',
    'manual-without-receipt': 'Pagos manuales sin respaldo',
  };
  const expenseReviewLabels: Record<ExpenseReviewFilter, string> = {
    all: '',
    'open-to-close': 'Gastos abiertos al cierre',
    'paid-without-receipt': 'Gastos pagados sin respaldo',
    'without-due-date': 'Gastos sin vencimiento',
  };
  const handleTabChange = (tabId: FinanceTab) => {
    setActiveTab(tabId);
    if (tabId === 'payments') {
      setSearchParams({});
    } else {
      setSearchParams({ tab: tabId });
    }
  };

  const handleOperationalCheckClick = (checkId: string) => {
    if (checkId === 'bank-pending') {
      handleTabChange('cgvc');
      setMovementStatus('pending');
      setMovementSearch('');
      setMovementReportMonth(reportMonth);
      setSelectedMovement(null);
      return;
    }
    if (checkId === 'bank-partial') {
      handleTabChange('cgvc');
      setMovementStatus('partial');
      setMovementSearch('');
      setMovementReportMonth(reportMonth);
      setSelectedMovement(null);
      return;
    }
    if (checkId === 'open-receivables') {
      handleTabChange('payments');
      setPaymentStatus('all');
      setPaymentSearch('');
      setPaymentReportMonth(reportMonth);
      setPaymentReportMonthField('due');
      setPaymentReviewFilter('open-to-close');
      return;
    }
    if (checkId === 'manual-payments-without-receipt') {
      handleTabChange('payments');
      setPaymentStatus('paid');
      setPaymentSearch('');
      setPaymentReportMonth(reportMonth);
      setPaymentReportMonthField('paid');
      setPaymentReviewFilter('manual-without-receipt');
      return;
    }
    if (checkId === 'open-expenses') {
      handleTabChange('expenses');
      setExpenseStatus('all');
      setExpenseDueFilter('all');
      setExpenseCategory('all');
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField('any');
      setExpenseReviewFilter('open-to-close');
      return;
    }
    if (checkId === 'paid-expenses-without-receipt') {
      handleTabChange('expenses');
      setExpenseStatus('paid');
      setExpenseDueFilter('all');
      setExpenseCategory('all');
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField('paid');
      setExpenseReviewFilter('paid-without-receipt');
      return;
    }
    if (checkId === 'expenses-without-due-date') {
      handleTabChange('expenses');
      setExpenseStatus('all');
      setExpenseDueFilter('all');
      setExpenseCategory('all');
      setExpenseReportMonth(reportMonth);
      setExpenseReportMonthField('date');
      setExpenseReviewFilter('without-due-date');
      return;
    }
    if (checkId === 'collection-actions-overdue') {
      handleTabChange('collections');
      setCollectionQueueStatus('open');
      setCollectionQueueDue('actionable');
    }
  };

  const openReportPayments = (status: string, field: PaymentReportMonthField, month = reportMonth) => {
    handleTabChange('payments');
    setPaymentStatus(status);
    setPaymentSearch('');
    setPaymentReportMonth(month);
    setPaymentReportMonthField(field);
    setPaymentReviewFilter('all');
  };

  const openReportExpenses = (status: typeof expenseStatus, field: ExpenseReportMonthField, month = reportMonth) => {
    handleTabChange('expenses');
    setExpenseStatus(status);
    setExpenseDueFilter('all');
    setExpenseCategory('all');
    setExpenseReportMonth(month);
    setExpenseReportMonthField(field);
    setExpenseReviewFilter('all');
  };

  const openReportMovements = (status: typeof movementStatus, month = reportMonth) => {
    handleTabChange('cgvc');
    setMovementStatus(status);
    setMovementSearch('');
    setMovementReportMonth(month);
    setSelectedMovement(null);
  };
  const budgetByCategory = new Map<Expense['category'], FinancialBudget>(budgets.map(budget => [budget.category, budget]));
  const collectibleTotal = Number(summary?.totalCollected || 0) + Number(summary?.totalPending || 0) + Number(summary?.totalOverdue || 0);
  const collectionProgress = collectibleTotal > 0
    ? Math.round((Number(summary?.totalCollected || 0) / collectibleTotal) * 100)
    : 0;
  const filteredExpenses = expenses.filter(expense => {
    const monthEnd = getReportMonthEnd();
    const matchesReportMonth = !expenseReportMonth ||
      (expenseReportMonthField === 'date' && expense.date?.startsWith(expenseReportMonth)) ||
      (expenseReportMonthField === 'paid' && expense.paid_at?.startsWith(expenseReportMonth)) ||
      (expenseReportMonthField === 'any' && (expense.date?.startsWith(expenseReportMonth) || expense.due_date?.startsWith(expenseReportMonth) || expense.paid_at?.startsWith(expenseReportMonth)));
    return (
      matchesReportMonth &&
      expenseReviewFilter === 'all' ||
      (matchesReportMonth && expenseReviewFilter === 'open-to-close' && Boolean(expense.due_date) && String(expense.due_date) < monthEnd && ['pending', 'overdue'].includes(expense.payment_status)) ||
      (matchesReportMonth && expenseReviewFilter === 'paid-without-receipt' && expense.payment_status === 'paid' && ['invoice', 'receipt', 'ticket'].includes(expense.document_type) && !expense.receipt_file_path) ||
      (matchesReportMonth && expenseReviewFilter === 'without-due-date' && ['pending', 'overdue'].includes(expense.payment_status) && !expense.due_date)
    );
  });
  const filteredMovements = movements.filter(movement => {
    const query = movementSearch.toLowerCase();
    const matchesSearch =
      movement.description?.toLowerCase().includes(query) ||
      movement.rut?.toLowerCase().includes(query) ||
      movement.notes?.toLowerCase().includes(query) ||
      movement.date?.toLowerCase().includes(query) ||
      movement.amount.toString().includes(query);
    const matchesStatus = movementStatus === 'all'
      || (movementStatus === 'attention' && ['pending', 'partial'].includes(movement.status))
      || movement.status === movementStatus;
    const matchesReportMonth = !movementReportMonth || movement.date?.startsWith(movementReportMonth);
    return matchesSearch && matchesStatus && matchesReportMonth;
  });
  const filteredInvoices = invoices.filter(invoice => invoiceStatus === 'all' || invoice.status_sii === invoiceStatus);
  const pendingInvoicesCount = invoices.filter(invoice => invoice.status_sii === 'pending').length;
  const acceptedInvoicesCount = invoices.filter(invoice => invoice.status_sii === 'accepted').length;
  const rejectedInvoicesCount = invoices.filter(invoice => invoice.status_sii === 'rejected').length;

  useEffect(() => {
    if (selectedMovement && !filteredMovements.some(movement => movement.id === selectedMovement.id)) {
      setSelectedMovement(null);
    }
  }, [filteredMovements, selectedMovement]);

  const closePaymentDrawer = () => {
    setIsDrawerOpen(false);
    setSelectedPayment(null);
    setSelectedReceiptName('');
  };

  const closePaymentDetailDrawer = () => {
    setPaymentDetail(null);
  };

  const closeAdjustmentDrawer = () => {
    setAdjustmentPayment(null);
  };

  const closeMovementDrawer = () => {
    setEditingMovement(null);
  };

  const closeAllocationDrawer = () => {
    setAllocationPayment(null);
  };

  const closeHistoryDrawer = () => {
    setHistoryPayment(null);
  };

  const closeReverseDrawer = () => {
    setReverseAllocation(null);
  };

  const closeCollectionDrawer = () => {
    setCollectionPayment(null);
  };

  const openExpenseDrawer = (expense?: Expense) => {
    setEditingExpense(expense || null);
    setSelectedExpenseReceiptName('');
    setIsExpenseDrawerOpen(true);
  };

  const closeExpenseDrawer = () => {
    setIsExpenseDrawerOpen(false);
    setEditingExpense(null);
    setSelectedExpenseReceiptName('');
  };

  const closeExpenseReconcileDrawer = () => {
    setReconcilingExpense(null);
    setExpenseMovementSuggestions([]);
  };

  useEffect(() => {
    const paymentId = Number(searchParams.get('paymentId') || 0);
    const expenseId = Number(searchParams.get('expenseId') || 0);
    if (!(paymentId > 0) && !(expenseId > 0)) {
      focusedQueryRef.current = '';
      return;
    }

    if (paymentId > 0) {
      const key = `payment:${paymentId}`;
      if (focusedQueryRef.current === key) return;
      focusedQueryRef.current = key;
      setActiveTab('payments');
      setPaymentSearch('');
      setPaymentStatus('all');
      resetPaymentReview();
      openPaymentDetailById(paymentId);
      return;
    }

    if (expenseId > 0) {
      const key = `expense:${expenseId}`;
      if (focusedQueryRef.current === key) return;
      focusedQueryRef.current = key;
      setActiveTab('expenses');
      setExpenseStatus('all');
      setExpenseCategory('all');
      setExpenseDueFilter('all');
      resetExpenseReview();
      openExpenseDrawerById(expenseId);
    }
  }, [searchParams, payments, expenses]);

  const getBankMovementExportParams = () => {
    if (movementStatus === 'all') return '';
    if (movementStatus === 'attention') return '?status=pending&status=partial';
    return `?status=${movementStatus}`;
  };

  const getBankMovementExportName = () => {
    if (movementStatus === 'all') return 'cartola-bancaria.xlsx';
    return `cartola-bancaria-${movementStatus}.xlsx`;
  };

  const renderTabActions = () => {
    if (activeTab === 'payments') {
      return (
        <button
            onClick={() => downloadFile(
            withBranch(`/api/finance/export/payments.xlsx${paymentStatus === 'all' ? '' : `?status=${paymentStatus}`}`),
            paymentStatus === 'all' ? 'cuentas-por-cobrar.xlsx' : `cuentas-por-cobrar-${paymentStatus}.xlsx`
          )}
          className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
        >
          <Download className="w-4 h-4" />
          Exportar Cuentas
        </button>
      );
    }

    if (activeTab === 'expenses') {
      return (
        <>
          <button
            onClick={() => downloadFile(withBranch('/api/finance/export/expenses.xlsx'), 'gastos.xlsx')}
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <Download className="w-4 h-4" />
            Exportar Gastos
          </button>
          <button onClick={() => openExpenseDrawer()} className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all">
            <FileText className="w-4 h-4" />
            Nuevo Gasto
          </button>
        </>
      );
    }

    if (activeTab === 'cgvc') {
      return (
        <>
          <label className={cn(
            "px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all",
            isImportingBank && "opacity-50 pointer-events-none"
          )}>
            <UploadCloud className="w-4 h-4" />
            Importar CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleImportBankMovements}
              disabled={isImportingBank}
            />
          </label>
          <button
            onClick={handleSyncBank}
            disabled={isSyncing}
            className="px-5 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-lg flex items-center gap-2 hover:bg-slate-800 transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4", isSyncing && "animate-spin")} />
            Conciliar Importados
          </button>
          <button
            onClick={() => downloadFile(
              `/api/finance/export/bank-movements.xlsx${getBankMovementExportParams()}`,
              getBankMovementExportName()
            )}
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <Download className="w-4 h-4" />
            Exportar Cola
          </button>
        </>
      );
    }

    if (activeTab === 'invoices') {
      return (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className={cn(
            "rounded-2xl px-4 py-3 text-xs font-bold uppercase tracking-wider",
            siiReadiness?.mode === 'disabled' ? "bg-slate-100 text-slate-500" :
              siiReadiness?.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          )}>
            {siiReadiness?.mode === 'real' ? 'Proveedor real no implementado' : siiReadiness?.mode === 'disabled' ? 'SII deshabilitado' : 'Mock local, sin envío real'}
          </span>
          <button
            onClick={() => refreshInvoices().catch(() => setToast({ message: 'No se pudo actualizar el estado DTE.', type: 'error' }))}
            className="px-5 py-3 bg-white border border-slate-200 text-slate-900 rounded-2xl text-sm font-bold shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Actualizar estado DTE
          </button>
        </div>
      );
    }

    return null;
  };

  const tabActions = renderTabActions();

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8">
      <AnimatePresence>
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestión Financiera</h2>
          <p className="text-slate-500 mt-1">Control de cobranza, conciliación y facturación SII.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-widest text-slate-400">
          Sucursal
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="min-w-[220px] rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold normal-case tracking-normal text-slate-700 outline-none transition-all hover:bg-slate-50"
          >
            <option value="all">Todas las sucursales</option>
            {branches.map(branch => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-card p-6 border-l-4 border-l-blue-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total por Cobrar (Mes)</p>
          <p className="text-2xl font-bold">${summary?.totalPending.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3" /> Próximos vencimientos
          </p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-emerald-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Recaudado</p>
          <p className="text-2xl font-bold text-emerald-600">${summary?.totalCollected.toLocaleString()}</p>
          <p className="text-xs text-emerald-600 mt-2 font-medium">{collectionProgress}% de cuentas cobrables cerradas</p>
        </div>
        <div className="glass-card p-6 border-l-4 border-l-red-500">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Morosidad</p>
          <p className="text-2xl font-bold text-red-600">${summary?.totalOverdue.toLocaleString()}</p>
          <p className="text-xs text-red-600 mt-2 font-medium">{summary?.overdueClientsCount} clientes atrasados · ${Number(summary?.overdueExpenses || 0).toLocaleString()} gastos vencidos</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 gap-6 md:gap-8 overflow-x-auto" role="tablist" aria-label="Gestión financiera">
        {[
          { id: 'payments', label: 'Cuentas por Cobrar', icon: CreditCard },
          { id: 'collections', label: 'Cobranza', icon: Send },
          { id: 'expenses', label: 'Gastos', icon: FileText },
          { id: 'cgvc', label: 'Cartola Bancaria', icon: RefreshCw },
          { id: 'invoices', label: 'Facturación SII', icon: FileJson },
          { id: 'reports', label: 'Reportes', icon: Download }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id as FinanceTab)}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn(
              "pb-4 text-sm font-bold transition-all relative flex items-center gap-2 whitespace-nowrap",
              activeTab === tab.id ? "text-slate-900" : "text-slate-400 hover:text-slate-600"
            )}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
            {activeTab === tab.id && (
              <motion.div layoutId="financeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-slate-900" />
            )}
          </button>
        ))}
      </div>

      {tabActions && (
        <div className="flex flex-wrap justify-end gap-3 -mt-3">
          {tabActions}
        </div>
      )}

      {/* Tab Content */}
      <div className="min-h-[500px]">
        {activeTab === 'payments' && (
          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Search className="w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por Cliente o Contrato..."
                  className="bg-transparent border-none outline-none text-sm w-full"
                  value={paymentSearch}
                  onChange={(e) => { setPaymentSearch(e.target.value); resetPaymentReview(); }}
                />
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={paymentStatus}
                  onChange={(e) => { setPaymentStatus(e.target.value); resetPaymentReview(); }}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="all">Todos</option>
                  <option value="pending">Pendientes</option>
                  <option value="overdue">Atrasados</option>
                  <option value="paid">Pagados</option>
                  <option value="cancelled">Cancelados</option>
                </select>
              </div>
            </div>
            {(paymentReviewFilter !== 'all' || paymentReportMonth) && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm font-bold text-blue-700">
                  {paymentReviewFilter !== 'all' ? paymentReviewLabels[paymentReviewFilter] : 'Pagos filtrados desde reporte'}
                  {paymentReportMonth ? ` · Mes ${paymentReportMonth}` : ''}
                  {paymentReportMonthField === 'due' ? ' · Fecha vencimiento' : paymentReportMonthField === 'paid' ? ' · Fecha pago' : ''}
                  · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                </p>
                <button onClick={resetPaymentReview} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                  Limpiar filtro
                </button>
              </div>
            )}

            <div className="glass-card overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">ID Pago</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Vencimiento</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Monto</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">Cargando cuentas por cobrar...</td>
                    </tr>
                  )}
                  {!isLoading && loadError && (
                    <tr>
                      <td colSpan={6} className="px-6 py-10 text-center text-sm text-red-500">{loadError}</td>
                    </tr>
                  )}
                  {!isLoading && !loadError && filteredPayments.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <FinanceEmptyState
                          title={hasPaymentFilters ? 'No hay cuentas por cobrar para esos filtros.' : 'Sin cuentas por cobrar cargadas.'}
                          description={hasPaymentFilters ? 'Limpia filtros o cambia el estado para revisar toda la cartera.' : 'Las cuentas aparecerán cuando existan contratos con cobros emitidos.'}
                          action={hasPaymentFilters ? (
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentSearch('');
                                setPaymentStatus('all');
                                resetPaymentReview();
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              Limpiar filtros
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleTabChange('reports')}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                            >
                              Ver reportes
                            </button>
                          )}
                        />
                      </td>
                    </tr>
                  )}
                  {!isLoading && !loadError && filteredPayments.map(p => (
                    <tr key={p.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-mono text-slate-400">#PAG-{p.id.toString().padStart(4, '0')}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold">{p.client_name}</p>
                        <p className="text-xs text-slate-500">Contrato #CON-{p.contract_id_display?.toString().padStart(3, '0')}</p>
                        {p.branch_name && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{p.branch_name}</p>}
                        {p.latest_collection_note && (
                          <p className="text-xs text-blue-700 mt-1 max-w-[260px]">{p.latest_collection_note}</p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">{new Date(p.due_date).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold">${p.amount.toLocaleString()}</p>
                        {(p.allocated_amount || 0) > 0 && (
                          <p className="text-[10px] font-bold text-slate-400">
                            Abonado ${Number(p.allocated_amount || 0).toLocaleString()} · Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          p.status === 'paid' ? "bg-emerald-100 text-emerald-600" :
                            p.status === 'overdue' ? "bg-red-100 text-red-600" :
                              p.status === 'cancelled' ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-600"
                        )}>
                          {p.status === 'paid' ? 'Pagado' : p.status === 'overdue' ? 'Atrasado' : p.status === 'cancelled' ? 'Cancelado' : 'Pendiente'}
                        </span>
                        {(p.open_collection_actions_count || 0) > 0 && (
                          <p className="text-[10px] font-bold text-blue-600 mt-1">
                            {p.open_collection_actions_count} seguimiento{Number(p.open_collection_actions_count) === 1 ? '' : 's'}
                            {p.next_collection_action_at ? ` · ${p.next_collection_action_at}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button
                          onClick={() => openPaymentDetail(p)}
                          className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                        >
                          Ficha
                        </button>
                        {p.status !== 'paid' && p.status !== 'cancelled' && (
                          <>
                            <button
                              onClick={() => { openCollectionDrawer(p); }}
                              className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                            >
                              Cobranza
                            </button>
                            <button
                              onClick={() => { setSelectedPayment(p); setIsDrawerOpen(true); }}
                              className="text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all"
                            >
                              Registrar Pago
                            </button>
                            {isAdmin ? (
                              <button
                                onClick={() => setAdjustmentPayment(p)}
                                className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-all"
                              >
                                Ajuste
                              </button>
                            ) : (
                              <button
                                onClick={() => requestAdminApproval(`ajuste de pago #PAG-${p.id.toString().padStart(4, '0')}`, { source_type: 'finance_payment_adjustment', source_id: p.id, source_label: 'Pago' })}
                                className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-all"
                              >
                                Solicitar aprobación
                              </button>
                            )}
                          </>
                        )}
                        {p.status === 'paid' && p.receipt_file_path && (
                          <a
                            href={`/api/finance/payments/${p.id}/receipt`}
                            className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Comprobante
                          </a>
                        )}
                        {(p.allocated_amount || 0) > 0 && (
                          <button
                            onClick={() => setHistoryPayment(p)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            Historial
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'collections' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              <button
                onClick={() => {
                  setPaymentStatus('overdue');
                  setPaymentSearch('');
                  setPaymentReviewFilter('all');
                  handleTabChange('payments');
                }}
                className="text-left bg-white border border-red-200 rounded-2xl p-4 transition-all hover:bg-red-50"
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cuentas en mora</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{overdueReceivables.length}</p>
                <p className="text-xs font-semibold text-red-600 mt-1">${overdueReceivablesTotal.toLocaleString()}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('overdue'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'overdue' ? "border-red-200 bg-red-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gestiones atrasadas</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{overdueCollectionCount}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('today'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'today' ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gestiones para hoy</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{todayCollectionCount}</p>
              </button>
              <button
                onClick={() => { setCollectionQueueStatus('open'); setCollectionQueueDue('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  collectionQueueStatus === 'open' && collectionQueueDue === 'all' ? "border-slate-300 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Seguimientos abiertos</p>
                <p className="text-2xl font-bold text-slate-900 mt-1">{openCollectionCount}</p>
              </button>
            </div>

            <div className="glass-card overflow-hidden">
              <div className="flex flex-col gap-3 border-b border-slate-100 p-5 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Cuentas en mora para gestionar</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Punto de partida para iniciar cobranza desde una deuda vencida. Una gestión abierta queda luego en la cola de seguimiento.
                  </p>
                </div>
                {unmanagedOverdueReceivables.length > 0 && (
                  <span className="w-fit rounded-full bg-red-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-red-600">
                    {unmanagedOverdueReceivables.length} sin gestión abierta
                  </span>
                )}
              </div>

              {overdueReceivables.length === 0 ? (
                <FinanceEmptyState
                  title="No hay cuentas morosas."
                  description="Cuando una cuenta por cobrar quede atrasada, aparecerá aquí para iniciar contacto de cobranza."
                />
              ) : (
                <div className="divide-y divide-slate-100">
                  {overdueReceivables.slice(0, 8).map(payment => {
                    const daysOverdue = Math.max(0, Math.floor((new Date(todayIso).getTime() - new Date(payment.due_date).getTime()) / (1000 * 60 * 60 * 24)));
                    const openActions = Number(payment.open_collection_actions_count || 0);
                    return (
                      <div key={payment.id} className="flex flex-col gap-4 p-5 transition-colors hover:bg-slate-50 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-slate-900">{payment.client_name}</p>
                            <span className="rounded-lg bg-red-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700">
                              {daysOverdue} día{daysOverdue === 1 ? '' : 's'} de atraso
                            </span>
                            {openActions > 0 && (
                              <span className="rounded-lg bg-blue-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">
                                {openActions} seguimiento{openActions === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs text-slate-500">
                            Pago #PAG-{payment.id.toString().padStart(4, '0')} · Contrato #CON-{payment.contract_id_display?.toString().padStart(3, '0')} · Venció {payment.due_date}
                          </p>
                          {payment.latest_collection_note && (
                            <p className="mt-2 max-w-3xl text-xs text-blue-700">{payment.latest_collection_note}</p>
                          )}
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
                          <div className="text-left sm:text-right">
                            <p className="text-sm font-bold text-red-600">${Number(payment.remaining_amount ?? payment.amount ?? 0).toLocaleString()}</p>
                            <p className="text-xs text-slate-500">Saldo pendiente</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openCollectionDrawer(payment)}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-all hover:bg-slate-800"
                          >
                            <Send className="h-4 w-4" />
                            Iniciar gestión
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {overdueReceivables.length > 8 && (
                    <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-4">
                      <p className="text-xs font-semibold text-slate-500">
                        Hay {overdueReceivables.length - 8} cuenta{overdueReceivables.length - 8 === 1 ? '' : 's'} morosa{overdueReceivables.length - 8 === 1 ? '' : 's'} adicional{overdueReceivables.length - 8 === 1 ? '' : 'es'}.
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPaymentStatus('overdue');
                          setPaymentSearch('');
                          setPaymentReviewFilter('all');
                          handleTabChange('payments');
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-100"
                      >
                        Ver todas en cuentas por cobrar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select
                  value={collectionQueueStatus}
                  onChange={(e) => setCollectionQueueStatus(e.target.value as 'open' | 'done' | 'all')}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="open">Abiertos</option>
                  <option value="done">Cerrados</option>
                  <option value="all">Todos</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <select
                  value={collectionQueueDue}
                  onChange={(e) => setCollectionQueueDue(e.target.value as 'all' | 'overdue' | 'today' | 'upcoming' | 'actionable')}
                  className="bg-transparent border-none outline-none text-sm font-medium"
                >
                  <option value="all">Todas las fechas</option>
                  <option value="actionable">Atrasadas o de hoy</option>
                  <option value="overdue">Atrasadas</option>
                  <option value="today">Hoy</option>
                  <option value="upcoming">Próximas</option>
                </select>
              </div>
            </div>

            <div className="glass-card divide-y divide-slate-100">
              {isLoading && (
                <p className="p-8 text-center text-sm text-slate-500">Cargando cola de cobranza...</p>
              )}
              {!isLoading && collectionQueue.length === 0 && (
                <FinanceEmptyState
                  title={collectionQueueStatus === 'open' ? 'No hay gestiones abiertas.' : 'No hay gestiones para esos filtros.'}
                  description={collectionQueueStatus === 'open' ? 'La cobranza pendiente está al día. Cuando se registre una gestión futura aparecerá aquí.' : 'Ajusta estado o fecha para revisar el historial de cobranza.'}
                  action={
                    <button
                      type="button"
                      onClick={() => {
                        setCollectionQueueStatus('all');
                        setCollectionQueueDue('all');
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                    >
                      Ver todas las gestiones
                    </button>
                  }
                />
              )}
              {!isLoading && collectionQueue.map(action => {
                const isOverdue = action.status === 'open' && action.next_action_at && action.next_action_at < todayIso;
                const isToday = action.status === 'open' && action.next_action_at === todayIso;
                return (
                  <div key={action.id} className="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4 hover:bg-slate-50 transition-colors">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-bold text-slate-900">{action.client_name}</p>
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          action.status === 'done' ? "bg-emerald-100 text-emerald-700" :
                            isOverdue ? "bg-red-100 text-red-700" :
                              isToday ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"
                        )}>
                          {action.status === 'done' ? 'Cerrado' : isOverdue ? 'Atrasado' : isToday ? 'Hoy' : 'Abierto'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">
                        Pago #PAG-{action.payment_id.toString().padStart(4, '0')} · Contrato #CON-{action.contract_id_display?.toString().padStart(3, '0')} · RUT {action.client_rut}
                      </p>
                      <p className="text-sm text-slate-700 mt-2 max-w-3xl">{action.note}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
                        <span>{action.channel === 'phone' ? 'Teléfono' : action.channel === 'whatsapp' ? 'WhatsApp' : action.channel === 'email' ? 'Email' : action.channel === 'in_person' ? 'Presencial' : 'Otro'}</span>
                        <span>{action.staff_name || 'Sistema'}</span>
                        {action.next_action_at && <span>Próxima acción: {action.next_action_at}</span>}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => copyText(action.client_phone, 'Teléfono')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          Copiar teléfono
                        </button>
                        <button
                          type="button"
                          onClick={() => copyText(action.client_email, 'Email')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition-all hover:bg-slate-50"
                        >
                          <Mail className="h-3.5 w-3.5" />
                          Copiar email
                        </button>
                        {normalizePhoneForWhatsApp(action.client_phone) && (
                          <a
                            href={`https://wa.me/${normalizePhoneForWhatsApp(action.client_phone)}?text=${encodeURIComponent(buildCollectionMessage({
                              id: action.payment_id,
                              contract_id: Number(action.contract_id_display || 0),
                              amount: Number(action.payment_amount || 0),
                              due_date: action.payment_due_date || '',
                              payment_date: null,
                              status: action.payment_status || 'pending',
                              method: null,
                              reference: null,
                              receipt_file_path: null,
                              receipt_file_name: null,
                              receipt_mime_type: null,
                              client_name: action.client_name,
                              client_rut: action.client_rut,
                              contract_id_display: action.contract_id_display,
                              remaining_amount: action.payment_remaining_amount,
                              client_email: action.client_email,
                              client_phone: action.client_phone,
                            }))}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-all hover:bg-emerald-100"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="text-left xl:text-right shrink-0">
                      <p className="text-sm font-bold text-slate-900">${Number(action.payment_remaining_amount ?? action.payment_amount ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-slate-500">Vence {action.payment_due_date}</p>
                      <div className="mt-3 flex xl:justify-end gap-2">
                        <button
                          onClick={() => openCollectionPaymentFromAction(action)}
                          className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-lg transition-all"
                        >
                          Ver Gestión
                        </button>
                        {action.status === 'open' && (
                          <button
                            onClick={() => handleCompleteCollectionAction(action)}
                            disabled={isSavingCollectionAction}
                            className="text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                          >
                            Cerrar
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={() => { setExpenseStatus('overdue'); setExpenseDueFilter('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'overdue' ? "border-red-200 bg-red-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencidos</p>
                <p className="text-2xl font-bold text-red-600 mt-1">{overdueExpenseCount}</p>
                <p className="text-xs text-red-600 mt-1">${Number(summary?.overdueExpenses || 0).toLocaleString()}</p>
              </button>
              <button
                onClick={() => { setExpenseStatus('pending'); setExpenseDueFilter('today'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'pending' && expenseDueFilter === 'today' ? "border-blue-200 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vencen Hoy</p>
                <p className="text-2xl font-bold text-blue-600 mt-1">{todayExpenseCount}</p>
                <p className="text-xs text-blue-600 mt-1">Pagos por priorizar</p>
              </button>
              <button
                onClick={() => { setExpenseStatus('pending'); setExpenseDueFilter('all'); }}
                className={cn(
                  "text-left bg-white border rounded-2xl p-4 transition-all",
                  expenseStatus === 'pending' && expenseDueFilter === 'all' ? "border-amber-200 bg-amber-50" : "border-slate-200 hover:bg-slate-50"
                )}
              >
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pendientes</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">{pendingExpenseCount}</p>
                <p className="text-xs text-amber-600 mt-1">${Number(summary?.pendingExpenses || 0).toLocaleString()}</p>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gastos Pagados</p>
                <p className="text-2xl font-bold text-red-600 mt-1">${Number(profitabilityReport?.totalPaidExpenses || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gastos Pendientes</p>
                <p className="text-2xl font-bold text-amber-600 mt-1">${Number(profitabilityReport?.totalPendingExpenses || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Caja Proyectada</p>
                <p className={cn("text-2xl font-bold mt-1", Number(summary?.projectedCashBalance || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>${Number(summary?.projectedCashBalance || 0).toLocaleString()}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Margen Real</p>
                <p className={cn("text-2xl font-bold mt-1", Number(profitabilityReport?.netMargin || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>${Number(profitabilityReport?.netMargin || 0).toLocaleString()}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select value={expenseStatus} onChange={(e) => { setExpenseStatus(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todos</option>
                  <option value="pending">Pendientes</option>
                  <option value="overdue">Vencidos</option>
                  <option value="paid">Pagados</option>
                  <option value="cancelled">Anulados</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <FileText className="w-4 h-4 text-slate-400" />
                <select value={expenseCategory} onChange={(e) => { setExpenseCategory(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todas las categorías</option>
                  <option value="rent">Arriendo</option>
                  <option value="maintenance">Mantención</option>
                  <option value="utilities">Servicios</option>
                  <option value="payroll">Sueldos</option>
                  <option value="supplies">Insumos</option>
                  <option value="taxes">Impuestos</option>
                  <option value="admin">Administración</option>
                  <option value="other">Otros</option>
                </select>
              </div>
              <div className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <select value={expenseDueFilter} onChange={(e) => { setExpenseDueFilter(e.target.value as any); resetExpenseReview(); }} className="bg-transparent border-none outline-none text-sm font-medium">
                  <option value="all">Todas las fechas</option>
                  <option value="overdue">Vencidos</option>
                  <option value="today">Hoy</option>
                  <option value="upcoming">Próximos</option>
                </select>
              </div>
            </div>
            {(expenseReviewFilter !== 'all' || expenseReportMonth) && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="text-sm font-bold text-blue-700">
                  {expenseReviewFilter !== 'all' ? expenseReviewLabels[expenseReviewFilter] : 'Gastos filtrados desde reporte'}
                  {expenseReportMonth ? ` · Mes ${expenseReportMonth}` : ''}
                  {expenseReportMonthField === 'date' ? ' · Fecha gasto' : expenseReportMonthField === 'paid' ? ' · Fecha pago' : ''}
                  · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                </p>
                <button onClick={resetExpenseReview} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                  Limpiar filtro
                </button>
              </div>
            )}

            <div className="glass-card overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50">
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Proveedor</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Detalle</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Fecha</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Total</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!isLoading && filteredExpenses.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <FinanceEmptyState
                          title={hasExpenseFilters ? 'No hay gastos para esos filtros.' : 'Sin gastos registrados.'}
                          description={hasExpenseFilters ? 'Limpia filtros para volver a la vista completa de gastos.' : 'Registra gastos con proveedor, centro de costo y respaldo para controlar egresos reales.'}
                          action={hasExpenseFilters ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExpenseStatus('all');
                                setExpenseCategory('all');
                                setExpenseDueFilter('all');
                                resetExpenseReview();
                              }}
                              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                            >
                              Limpiar filtros
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openExpenseDrawer()}
                              className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                            >
                              Registrar gasto
                            </button>
                          )}
                        />
                      </td>
                    </tr>
                  )}
                  {filteredExpenses.map(expense => (
                    <tr key={expense.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold">{expense.supplier_name}</p>
                        <p className="text-xs text-slate-500">{expense.supplier_rut || 'Sin RUT'}</p>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-medium">{expense.description}</p>
                        <p className="text-xs text-slate-500">{expense.category} · Centro {expense.cost_center || 'general'} · {expense.document_type}{expense.document_number ? ` #${expense.document_number}` : ''}</p>
                        {expense.branch_name && <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{expense.branch_name}</p>}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">{expense.date}</td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-bold">${expense.amount_total.toLocaleString()}</p>
                        <p className="text-[10px] font-bold text-slate-400">IVA ${Number(expense.tax_amount || 0).toLocaleString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          expense.payment_status === 'paid' ? "bg-emerald-100 text-emerald-600" :
                            expense.payment_status === 'overdue' ? "bg-red-100 text-red-600" :
                              expense.payment_status === 'cancelled' ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-600"
                        )}>
                          {expense.payment_status === 'paid' ? 'Pagado' : expense.payment_status === 'overdue' ? 'Vencido' : expense.payment_status === 'cancelled' ? 'Anulado' : 'Pendiente'}
                        </span>
                        {expense.due_date && expense.payment_status !== 'paid' && <p className="text-[10px] font-bold text-slate-400 mt-1">Vence {expense.due_date}</p>}
                        <span className={cn(
                          "mt-1 inline-flex px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                          expense.approval_status === 'approved' ? "bg-blue-100 text-blue-700" :
                            expense.approval_status === 'rejected' ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"
                        )}>
                          {expense.approval_status === 'approved' ? 'Aprobado' : expense.approval_status === 'rejected' ? 'Rechazado' : 'Pendiente aprobación'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button onClick={() => openExpenseDrawer(expense)} className="text-xs font-bold text-slate-600 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-all">Editar</button>
                        {expense.payment_status !== 'paid' && expense.approval_status !== 'approved' && (
                          isAdmin ? (
                            <button onClick={() => handleApproveExpense(expense, 'approved')} disabled={isSavingExpense} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-50">Aprobar</button>
                          ) : (
                            <button onClick={() => requestAdminApproval(`aprobación del gasto #${expense.id}`, { source_type: 'finance_expense_approval', source_id: expense.id, source_label: 'Gasto' })} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">Solicitar aprobación</button>
                          )
                        )}
                        {expense.payment_status !== 'paid' && expense.payment_status !== 'cancelled' && (
                          <button onClick={() => setExpensePaymentAction(expense)} disabled={isSavingExpense || expense.approval_status !== 'approved'} title={expense.approval_status !== 'approved' ? 'Debe aprobarse antes de pagar' : 'Registrar pago'} className="text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40">Pagar</button>
                        )}
                        {expense.payment_status !== 'cancelled' && !expense.bank_movement_id && (
                          <button onClick={() => setReconcilingExpense(expense)} disabled={isReconcilingExpense || expense.approval_status !== 'approved'} title={expense.approval_status !== 'approved' ? 'Debe aprobarse antes de conciliar' : 'Conciliar contra cartola'} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all disabled:opacity-40">Cartola</button>
                        )}
                        {expense.receipt_file_path && (
                          <a href={`/api/finance/expenses/${expense.id}/receipt`} className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-all">
                            <Download className="w-3.5 h-3.5" />
                            Respaldo
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'cgvc' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="space-y-4">
              <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
                <button
                  onClick={() => { setMovementStatus('attention'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'attention' ? "border-red-200 bg-red-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Por resolver</p>
                  <p className="text-xl font-bold text-red-600 mt-1">{pendingMovementsCount + partialMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('pending'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'pending' ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pendientes</p>
                  <p className="text-xl font-bold text-amber-600 mt-1">{pendingMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('partial'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'partial' ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Parciales</p>
                  <p className="text-xl font-bold text-blue-600 mt-1">{partialMovementsCount}</p>
                </button>
                <button
                  onClick={() => { setMovementStatus('reconciled'); setMovementReportMonth(null); }}
                  className={cn(
                    "text-left rounded-2xl border p-4 transition-all",
                    movementStatus === 'reconciled' ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                  )}
                >
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Conciliados</p>
                  <p className="text-xl font-bold text-emerald-600 mt-1">{reconciledMovementsCount}</p>
                </button>
              </div>

              <div className="flex gap-3">
                <div className="flex-1 bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={movementSearch}
                    onChange={(e) => { setMovementSearch(e.target.value); setMovementReportMonth(null); }}
                    placeholder="Buscar en cartola por RUT, glosa, nota o monto..."
                    className="bg-transparent border-none outline-none text-sm w-full"
                  />
                </div>
              </div>
              {movementReportMonth && (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
                  <p className="text-sm font-bold text-blue-700">
                    Cartola filtrada desde reporte · Mes {movementReportMonth} · Corte {monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()}
                  </p>
                  <button onClick={() => setMovementReportMonth(null)} className="text-xs font-bold text-blue-700 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all">
                    Limpiar filtro
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Cartola Bancaria</h4>
                <span className="text-xs text-slate-500">{filteredMovements.length} movimientos</span>
              </div>
              <div className="glass-card divide-y divide-slate-100">
                {filteredMovements.length === 0 && (
                  <FinanceEmptyState
                    title={hasMovementFilters ? 'No hay movimientos bancarios para ese filtro.' : 'Sin movimientos bancarios importados.'}
                    description={hasMovementFilters ? 'Limpia la búsqueda o revisa otro estado de conciliación.' : 'Importa un CSV de cartola; la conciliación automática trabaja solo sobre movimientos importados.'}
                    action={hasMovementFilters ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMovementSearch('');
                          setMovementStatus('all');
                          setMovementReportMonth(null);
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                      >
                        Limpiar filtros
                      </button>
                    ) : undefined}
                  />
                )}
                {filteredMovements.map(m => (
                  <div
                    key={m.id}
                    className={cn(
                      "p-4 flex justify-between items-center hover:bg-slate-50 transition-colors",
                      selectedMovement?.id === m.id && "bg-blue-50/70"
                    )}
                  >
                    <div>
                      <p className="text-sm font-bold">{m.description}</p>
                      <p className="text-xs text-slate-500">{m.date} • RUT: {m.rut}</p>
                      {m.notes && (
                        <p className="text-xs text-amber-700 mt-1 max-w-[260px]">{m.notes}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-emerald-600">+${m.amount.toLocaleString()}</p>
                      {(m.allocated_amount || 0) > 0 && (
                        <p className="text-[10px] font-bold text-slate-400">
                          Abonado ${Number(m.allocated_amount || 0).toLocaleString()} · Saldo ${Number(m.remaining_amount || 0).toLocaleString()}
                        </p>
                      )}
                      <div className="flex items-center justify-end gap-1 mt-1">
                        {m.status === 'reconciled' ? (
                          <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Conciliado
                          </span>
                        ) : m.status === 'partial' ? (
                          <span className="text-[10px] font-bold text-blue-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Parcial
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" /> Pendiente
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end gap-2">
                        {m.status !== 'reconciled' && (
                          <button
                            onClick={() => setEditingMovement(m)}
                            className="text-[10px] font-bold px-2.5 py-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-all inline-flex items-center gap-1"
                          >
                            <Pencil className="w-3 h-3" />
                            Editar
                          </button>
                        )}
                        <button
                          onClick={() => setSelectedMovement(m)}
                          className={cn(
                            "text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all",
                            selectedMovement?.id === m.id
                              ? "bg-blue-600 text-white"
                              : "text-blue-600 hover:bg-blue-50"
                          )}
                        >
                          {selectedMovement?.id === m.id ? 'Seleccionado' : m.status === 'reconciled' ? 'Ver' : 'Seleccionar'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Cuentas por Cobrar Pendientes</h4>
                <span className="text-xs text-slate-500">
                  {selectedMovement ? `${movementSuggestions.length} sugerencias` : `${pendingReconcilePayments.length} deudas`}
                </span>
              </div>
              {selectedMovement && (
                <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3">
                  <p className="text-xs font-bold text-blue-700 uppercase tracking-wider">Movimiento seleccionado</p>
                  <p className="text-sm font-bold text-slate-900 mt-1">
                    ${selectedMovement.amount.toLocaleString()} • {selectedMovement.description}
                  </p>
                  <p className="text-xs text-slate-500">
                    RUT {selectedMovement.rut} • {selectedMovement.date} • Disponible ${Number(selectedMovement.remaining_amount ?? selectedMovement.amount).toLocaleString()}
                  </p>
                </div>
              )}
              {selectedMovement && movementAllocationHistory.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Historial del movimiento</p>
                    <span className="text-xs font-bold text-slate-500">{movementAllocationHistory.length} abonos</span>
                  </div>
                  <div className="space-y-3">
                    {movementAllocationHistory.map(allocation => (
                      <div key={allocation.id} className={cn(
                        "flex justify-between gap-4 rounded-xl px-3 py-2",
                        allocation.reversed_at ? "bg-red-50 border border-red-100" : "bg-slate-50"
                      )}>
                        <div className="min-w-0">
                          <p className={cn("text-sm font-bold", allocation.reversed_at ? "text-red-800 line-through" : "text-slate-900")}>{allocation.client_name}</p>
                          <p className="text-xs text-slate-500">
                            Pago #PAG-{allocation.payment_id.toString().padStart(4, '0')} · Contrato #CON-{allocation.contract_id_display?.toString().padStart(3, '0')}
                          </p>
                          {allocation.note && <p className="text-xs text-amber-700 mt-1">{allocation.note}</p>}
                          {allocation.reversed_note && <p className="text-xs text-red-700 mt-1">Reversado: {allocation.reversed_note}</p>}
                        </div>
                        <div className="text-right">
                          <p className={cn("text-sm font-bold whitespace-nowrap", allocation.reversed_at ? "text-red-600 line-through" : "text-emerald-600")}>${allocation.amount.toLocaleString()}</p>
                          {!allocation.reversed_at && isAdmin && (
                            <button
                              onClick={() => setReverseAllocation(allocation)}
                              disabled={isReversingAllocation}
                              className="mt-1 text-[10px] font-bold text-red-600 hover:bg-red-100 px-2 py-1 rounded-lg transition-all disabled:opacity-50"
                            >
                              Reversar
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="glass-card divide-y divide-slate-100">
                {pendingReconcilePayments.map(p => {
                  const suggestion = suggestionByPaymentId.get(p.id);
                  return (
                  <div key={p.id} className={cn(
                    "p-4 flex justify-between items-center group",
                    suggestion && "bg-emerald-50/50"
                  )}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{p.client_name}</p>
                      <p className="text-xs text-slate-500">RUT {p.client_rut} • Vence: {p.due_date}</p>
                      {suggestion && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                            Match {suggestion.score}%
                          </span>
                          {suggestion.reasons.map(reason => (
                            <span key={reason} className="px-2 py-0.5 rounded-md bg-white text-slate-500 text-[10px] font-bold border border-emerald-100">
                              {reason}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">${p.amount.toLocaleString()}</p>
                      {(p.allocated_amount || 0) > 0 && (
                        <p className="text-[10px] font-bold text-slate-400">
                          Saldo ${Number(p.remaining_amount || 0).toLocaleString()}
                        </p>
                      )}
                      <div className="mt-1 flex justify-end gap-2">
                        <button
                          onClick={() => handleManualReconcile(p)}
                          disabled={
                            !selectedMovement ||
                            Number(selectedMovement.remaining_amount ?? selectedMovement.amount) !== Number(p.remaining_amount ?? p.amount) ||
                            isReconciling
                          }
                          className="text-[10px] font-bold text-blue-600 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all disabled:text-slate-300 disabled:cursor-not-allowed"
                        >
                          {!selectedMovement
                            ? 'Seleccione cartola'
                            : Number(selectedMovement.remaining_amount ?? selectedMovement.amount) !== Number(p.remaining_amount ?? p.amount)
                              ? 'Saldo distinto'
                              : 'Vincular'}
                        </button>
                        <button
                          onClick={() => setAllocationPayment(p)}
                          disabled={!selectedMovement || Number(selectedMovement.remaining_amount ?? selectedMovement.amount) <= 0 || isAllocating}
                          className="text-[10px] font-bold text-emerald-600 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-all disabled:text-slate-300 disabled:cursor-not-allowed"
                        >
                          Abonar
                        </button>
                      </div>
                    </div>
                  </div>
                  );
                })}
                {pendingReconcilePayments.length === 0 && (
                  <FinanceEmptyState
                    title="No hay cuentas pendientes para conciliar."
                    description="Todas las cuentas por cobrar están pagadas o no existen cobros abiertos para vincular con cartola."
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-5">
            <div className={cn(
              "rounded-2xl border p-4",
              siiReadiness?.mode === 'disabled' ? "border-slate-200 bg-slate-50" :
                siiReadiness?.ready ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"
            )}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className={cn(
                    "text-sm font-bold",
                    siiReadiness?.mode === 'disabled' ? "text-slate-800" :
                      siiReadiness?.ready ? "text-emerald-900" : "text-amber-900"
                  )}>
                    {siiReadiness?.mode === 'disabled' ? 'Facturación SII deshabilitada' :
                      siiReadiness?.mode === 'real'
                        ? 'Proveedor SII real no implementado'
                        : siiReadiness?.ready ? 'Mock local listo para pruebas DTE' : 'Faltan datos para preparar DTE'}
                  </p>
                  <p className={cn(
                    "mt-1 text-sm",
                    siiReadiness?.mode === 'disabled' ? "text-slate-600" :
                      siiReadiness?.ready ? "text-emerald-800" : "text-amber-800"
                  )}>
                    {siiReadiness?.mode === 'real'
                      ? 'No se emite ni consulta SII real desde esta instalacion. Mantén el modo deshabilitado o usa mock local solo para demo/piloto.'
                      : siiReadiness?.mode === 'disabled'
                        ? 'El historial queda disponible, pero procesamiento y reintentos esperan configuración.'
                        : 'El mock local simula folio, track id, PDF y XML para pruebas; no envía ni acredita aceptación real del SII.'}
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[320px]">
                  <button onClick={() => setInvoiceStatus('pending')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'pending' ? "border-amber-300 bg-white text-amber-700" : "border-white/60 bg-white/60 text-slate-500")}>
                    Preparados<br /><span className="text-lg text-slate-900">{pendingInvoicesCount}</span>
                  </button>
                  <button onClick={() => setInvoiceStatus('accepted')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'accepted' ? "border-emerald-300 bg-white text-emerald-700" : "border-white/60 bg-white/60 text-slate-500")}>
                    Procesados<br /><span className="text-lg text-slate-900">{acceptedInvoicesCount}</span>
                  </button>
                  <button onClick={() => setInvoiceStatus('rejected')} className={cn("rounded-xl border px-3 py-2 text-xs font-bold", invoiceStatus === 'rejected' ? "border-red-300 bg-white text-red-700" : "border-white/60 bg-white/60 text-slate-500")}>
                    Rechazados<br /><span className="text-lg text-slate-900">{rejectedInvoicesCount}</span>
                  </button>
                </div>
              </div>
              {siiReadiness && !siiReadiness.ready && siiReadiness.mode !== 'disabled' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {siiReadiness.checks.filter(check => !check.ok).map(check => (
                    <span key={check.key} className="rounded-lg bg-white/70 px-3 py-1.5 text-xs font-bold text-amber-800">
                      Falta: {check.label}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'pending', label: 'Preparados' },
                { id: 'accepted', label: 'Procesados' },
                { id: 'rejected', label: 'Rechazados' },
              ].map(filter => (
                <button
                  key={filter.id}
                  onClick={() => setInvoiceStatus(filter.id as typeof invoiceStatus)}
                  className={cn(
                    "rounded-xl border px-4 py-2 text-xs font-bold transition-all",
                    invoiceStatus === filter.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="glass-card overflow-x-auto">
              <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Folio</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Tipo DTE</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Cliente</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Monto</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Estado DTE/SII</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Proveedor</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-500">Cargando documentos tributarios...</td>
                  </tr>
                )}
                {!isLoading && loadError && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-sm text-red-500">{loadError}</td>
                  </tr>
                )}
                {!isLoading && !loadError && filteredInvoices.length === 0 && (
                  <tr>
                    <td colSpan={7}>
                      <FinanceEmptyState
                        title={invoices.length === 0 ? "Sin documentos tributarios preparados." : "Sin documentos para ese estado."}
                        description={invoices.length === 0 ? "Cuando se registre un pago, quedará un DTE preparado o procesado según el proveedor configurado." : "Cambia el filtro para revisar todo el historial tributario."}
                        action={
                          <button
                            type="button"
                            onClick={() => invoices.length === 0 ? handleTabChange('payments') : setInvoiceStatus('all')}
                            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800"
                          >
                            {invoices.length === 0 ? 'Ver cuentas por cobrar' : 'Ver todos'}
                          </button>
                        }
                      />
                    </td>
                  </tr>
                )}
                {!isLoading && !loadError && filteredInvoices.map(inv => (
                  <tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-bold">#{inv.folio}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">
                        {formatDteType(inv.type, true)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold">{inv.client_name}</p>
                      <p className="text-xs text-slate-500">RUT {inv.client_rut || 'sin RUT'}</p>
                    </td>
                    <td className="px-6 py-4 text-sm font-bold">${inv.amount.toLocaleString()}</td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "h-2 w-2 rounded-full",
                            inv.status_sii === 'accepted' ? "bg-emerald-500" :
                              inv.status_sii === 'rejected' ? "bg-red-500" : "bg-amber-500"
                          )} />
                          <span className={cn(
                            "text-xs font-bold uppercase",
                            inv.status_sii === 'accepted' ? "text-emerald-600" :
                              inv.status_sii === 'rejected' ? "text-red-600" : "text-amber-600"
                          )}>
                            {getInvoiceStatusLabel(inv)}
                          </span>
                        </div>
                        {inv.status_detail && <p className="max-w-[260px] text-xs text-slate-500">{inv.status_detail}</p>}
                        {inv.rejection_reason && <p className="max-w-[260px] text-xs font-bold text-red-600">{inv.rejection_reason}</p>}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-xs font-bold text-slate-700">{inv.provider || 'local_mock'}</p>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{inv.track_id || inv.provider_mode || 'sin envío'}</p>
                      {inv.last_sync_at && <p className="text-[10px] text-slate-400">Sync {new Date(inv.last_sync_at).toLocaleString()}</p>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        {inv.status_sii !== 'accepted' && (
                          <button
                            onClick={() => handleIssueInvoice(inv)}
                            disabled={invoiceActionId === inv.id || !siiReadiness?.ready}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {invoiceActionId === inv.id ? 'Procesando' : inv.status_sii === 'rejected' ? 'Reintentar DTE' : 'Procesar DTE'}
                          </button>
                        )}
                        <button
                          onClick={() => handleSyncInvoice(inv)}
                          disabled={invoiceActionId === inv.id || !siiReadiness?.ready}
                          title={siiReadiness?.ready ? "Sincronizar estado con proveedor configurado" : "Proveedor SII no listo"}
                          className="rounded-lg border border-slate-200 p-2 text-slate-500 transition-all hover:bg-slate-50 disabled:opacity-40"
                        >
                          <RefreshCw className={cn("w-4 h-4", invoiceActionId === inv.id && "animate-spin")} />
                        </button>
                        {inv.status_sii === 'accepted' && inv.track_id && (
                          <>
                            <button
                              onClick={() => downloadInvoiceFile(inv, 'pdf')}
                              title="Descargar PDF generado"
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-all hover:bg-slate-50"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => downloadInvoiceFile(inv, 'xml')}
                              title="Descargar XML generado"
                              className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-all hover:bg-slate-50"
                            >
                              <FileJson className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'reports' && (
          <div className="space-y-6">
            <div className="flex flex-wrap justify-between gap-3">
              <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 flex items-center gap-3">
                <Clock className="w-4 h-4 text-slate-400" />
                <input
                  type="month"
                  value={reportMonth}
                  onChange={(e) => setReportMonth(e.target.value)}
                  className="bg-transparent border-none outline-none text-sm font-bold text-slate-700"
                />
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => downloadFile(`/api/finance/export/operational-close.xlsx?month=${reportMonth}`, `checklist-operacional-${reportMonth}.xlsx`)}
                  className="px-4 py-3 bg-emerald-700 text-white rounded-2xl text-sm font-bold hover:bg-emerald-800 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar checklist
                </button>
                <button
                  onClick={() => downloadFile(`/api/finance/export/monthly-close.xlsx?month=${reportMonth}`, `cierre-mensual-${reportMonth}.xlsx`)}
                  className="px-4 py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar cierre
                </button>
                <button
                  onClick={() => downloadFile(withBranch('/api/finance/export/payments.xlsx'), 'cuentas-por-cobrar.xlsx')}
                  className="px-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar pagos
                </button>
                <button
                  onClick={() => downloadFile(withBranch('/api/finance/export/payments.xlsx?status=overdue'), 'morosidad.xlsx')}
                  className="px-4 py-3 bg-red-600 text-white rounded-2xl text-sm font-bold hover:bg-red-700 flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Exportar morosidad
                </button>
              </div>
            </div>

            {!isLoading && !loadError && !hasReportActivity && (
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-bold text-blue-900">Sin movimientos para el mes seleccionado</p>
                <p className="mt-1 text-sm text-blue-800">
                  Los reportes muestran $0 porque no hay cobros, gastos, facturas ni presupuesto para {reportMonth}. Las exportaciones siguen disponibles y descargan el archivo con cabeceras para revisión.
                </p>
              </div>
            )}

            <div className="glass-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Base del reporte</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Fecha de corte: {monthlyCloseReport?.meta?.cutOffDate || `${reportMonth}-último día`} · Generado: {monthlyCloseReport?.meta?.generatedAt ? new Date(monthlyCloseReport.meta.generatedAt).toLocaleString() : 'ahora'}
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-600 lg:max-w-3xl">
                  {Object.entries(monthlyCloseReport?.meta?.formulas || {}).slice(0, 6).map(([key, value]) => (
                    <div key={key} className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                      <p className="font-bold text-slate-900">{key}</p>
                      <p className="mt-1">{String(value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <button type="button" onClick={() => handleTabChange('reports')} className="glass-card p-6 border-l-4 border-l-slate-900 text-left hover:bg-slate-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Margen Caja</p>
                <p className={cn("text-2xl font-bold mt-2", Number(monthlyCloseReport?.cashMargin || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>${Number(monthlyCloseReport?.cashMargin || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.month || reportMonth}</p>
              </button>
              <button type="button" onClick={() => openReportPayments('paid', 'paid')} className="glass-card p-6 border-l-4 border-l-emerald-500 text-left hover:bg-emerald-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recaudación Total</p>
                <p className="text-2xl font-bold text-emerald-600 mt-2">${Number(monthlyCloseReport?.collectedTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.collectedCount ?? 0} pagos en el mes</p>
              </button>
              <button type="button" onClick={() => openReportExpenses('paid', 'paid')} className="glass-card p-6 border-l-4 border-l-red-500 text-left hover:bg-red-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gastos Pagados</p>
                <p className="text-2xl font-bold text-red-600 mt-2">${Number(monthlyCloseReport?.paidExpensesTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.paidExpensesCount ?? 0} egresos en el mes</p>
              </button>
              <button type="button" onClick={() => openReportPayments('all', 'due')} className="glass-card p-6 border-l-4 border-l-blue-500 text-left hover:bg-blue-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Facturado</p>
                <p className="text-2xl font-bold text-blue-600 mt-2">${Number(monthlyCloseReport?.billedTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.billedCount ?? 0} cargos emitidos</p>
              </button>
              <button type="button" onClick={() => openReportExpenses('all', 'date')} className="glass-card p-6 border-l-4 border-l-amber-500 text-left hover:bg-amber-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Gastos Devengados</p>
                <p className="text-2xl font-bold text-amber-600 mt-2">${Number(monthlyCloseReport?.accruedExpensesTotal || 0).toLocaleString()}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.accruedExpensesCount ?? 0} gastos del mes</p>
              </button>
              <button type="button" onClick={() => openReportMovements('attention')} className="glass-card p-6 border-l-4 border-l-blue-500 text-left hover:bg-blue-50 transition-all">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Cartola Conciliada</p>
                <p className="text-2xl font-bold text-blue-600 mt-2">{monthlyCloseReport?.bankMovementsReconciled ?? 0}/{monthlyCloseReport?.bankMovementsTotal ?? 0}</p>
                <p className="text-xs text-slate-500 mt-1">{monthlyCloseReport?.bankMovementsPending ?? 0} pendientes · {monthlyCloseReport?.bankMovementsPartial ?? 0} parciales</p>
              </button>
            </div>
            <div className="glass-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Cierre Mensual Formal</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    {monthlyClosure?.status === 'closed'
                      ? `Cerrado por ${monthlyClosure.closed_by_name || 'administración'} el ${monthlyClosure.closed_at?.slice(0, 10) || ''}`
                      : monthlyClosure?.status === 'reopened'
                        ? `Reabierto por ${monthlyClosure.reopened_by_name || 'administración'} el ${monthlyClosure.reopened_at?.slice(0, 10) || ''}`
                        : 'Sin cierre formal registrado'}
                  </p>
                  {monthlyClosure?.accepted_pending_note && (
                    <p className="text-xs text-amber-700 mt-2">Pendientes aceptados: {monthlyClosure.accepted_pending_note}</p>
                  )}
                  {monthlyClosure?.reopened_reason && (
                    <p className="text-xs text-blue-700 mt-2">Motivo reapertura: {monthlyClosure.reopened_reason}</p>
                  )}
                </div>
                <div className="w-full lg:max-w-xl space-y-3">
                  {!isAdmin ? (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-bold text-amber-900">Cierre requiere administración</p>
                      <p className="mt-1 text-xs text-amber-700">Finanzas puede revisar el reporte y solicitar aprobación sin ejecutar el cierre formal.</p>
                      <button
                        type="button"
                        onClick={() => requestAdminApproval(`${monthlyClosure?.status === 'closed' ? 'reapertura' : 'cierre'} del mes ${reportMonth}`, {
                          source_type: monthlyClosure?.status === 'closed' ? 'finance_monthly_reopen_approval' : 'finance_monthly_close_approval',
                          source_id: reportMonth,
                          source_label: 'Reporte mensual',
                        })}
                        className="mt-3 w-full rounded-2xl bg-amber-600 py-3 text-sm font-bold text-white transition-all hover:bg-amber-700"
                      >
                        Solicitar aprobación
                      </button>
                    </div>
                  ) : monthlyClosure?.status === 'closed' ? (
                    <>
                      <textarea
                        value={monthlyReopenReason}
                        onChange={(e) => setMonthlyReopenReason(e.target.value)}
                        rows={2}
                        placeholder="Motivo para reabrir el mes"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                      />
                      <button
                        onClick={handleReopenMonth}
                        disabled={isClosingMonth || monthlyReopenReason.trim().length < 3}
                        className="w-full py-3 bg-amber-600 text-white rounded-2xl text-sm font-bold hover:bg-amber-700 transition-all disabled:opacity-50"
                      >
                        {isClosingMonth ? 'Procesando...' : 'Reabrir Mes'}
                      </button>
                    </>
                  ) : (
                    <>
                      <textarea
                        value={monthlyCloseNote}
                        onChange={(e) => setMonthlyCloseNote(e.target.value)}
                        rows={2}
                        placeholder="Nota de cierre si quedan pendientes aceptados"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                      />
                      <button
                        onClick={handleCloseMonth}
                        disabled={isClosingMonth || (Number(operationalCloseReport?.summary?.pendingItems || 0) > 0 && monthlyCloseNote.trim().length < 3)}
                        className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold hover:bg-slate-800 transition-all disabled:opacity-50"
                      >
                        {isClosingMonth ? 'Procesando...' : 'Cerrar Mes'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="glass-card overflow-hidden">
              <div className="p-5 border-b border-slate-100 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Checklist de Cierre Operativo</h3>
                  <p className="text-xs text-slate-500 mt-1">
                    Mes {operationalCloseReport?.month || reportMonth} · Corte {operationalCloseReport?.meta?.cutOffDate || monthlyCloseReport?.meta?.cutOffDate || getReportMonthEnd()} · {operationalCloseReport?.summary?.pendingItems ?? 0} pendiente(s) por ${Number(operationalCloseReport?.summary?.pendingAmount || 0).toLocaleString()}
                  </p>
                </div>
                <span className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
                  operationalStatusClasses[operationalCloseReport?.status || 'ok']
                )}>
                  <AlertCircle className="w-4 h-4" />
                  {operationalStatusLabels[operationalCloseReport?.status || 'ok']}
                </span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                {(operationalCloseReport?.checks ?? []).map((check: any) => (
                  <button
                    key={check.id}
                    type="button"
                    onClick={() => handleOperationalCheckClick(check.id)}
                    className="p-5 border-b border-slate-100 last:border-b-0 text-left hover:bg-slate-50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{check.label}</p>
                        <p className="text-xs text-slate-500 mt-1">{check.message}</p>
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mt-3">Ver pendientes</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cn(
                          "text-xl font-bold",
                          check.status === 'critical' ? "text-red-600" : check.status === 'warning' ? "text-amber-600" : "text-emerald-600"
                        )}>{check.count}</p>
                        {Number(check.amount || 0) > 0 && (
                          <p className="text-xs text-slate-500">${Number(check.amount || 0).toLocaleString()}</p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
                {(operationalCloseReport?.checks ?? []).length === 0 && (
                  <FinanceEmptyState
                    title="Checklist sin datos para este mes."
                    description="Cuando existan cobros, gastos o movimientos pendientes, el checklist mostrará qué falta antes del cierre."
                  />
                )}
              </div>
            </div>
            <div className="glass-card overflow-hidden">
              <div className="p-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-5 gap-4">
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Saldo Inicial</p>
                  <p className="text-xl font-bold text-slate-900">${Number(cashFlowReport?.openingBalance || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Entradas Esperadas</p>
                  <p className="text-xl font-bold text-emerald-600">${Number(cashFlowReport?.expectedInflowTotal || 0).toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-1">{cashFlowReport?.overdueRecoveryRate ?? 60}% recuperación mora</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Salidas Comprometidas</p>
                  <p className="text-xl font-bold text-red-600">${Number(cashFlowReport?.scheduledOutflowTotal || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Reserva Presupuesto</p>
                  <p className="text-xl font-bold text-amber-600">${Number(cashFlowReport?.budgetReserve || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Caja Proyectada</p>
                  <p className={cn("text-xl font-bold", Number(cashFlowReport?.projectedClosingBalance || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>${Number(cashFlowReport?.projectedClosingBalance || 0).toLocaleString()}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {(cashFlowReport?.buckets ?? []).map((bucket: any) => (
                  <div key={`${bucket.start}-${bucket.end}`} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px_120px] gap-3 items-center">
                    <div>
                      <p className="text-sm font-bold">{bucket.start} a {bucket.end}</p>
                      <p className="text-xs text-slate-500">{bucket.expectedInflowCount} cobro(s) · {bucket.scheduledOutflowCount} pago(s){Number(bucket.overdueNominalInflow || 0) > 0 ? ` · mora recuperable $${Number(bucket.overdueRecoverableInflow || 0).toLocaleString()} de $${Number(bucket.overdueNominalInflow || 0).toLocaleString()}` : ''}</p>
                    </div>
                    <p className="text-sm font-bold text-emerald-600">+${Number(bucket.expectedInflow || 0).toLocaleString()}</p>
                    <p className="text-sm font-bold text-red-600">-${Number(bucket.scheduledOutflow || 0).toLocaleString()}</p>
                    <p className="text-sm font-bold text-amber-600">-${Number(bucket.budgetReserve || 0).toLocaleString()}</p>
                    <p className={cn("text-sm font-bold", Number(bucket.projectedBalance || 0) >= 0 ? "text-slate-900" : "text-red-600")}>${Number(bucket.projectedBalance || 0).toLocaleString()}</p>
                  </div>
                ))}
                {(cashFlowReport?.buckets ?? []).length === 0 && (
                  <FinanceEmptyState
                    title="Sin proyección de caja disponible."
                    description="La proyección se completa cuando existan cobros esperados, gastos programados o presupuesto del mes."
                  />
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-6">
              <form onSubmit={handleSaveBudget} className="glass-card p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Presupuesto Mensual</h3>
                  <p className="text-xs text-slate-500 mt-1">{reportMonth}</p>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Categoría</label>
                  <select name="category" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                    {Object.entries(expenseCategoryLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Monto presupuestado</label>
                  <input type="number" name="planned_amount" required min="0" step="1" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas</label>
                  <textarea name="notes" rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
                </div>
                <button type="submit" disabled={isSavingBudget} className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
                  {isSavingBudget ? 'Guardando...' : 'Guardar Presupuesto'}
                </button>
              </form>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100 grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Presupuestado</p>
                    <p className="text-xl font-bold text-slate-900">${Number(budgetReport?.plannedTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Real</p>
                    <p className="text-xl font-bold text-red-600">${Number(budgetReport?.actualTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Desviación</p>
                    <p className={cn("text-xl font-bold", Number(budgetReport?.varianceTotal || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>${Number(budgetReport?.varianceTotal || 0).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ejecución</p>
                    <p className="text-xl font-bold text-blue-600">{budgetReport?.executionPercent ?? 0}%</p>
                  </div>
                </div>
                <div className="divide-y divide-slate-100">
                  {(budgetReport?.rows ?? []).map((row: any) => {
                    const savedBudget = budgetByCategory.get(row.category);
                    return (
                      <div key={row.category} className="p-4 grid grid-cols-1 md:grid-cols-[1fr_120px_120px_120px] gap-3 items-center">
                        <div>
                          <p className="text-sm font-bold">{expenseCategoryLabels[row.category as Expense['category']] || row.category}</p>
                          <p className="text-xs text-slate-500">{row.count} gasto(s){savedBudget?.notes ? ` · ${savedBudget.notes}` : ''}</p>
                        </div>
                        <p className="text-sm font-bold text-slate-700">${Number(row.plannedAmount || 0).toLocaleString()}</p>
                        <p className="text-sm font-bold text-red-600">${Number(row.actualAmount || 0).toLocaleString()}</p>
                        <p className={cn("text-sm font-bold", Number(row.variance || 0) >= 0 ? "text-emerald-600" : "text-red-600")}>
                          ${Number(row.variance || 0).toLocaleString()} · {row.executionPercent ?? 0}%
                        </p>
                      </div>
                    );
                  })}
                  {(budgetReport?.rows ?? []).length === 0 && (
                    <FinanceEmptyState
                      title="Sin presupuesto ni gastos para comparar."
                      description="Agrega un presupuesto mensual o registra gastos del mes para ver ejecución y desviaciones."
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Recaudación por Método del Mes</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.collectionsByMethod ?? []).map((item: any) => (
                    <div key={item.method} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold capitalize">{item.method}</p>
                        <p className="text-xs text-slate-500">{item.count} pagos</p>
                      </div>
                      <p className="text-sm font-bold">${Number(item.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.collectionsByMethod ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-400">Sin recaudación registrada.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Gastos por Categoría del Mes</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.expensesByCategory ?? []).map((item: any) => (
                    <div key={item.category} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold capitalize">{item.category}</p>
                        <p className="text-xs text-slate-500">{item.count} gastos</p>
                      </div>
                      <p className="text-sm font-bold text-red-600">${Number(item.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.expensesByCategory ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-400">Sin gastos registrados.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Morosidad por Cliente</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(delinquencyReport?.rows ?? []).map((row: any) => (
                    <div key={row.client_id} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{row.client_name}</p>
                        <p className="text-xs text-slate-500">{row.client_rut} · {row.overdue_count} deuda(s) · Desde {new Date(row.oldest_due_date).toLocaleDateString()}</p>
                      </div>
                      <p className="text-sm font-bold text-red-600">${Number(row.overdue_total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(delinquencyReport?.rows ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-400">Sin clientes morosos.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Antigüedad Cuentas por Cobrar</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.receivablesAging?.buckets ?? []).map((bucket: any) => (
                    <div key={bucket.bucket} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{bucket.bucket} días</p>
                        <p className="text-xs text-slate-500">{bucket.count} cuenta(s)</p>
                      </div>
                      <p className="text-sm font-bold text-red-600">${Number(bucket.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.receivablesAging?.buckets ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-400">Sin cuentas por cobrar vencidas para clasificar.</p>
                  )}
                </div>
              </div>

              <div className="glass-card overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Antigüedad Gastos por Pagar</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {(monthlyCloseReport?.payablesAging?.buckets ?? []).map((bucket: any) => (
                    <div key={bucket.bucket} className="p-4 flex justify-between items-center">
                      <div>
                        <p className="text-sm font-bold">{bucket.bucket} días</p>
                        <p className="text-xs text-slate-500">{bucket.count} gasto(s)</p>
                      </div>
                      <p className="text-sm font-bold text-amber-600">${Number(bucket.total || 0).toLocaleString()}</p>
                    </div>
                  ))}
                  {(monthlyCloseReport?.payablesAging?.buckets ?? []).length === 0 && (
                    <p className="p-8 text-center text-sm text-slate-400">Sin gastos por pagar vencidos para clasificar.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <Drawer
        isOpen={Boolean(paymentDetail)}
        onClose={closePaymentDetailDrawer}
        title="Ficha Cuenta por Cobrar"
      >
        {paymentDetail && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cliente</p>
              <p className="text-xl font-bold mt-1">{paymentDetail.payment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Monto</p>
                  <p className="text-2xl font-bold">${Number(paymentDetail.payment.amount || 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-2xl font-bold">${Number(paymentDetail.payment.remaining_amount || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Contrato</p>
                <p className="text-sm font-bold">#CON-{paymentDetail.payment.contract_id_display?.toString().padStart(3, '0')}</p>
                <p className="text-xs text-slate-500">{paymentDetail.payment.space_name || 'Sin espacio'}</p>
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Fecha de corte</p>
                <p className="text-sm font-bold">{paymentDetail.meta?.cutOffDate || new Date().toISOString().slice(0, 10)}</p>
                <p className="text-xs text-slate-500">Vence {paymentDetail.payment.due_date}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">Fórmulas visibles</p>
              {Object.entries(paymentDetail.meta?.formulas || {}).map(([key, value]) => (
                <p key={key} className="text-xs text-blue-800"><strong>{key}:</strong> {value}</p>
              ))}
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold text-slate-400 uppercase tracking-wider">Ajustes financieros</h4>
                {paymentDetail.payment.status !== 'paid' && paymentDetail.payment.status !== 'cancelled' && (
                  isAdmin ? (
                    <button onClick={() => setAdjustmentPayment(paymentDetail.payment)} className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg transition-all">Nuevo ajuste</button>
                  ) : (
                    <button onClick={() => requestAdminApproval(`ajuste de pago #PAG-${paymentDetail.payment.id.toString().padStart(4, '0')}`, { source_type: 'finance_payment_adjustment', source_id: paymentDetail.payment.id, source_label: 'Pago' })} className="text-xs font-bold text-amber-700 hover:bg-amber-50 px-3 py-2 rounded-lg transition-all">Solicitar aprobación</button>
                  )
                )}
              </div>
              <div className="space-y-3">
                {paymentDetail.adjustments.map(adjustment => (
                  <div key={adjustment.id} className="p-3 border border-slate-100 rounded-2xl">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900">
                        {adjustment.type === 'fee' ? 'Multa' : adjustment.type === 'waiver' ? 'Condonación' : 'Descuento'} · ${adjustment.amount.toLocaleString()}
                      </p>
                      <p className="text-xs font-bold text-slate-500">${adjustment.previous_amount.toLocaleString()} {'->'} ${adjustment.new_amount.toLocaleString()}</p>
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{adjustment.reason}</p>
                    <p className="text-xs text-slate-400 mt-1">{new Date(adjustment.created_at).toLocaleString()} · {adjustment.staff_name || 'Sistema'}</p>
                  </div>
                ))}
                {paymentDetail.adjustments.length === 0 && <p className="text-sm text-slate-400">Sin ajustes registrados.</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Abonos y conciliación</p>
                {paymentDetail.allocations.map(allocation => (
                  <p key={allocation.id} className="text-sm text-slate-700">${allocation.amount.toLocaleString()} · {allocation.movement_date} · {allocation.movement_description}</p>
                ))}
                {paymentDetail.allocations.length === 0 && <p className="text-sm text-slate-400">Sin abonos aplicados.</p>}
              </div>
              <div className="p-4 border border-slate-100 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Seguimiento cobranza</p>
                {paymentDetail.collectionActions.map(action => (
                  <p key={action.id} className="text-sm text-slate-700">{action.created_at.slice(0, 10)} · {action.note}</p>
                ))}
                {paymentDetail.collectionActions.length === 0 && <p className="text-sm text-slate-400">Sin gestiones registradas.</p>}
              </div>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(adjustmentPayment)}
        onClose={closeAdjustmentDrawer}
        title="Ajuste Financiero"
      >
        {adjustmentPayment && (
          <form onSubmit={handleCreatePaymentAdjustment} className="space-y-6">
            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Cuenta por cobrar</p>
              <p className="text-xl font-bold text-slate-900 mt-1">{adjustmentPayment.client_name}</p>
              <p className="text-sm text-slate-600">Monto actual ${adjustmentPayment.amount.toLocaleString()} · Saldo ${Number(adjustmentPayment.remaining_amount ?? adjustmentPayment.amount).toLocaleString()}</p>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo</label>
              <select name="type" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="discount">Descuento</option>
                <option value="waiver">Condonación</option>
                <option value="fee">Multa / recargo</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Monto</label>
              <input type="number" name="amount" min="1" step="1" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo obligatorio</label>
              <textarea name="reason" rows={4} minLength={3} required placeholder="Ej: Descuento autorizado por administración por ajuste comercial documentado." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
            </div>
            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeAdjustmentDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isSavingAdjustment} className="flex-[2] py-4 bg-amber-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-amber-100 hover:bg-amber-700 transition-all disabled:opacity-50">
                {isSavingAdjustment ? 'Guardando...' : 'Registrar Ajuste'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={isDrawerOpen}
        onClose={closePaymentDrawer}
        title="Registrar Pago Manual"
      >
        <form onSubmit={handleRegisterPayment} className="space-y-8">
          <div className="bg-slate-900 text-white p-6 rounded-3xl">
            <p className="text-xs font-bold opacity-60 uppercase tracking-wider mb-1">Cliente</p>
            <p className="text-xl font-bold">{selectedPayment?.client_name}</p>
            <div className="mt-4 flex justify-between items-end">
              <div>
                <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Monto a Pagar</p>
                <p className="text-3xl font-bold">${Number(selectedPayment?.remaining_amount ?? selectedPayment?.amount ?? 0).toLocaleString()}</p>
                {(selectedPayment?.allocated_amount || 0) > 0 && (
                  <p className="mt-1 text-xs font-bold opacity-70">
                    Total ${Number(selectedPayment?.amount || 0).toLocaleString()} · Abonado ${Number(selectedPayment?.allocated_amount || 0).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Vencimiento</p>
                <p className="text-sm font-bold">{selectedPayment?.due_date}</p>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Método de Pago</label>
              <select name="method" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="cash">Efectivo</option>
                <option value="transfer">Transferencia Bancaria</option>
                <option value="card">Tarjeta Débito/Crédito</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha de Pago</label>
              <input
                type="date"
                name="payment_date"
                required
                defaultValue={new Date().toISOString().split('T')[0]}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Referencia / Comprobante</label>
              <input
                type="text"
                name="reference"
                placeholder="N° operación, folio interno o detalle de caja"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nota operacional</label>
              <textarea
                name="note"
                rows={3}
                required
                minLength={3}
                placeholder="Ej: Pago recibido en caja por administración, respaldo validado contra comprobante."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Archivo de Comprobante</label>
              <label className="border-2 border-dashed border-slate-200 rounded-3xl p-6 flex flex-col items-center justify-center text-center hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50">
                <UploadCloud className="w-9 h-9 text-slate-300 mb-3" />
                <span className="text-sm font-bold text-slate-900">Seleccionar comprobante</span>
                <span className="text-xs text-slate-400 mt-1">{selectedReceiptName || 'JPG, PNG o PDF hasta 5MB'}</span>
                <input
                  type="file"
                  name="receipt"
                  accept="application/pdf,image/jpeg,image/png"
                  className="sr-only"
                  onChange={(e) => setSelectedReceiptName(e.target.files?.[0]?.name || '')}
                />
              </label>
            </div>

            <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
              <FileJson className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-sm font-bold text-blue-900">Documento tributario por saldo restante</p>
                <p className="text-xs text-blue-700">Quedará preparado o procesado según el proveedor configurado; el mock local no equivale a aceptación real del SII.</p>
              </div>
            </div>
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={closePaymentDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isRegistering} className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
              {isRegistering ? 'Registrando...' : 'Registrar pago y preparar DTE'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={Boolean(editingMovement)}
        onClose={closeMovementDrawer}
        title="Editar Movimiento Bancario"
      >
        {editingMovement && (
          <form onSubmit={handleUpdateMovement} className="space-y-6">
            <div className="bg-amber-50 border border-amber-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wider">Pendiente de revisión</p>
              <p className="text-sm text-amber-800 mt-1">Ajusta los datos de cartola o deja una nota para retomarlo antes de conciliar.</p>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha</label>
              <input
                type="date"
                name="date"
                required
                defaultValue={editingMovement.date}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Descripción / Glosa</label>
              <input
                type="text"
                name="description"
                required
                defaultValue={editingMovement.description}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT</label>
                <input
                  type="text"
                  name="rut"
                  required
                  defaultValue={editingMovement.rut}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Monto</label>
                <input
                  type="number"
                  name="amount"
                  required
                  min="1"
                  step="1"
                  defaultValue={editingMovement.amount}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nota de revisión</label>
              <textarea
                name="notes"
                rows={5}
                defaultValue={editingMovement.notes || ''}
                placeholder="Ej: Falta identificar pagador, posible pago parcial, RUT no coincide con contrato..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
              />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeMovementDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              {editingMovement.status !== 'partial' && (
                <button type="button" onClick={handleMarkMovementPartial} disabled={isUpdatingMovement} className="flex-[1.5] py-4 bg-blue-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all disabled:opacity-50">
                  Marcar Parcial
                </button>
              )}
              <button type="submit" disabled={isUpdatingMovement} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
                {isUpdatingMovement ? 'Guardando...' : 'Guardar Movimiento'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(allocationPayment && selectedMovement)}
        onClose={closeAllocationDrawer}
        title="Aplicar Abono desde Cartola"
      >
        {allocationPayment && selectedMovement && (
          <form onSubmit={handleAllocateMovement} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900 text-white p-5 rounded-3xl">
                <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Movimiento</p>
                <p className="text-lg font-bold mt-1">${selectedMovement.amount.toLocaleString()}</p>
                <p className="text-xs opacity-70 mt-2">Disponible ${Number(selectedMovement.remaining_amount ?? selectedMovement.amount).toLocaleString()}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-100 p-5 rounded-3xl">
                <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider">Pago</p>
                <p className="text-lg font-bold text-slate-900 mt-1">${allocationPayment.amount.toLocaleString()}</p>
                <p className="text-xs text-emerald-700 mt-2">Saldo ${Number(allocationPayment.remaining_amount ?? allocationPayment.amount).toLocaleString()}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Monto del abono</label>
              <input
                type="number"
                name="amount"
                required
                min="1"
                max={Math.min(
                  Number(selectedMovement.remaining_amount ?? selectedMovement.amount),
                  Number(allocationPayment.remaining_amount ?? allocationPayment.amount)
                )}
                step="1"
                defaultValue={Math.min(
                  Number(selectedMovement.remaining_amount ?? selectedMovement.amount),
                  Number(allocationPayment.remaining_amount ?? allocationPayment.amount)
                )}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nota</label>
              <textarea
                name="note"
                rows={4}
                required
                minLength={3}
                placeholder="Ej: Abono parcial validado por cartola bancaria"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
              />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeAllocationDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isAllocating} className="flex-[2] py-4 bg-emerald-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-emerald-100 hover:bg-emerald-700 transition-all disabled:opacity-50">
                {isAllocating ? 'Aplicando...' : 'Aplicar Abono'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(historyPayment)}
        onClose={closeHistoryDrawer}
        title="Historial de Abonos"
      >
        {historyPayment && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cuenta por cobrar</p>
              <p className="text-xl font-bold mt-1">{historyPayment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Monto</p>
                  <p className="text-lg font-bold">${historyPayment.amount.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-lg font-bold">${Number(historyPayment.remaining_amount || 0).toLocaleString()}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {paymentAllocationHistory.length === 0 && (
                <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">No hay abonos registrados para este pago.</p>
              )}
              {paymentAllocationHistory.map(allocation => (
                <div key={allocation.id} className={cn(
                  "border rounded-2xl p-4",
                  allocation.reversed_at ? "border-red-100 bg-red-50" : "border-slate-200"
                )}>
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <p className={cn("text-sm font-bold", allocation.reversed_at ? "text-red-800 line-through" : "text-slate-900")}>{allocation.movement_description}</p>
                      <p className="text-xs text-slate-500">
                        Cartola #{allocation.bank_movement_id} · {allocation.movement_date} · RUT {allocation.movement_rut}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={cn("text-sm font-bold whitespace-nowrap", allocation.reversed_at ? "text-red-600 line-through" : "text-emerald-600")}>${allocation.amount.toLocaleString()}</p>
                      {!allocation.reversed_at && isAdmin && (
                        <button
                          onClick={() => setReverseAllocation(allocation)}
                          disabled={isReversingAllocation}
                          className="mt-1 text-[10px] font-bold text-red-600 hover:bg-red-100 px-2 py-1 rounded-lg transition-all disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Reversar
                        </button>
                      )}
                    </div>
                  </div>
                  {allocation.note && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-3">{allocation.note}</p>
                  )}
                  {allocation.reversed_note && (
                    <p className="text-xs text-red-700 bg-white border border-red-100 rounded-xl px-3 py-2 mt-3">Reversado: {allocation.reversed_note}</p>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-3">
                    {allocation.reversed_at
                      ? `Reversado ${new Date(allocation.reversed_at).toLocaleString()}`
                      : `Registrado ${new Date(allocation.created_at).toLocaleString()}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(reverseAllocation)}
        onClose={closeReverseDrawer}
        title="Reversar Abono"
      >
        {reverseAllocation && (
          <form onSubmit={handleReverseAllocation} className="space-y-6">
            <div className="bg-red-50 border border-red-100 rounded-3xl p-5">
              <p className="text-xs font-bold text-red-700 uppercase tracking-wider">Corrección financiera</p>
              <p className="text-sm text-red-800 mt-1">El abono quedará marcado como reversado, se recalcularán los saldos y el registro seguirá visible en el historial.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Monto</p>
                <p className="text-lg font-bold text-slate-900 mt-1">${reverseAllocation.amount.toLocaleString()}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pago</p>
                <p className="text-lg font-bold text-slate-900 mt-1">#PAG-{reverseAllocation.payment_id.toString().padStart(4, '0')}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Motivo de reversa</label>
              <textarea
                name="note"
                rows={5}
                required
                minLength={3}
                placeholder="Ej: Abono aplicado a cliente equivocado, monto duplicado o conciliación incorrecta."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
              />
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-4">
              <button type="button" onClick={closeReverseDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
              <button type="submit" disabled={isReversingAllocation} className="flex-[2] py-4 bg-red-600 text-white rounded-2xl text-sm font-bold shadow-xl shadow-red-100 hover:bg-red-700 transition-all disabled:opacity-50">
                {isReversingAllocation ? 'Reversando...' : 'Reversar Abono'}
              </button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        isOpen={Boolean(collectionPayment)}
        onClose={closeCollectionDrawer}
        title="Seguimiento de Cobranza"
      >
        {collectionPayment && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Cliente</p>
              <p className="text-xl font-bold mt-1">{collectionPayment.client_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Saldo</p>
                  <p className="text-lg font-bold">${Number(collectionPayment.remaining_amount ?? collectionPayment.amount).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Vence</p>
                  <p className="text-lg font-bold">{collectionPayment.due_date}</p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Contacto de cobranza</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {collectionPayment.client_phone || 'Sin teléfono'} · {collectionPayment.client_email || 'Sin email'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(collectionPayment.client_phone, 'Teléfono')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Copiar teléfono
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(collectionPayment.client_email, 'Email')}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Copiar email
                  </button>
                  <button
                    type="button"
                    onClick={() => copyCollectionTemplate(collectionPayment)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 transition-all hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copiar plantilla
                  </button>
                  {normalizePhoneForWhatsApp(collectionPayment.client_phone) && (
                    <a
                      href={`https://wa.me/${normalizePhoneForWhatsApp(collectionPayment.client_phone)}?text=${encodeURIComponent(buildCollectionMessage(collectionPayment))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition-all hover:bg-emerald-100"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      WhatsApp
                    </a>
                  )}
                </div>
              </div>
            </div>

            <form onSubmit={handleCreateCollectionAction} className="space-y-4 border border-slate-200 rounded-3xl p-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Canal</label>
                  <select name="channel" required className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                    <option value="phone">Teléfono</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                    <option value="in_person">Presencial</option>
                    <option value="other">Otro</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Próxima acción</label>
                  <input
                    type="date"
                    name="next_action_at"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Nota de gestión</label>
                <textarea
                  name="note"
                  rows={4}
                  required
                  minLength={3}
                  placeholder="Ej: Se llamó al cliente, confirma transferencia para mañana."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none"
                />
              </div>

              <button type="submit" disabled={isSavingCollectionAction} className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
                {isSavingCollectionAction ? 'Guardando...' : 'Registrar Gestión'}
              </button>
            </form>

            <div className="space-y-3">
              {collectionActions.length === 0 && (
                <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">Sin gestiones registradas para este pago.</p>
              )}
              {collectionActions.map(action => (
                <div key={action.id} className={cn(
                  "border rounded-2xl p-4",
                  action.status === 'done' ? "border-emerald-100 bg-emerald-50" : "border-blue-100 bg-blue-50"
                )}>
                  <div className="flex justify-between gap-4">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        {action.channel === 'phone' ? 'Teléfono' : action.channel === 'whatsapp' ? 'WhatsApp' : action.channel === 'email' ? 'Email' : action.channel === 'in_person' ? 'Presencial' : 'Otro'}
                      </p>
                      <p className="text-xs text-slate-500">
                        {action.staff_name || 'Sistema'} · {new Date(action.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className={cn(
                      "h-fit px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                      action.status === 'done' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                    )}>
                      {action.status === 'done' ? 'Cerrado' : 'Abierto'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 mt-3">{action.note}</p>
                  {action.next_action_at && action.status === 'open' && (
                    <p className="text-xs font-bold text-blue-700 mt-2">Próxima acción: {action.next_action_at}</p>
                  )}
                  {action.completed_note && (
                    <p className="text-xs text-emerald-700 bg-white border border-emerald-100 rounded-xl px-3 py-2 mt-3">{action.completed_note}</p>
                  )}
                  {action.status === 'open' && (
                    <button
                      onClick={() => handleCompleteCollectionAction(action)}
                      disabled={isSavingCollectionAction}
                      className="mt-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                    >
                      Marcar Cerrado
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        isOpen={isExpenseDrawerOpen}
        onClose={closeExpenseDrawer}
        title={editingExpense ? "Editar Gasto" : "Registrar Gasto"}
      >
        <form onSubmit={handleSaveExpense} className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Fecha</label>
              <input type="date" name="date" required defaultValue={editingExpense?.date || new Date().toISOString().split('T')[0]} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Categoría</label>
              <select name="category" required defaultValue={editingExpense?.category || 'maintenance'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="rent">Arriendo</option>
                <option value="maintenance">Mantención</option>
                <option value="utilities">Servicios</option>
                <option value="payroll">Sueldos</option>
                <option value="supplies">Insumos</option>
                <option value="taxes">Impuestos</option>
                <option value="admin">Administración</option>
                <option value="other">Otros</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Proveedor</label>
              <input name="supplier_name" required defaultValue={editingExpense?.supplier_name || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">RUT Proveedor</label>
              <input name="supplier_rut" defaultValue={editingExpense?.supplier_rut || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Descripción</label>
              <input name="description" required defaultValue={editingExpense?.description || ''} placeholder="Ej: Reparación portón acceso principal" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Centro de Costo</label>
              <select name="cost_center" defaultValue={editingExpense?.cost_center || 'general'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="general">General</option>
                <option value="operations">Operación</option>
                <option value="maintenance">Mantención</option>
                <option value="security">Seguridad</option>
                <option value="administration">Administración</option>
                <option value="taxes">Impuestos</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Sucursal</label>
              <select name="branch_id" defaultValue={editingExpense?.branch_id || (selectedBranchId === 'all' ? '' : selectedBranchId)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="">Sin sucursal</option>
                {branches.map(branch => (
                  <option key={branch.id} value={branch.id}>{branch.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Neto</label>
              <input type="number" name="amount_net" min="0" step="1" defaultValue={editingExpense?.amount_net || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">IVA/Impuesto</label>
              <input type="number" name="tax_amount" min="0" step="1" defaultValue={editingExpense?.tax_amount || 0} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Total</label>
              <input type="number" name="amount_total" required min="1" step="1" defaultValue={editingExpense?.amount_total || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Documento</label>
              <select name="document_type" defaultValue={editingExpense?.document_type || 'invoice'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="invoice">Factura</option>
                <option value="receipt">Recibo</option>
                <option value="ticket">Boleta</option>
                <option value="internal">Orden interna</option>
                <option value="none">Sin documento</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Folio/Número</label>
              <input name="document_number" defaultValue={editingExpense?.document_number || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Estado</label>
              <select name="payment_status" defaultValue={editingExpense?.payment_status || 'pending'} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="overdue">Vencido</option>
                <option value="cancelled">Anulado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Vencimiento</label>
              <input type="date" name="due_date" defaultValue={editingExpense?.due_date || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
            <div>
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Pagado el</label>
              <input type="date" name="paid_at" defaultValue={editingExpense?.paid_at || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all" />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Método de pago</label>
            <select name="payment_method" defaultValue={editingExpense?.payment_method || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all">
              <option value="">Sin definir</option>
              <option value="transfer">Transferencia</option>
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="automatic">Débito automático</option>
              <option value="other">Otro</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Respaldo</label>
            <label className="border-2 border-dashed border-slate-200 rounded-3xl p-5 flex flex-col items-center justify-center text-center hover:border-slate-400 transition-all cursor-pointer bg-slate-50/50">
              <UploadCloud className="w-8 h-8 text-slate-300 mb-2" />
              <span className="text-sm font-bold text-slate-900">Seleccionar respaldo</span>
              <span className="text-xs text-slate-400 mt-1">{selectedExpenseReceiptName || editingExpense?.receipt_file_name || 'JPG, PNG o PDF hasta 5MB'}</span>
              <input type="file" name="receipt" accept="application/pdf,image/jpeg,image/png" className="sr-only" onChange={(e) => setSelectedExpenseReceiptName(e.target.files?.[0]?.name || '')} />
            </label>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">Notas</label>
            <textarea name="notes" rows={4} defaultValue={editingExpense?.notes || ''} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:bg-white focus:border-slate-900 outline-none transition-all resize-none" />
          </div>

          <div className="pt-6 border-t border-slate-100 flex gap-4">
            <button type="button" onClick={closeExpenseDrawer} className="flex-1 py-4 text-sm font-bold text-slate-400 hover:text-slate-900 transition-colors">Cancelar</button>
            <button type="submit" disabled={isSavingExpense} className="flex-[2] py-4 bg-slate-900 text-white rounded-2xl text-sm font-bold shadow-xl shadow-slate-100 hover:bg-slate-800 transition-all disabled:opacity-50">
              {isSavingExpense ? 'Guardando...' : editingExpense ? 'Guardar Gasto' : 'Registrar Gasto'}
            </button>
          </div>
        </form>
      </Drawer>

      <Drawer
        isOpen={Boolean(reconcilingExpense)}
        onClose={closeExpenseReconcileDrawer}
        title="Conciliar Gasto con Cartola"
      >
        {reconcilingExpense && (
          <div className="space-y-6">
            <div className="bg-slate-900 text-white p-6 rounded-3xl">
              <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Gasto</p>
              <p className="text-xl font-bold mt-1">{reconcilingExpense.supplier_name}</p>
              <div className="grid grid-cols-2 gap-4 mt-5">
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Total</p>
                  <p className="text-lg font-bold">${reconcilingExpense.amount_total.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs font-bold opacity-60 uppercase tracking-wider">Documento</p>
                  <p className="text-lg font-bold">{reconcilingExpense.document_number || 'Sin folio'}</p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {expenseMovementSuggestions.length === 0 && (
                <p className="text-sm text-slate-500 bg-slate-50 rounded-2xl p-4">No hay movimientos bancarios sugeridos por monto, proveedor o RUT.</p>
              )}
              {expenseMovementSuggestions.map(suggestion => (
                <div key={suggestion.bank_movement_id} className="border border-slate-200 rounded-2xl p-4">
                  <div className="flex justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2 items-center">
                        <p className="text-sm font-bold text-slate-900">{suggestion.movement.description}</p>
                        <span className="px-2 py-1 rounded-lg bg-blue-100 text-blue-700 text-[10px] font-bold">Match {suggestion.score}%</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{suggestion.movement.date} · RUT {suggestion.movement.rut}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {suggestion.reasons.map(reason => (
                          <span key={reason} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold">{reason}</span>
                        ))}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-red-600">${suggestion.movement.amount.toLocaleString()}</p>
                      <button
                        onClick={() => handleReconcileExpenseMovement(suggestion.movement)}
                        disabled={isReconcilingExpense}
                        className="mt-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 px-3 py-2 rounded-lg transition-all disabled:opacity-50"
                      >
                        Conciliar
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={Boolean(expensePaymentAction)}
        title="Marcar gasto como pagado"
        message={
          <div className="space-y-4">
            <p>
              Se registrara el pago de <strong>{expensePaymentAction?.supplier_name}</strong> por ${Number(expensePaymentAction?.amount_total || 0).toLocaleString()}.
            </p>
            <div>
              <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-slate-400">Nota operacional</label>
              <textarea
                value={expensePaymentNote}
                onChange={(e) => setExpensePaymentNote(e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 outline-none focus:border-slate-900 focus:bg-white"
                placeholder="Ej: Pago validado contra transferencia bancaria o comprobante del proveedor."
              />
            </div>
          </div>
        }
        confirmLabel="Registrar pago"
        tone="default"
        isLoading={isSavingExpense}
        isConfirmDisabled={expensePaymentNote.trim().length < 3}
        onCancel={closeExpensePaymentDialog}
        onConfirm={handleMarkExpensePaid}
      />
    </div>
  );
};

export default FinancePage;

