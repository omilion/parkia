import { db } from "./db";

type DateParts = {
  year: number;
  month: number;
  day: number;
};

type ContractBillingRow = {
  id: number;
  start_date: string;
  end_date: string | null;
  monthly_fee: number;
  billing_day: number;
  branch_id: number | null;
};

export type ReceivableGenerationResult = {
  contractId: number;
  created: number;
  skipped: number;
  dueDates: string[];
  firstDueDate: string | null;
  lastDueDate: string | null;
};

export type ReceivableReconcileResult = ReceivableGenerationResult & {
  updated: number;
  cancelled: number;
  locked: number;
  fromDate: string;
};

const DEFAULT_OPEN_ENDED_HORIZON_MONTHS = 12;

function parseDateParts(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) throw new Error(`Fecha invalida: ${value}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatDateParts(parts: DateParts) {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function compareDateStrings(left: string, right: string) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(parts: DateParts, months: number): DateParts {
  const zeroBased = parts.month - 1 + months;
  const year = parts.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  return {
    year,
    month,
    day: Math.min(parts.day, daysInMonth(year, month)),
  };
}

function dueDateForMonth(year: number, month: number, billingDay: number) {
  return formatDateParts({
    year,
    month,
    day: Math.min(billingDay, daysInMonth(year, month)),
  });
}

export function buildContractDueDates(input: {
  startDate: string;
  endDate?: string | null;
  billingDay: number;
  openEndedHorizonMonths?: number;
}) {
  const start = parseDateParts(input.startDate);
  const endDate = input.endDate || null;
  const billingDay = Math.max(1, Math.min(31, Number(input.billingDay || 5)));
  const horizon = input.openEndedHorizonMonths || DEFAULT_OPEN_ENDED_HORIZON_MONTHS;

  let cursor = {
    year: start.year,
    month: start.month,
    day: 1,
  };

  if (billingDay < start.day) {
    cursor = addMonths(cursor, 1);
  }

  const dueDates: string[] = [];
  const maxIterations = endDate ? 240 : horizon;

  for (let i = 0; i < maxIterations; i++) {
    const dueDate = dueDateForMonth(cursor.year, cursor.month, billingDay);
    if (endDate && compareDateStrings(dueDate, endDate) > 0) break;
    if (compareDateStrings(dueDate, input.startDate) >= 0) {
      dueDates.push(dueDate);
    }
    cursor = addMonths(cursor, 1);
  }

  if (dueDates.length === 0 && endDate && compareDateStrings(endDate, input.startDate) >= 0) {
    dueDates.push(endDate);
  }

  return dueDates;
}

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function buildOpenEndedDueDatesFrom(input: {
  startDate: string;
  billingDay: number;
  fromDate?: string;
  openEndedHorizonMonths?: number;
}) {
  const fromDate = input.fromDate || currentDateString();
  const start = parseDateParts(input.startDate);
  const from = parseDateParts(compareDateStrings(fromDate, input.startDate) < 0 ? input.startDate : fromDate);
  const billingDay = Math.max(1, Math.min(31, Number(input.billingDay || 5)));
  const horizon = input.openEndedHorizonMonths || DEFAULT_OPEN_ENDED_HORIZON_MONTHS;

  let cursor = {
    year: from.year,
    month: from.month,
    day: 1,
  };

  let firstDueDate = dueDateForMonth(cursor.year, cursor.month, billingDay);
  if (compareDateStrings(firstDueDate, input.startDate) < 0 || compareDateStrings(firstDueDate, fromDate) < 0) {
    cursor = addMonths(cursor, 1);
  }

  const dueDates: string[] = [];
  for (let i = 0; i < horizon; i++) {
    const dueDate = dueDateForMonth(cursor.year, cursor.month, billingDay);
    if (compareDateStrings(dueDate, input.startDate) >= 0 && compareDateStrings(dueDate, fromDate) >= 0) {
      dueDates.push(dueDate);
    }
    cursor = addMonths(cursor, 1);
  }

  return dueDates;
}

export function generateContractReceivables(contractId: number | string, options: { openEndedHorizonMonths?: number } = {}): ReceivableGenerationResult {
  const contract = db.prepare(`
    SELECT id, start_date, end_date, monthly_fee, billing_day, branch_id
    FROM contracts
    WHERE id = ?
  `).get(contractId) as ContractBillingRow | undefined;

  if (!contract) throw new Error("Contrato no encontrado");

  const dueDates = buildContractDueDates({
    startDate: contract.start_date,
    endDate: contract.end_date,
    billingDay: contract.billing_day,
    openEndedHorizonMonths: options.openEndedHorizonMonths,
  });

  const existingRows = db.prepare("SELECT due_date FROM payments WHERE contract_id = ?").all(contract.id) as { due_date: string }[];
  const existingDueDates = new Set(existingRows.map(row => row.due_date));
  const insertPayment = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, branch_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const today = currentDateString();
  let created = 0;
  let skipped = 0;

  for (const dueDate of dueDates) {
    if (existingDueDates.has(dueDate)) {
      skipped++;
      continue;
    }
    insertPayment.run(contract.id, contract.monthly_fee, dueDate, compareDateStrings(dueDate, today) < 0 ? "overdue" : "pending", contract.branch_id || null);
    created++;
  }

  return {
    contractId: contract.id,
    created,
    skipped,
    dueDates,
    firstDueDate: dueDates[0] || null,
    lastDueDate: dueDates[dueDates.length - 1] || null,
  };
}

export function ensureUpcomingReceivables(options: { fromDate?: string, openEndedHorizonMonths?: number } = {}) {
  const fromDate = options.fromDate || currentDateString();
  const contracts = db.prepare(`
    SELECT id, start_date, monthly_fee, billing_day, branch_id
    FROM contracts
    WHERE status = 'active'
      AND end_date IS NULL
  `).all() as Array<Omit<ContractBillingRow, "end_date">>;

  const insertPayment = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, branch_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  const today = currentDateString();
  let created = 0;
  let skipped = 0;

  for (const contract of contracts) {
    const dueDates = buildOpenEndedDueDatesFrom({
      startDate: contract.start_date,
      billingDay: contract.billing_day,
      fromDate,
      openEndedHorizonMonths: options.openEndedHorizonMonths,
    });
    const existingRows = db.prepare(`
      SELECT due_date
      FROM payments
      WHERE contract_id = ?
        AND due_date >= ?
        AND status != 'cancelled'
    `).all(contract.id, fromDate) as { due_date: string }[];
    const existingDueDates = new Set(existingRows.map(row => row.due_date));

    for (const dueDate of dueDates) {
      if (existingDueDates.has(dueDate)) {
        skipped++;
        continue;
      }
      insertPayment.run(contract.id, contract.monthly_fee, dueDate, compareDateStrings(dueDate, today) < 0 ? "overdue" : "pending", contract.branch_id || null);
      created++;
    }
  }

  return {
    contracts: contracts.length,
    created,
    skipped,
    fromDate,
  };
}

export function refreshOverduePayments() {
  const result = db.prepare(`
    UPDATE payments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < date('now')
  `).run();

  db.prepare(`
    UPDATE clients
    SET financial_status = 'overdue'
    WHERE id IN (
      SELECT DISTINCT c.client_id
      FROM payments p
      JOIN contracts c ON c.id = p.contract_id
      WHERE p.status = 'overdue'
        AND c.status = 'active'
    )
  `).run();

  db.prepare(`
    UPDATE clients
    SET financial_status = 'up-to-date'
    WHERE financial_status = 'overdue'
      AND id NOT IN (
        SELECT DISTINCT c.client_id
        FROM payments p
        JOIN contracts c ON c.id = p.contract_id
        WHERE p.status = 'overdue'
          AND c.status = 'active'
      )
  `).run();

  return result.changes;
}

function paymentStatusForDueDate(dueDate: string, today = currentDateString()) {
  return compareDateStrings(dueDate, today) < 0 ? "overdue" : "pending";
}

type PaymentReceivableRow = {
  id: number;
  amount: number;
  due_date: string;
  status: string;
  allocated_amount: number;
  invoice_id: number | null;
};

function isPaymentLocked(payment: PaymentReceivableRow) {
  return payment.status === "paid" || Number(payment.allocated_amount || 0) > 0 || Boolean(payment.invoice_id);
}

export function reconcileContractFutureReceivables(contractId: number | string, options: { fromDate?: string, openEndedHorizonMonths?: number } = {}): ReceivableReconcileResult {
  const contract = db.prepare(`
    SELECT id, start_date, end_date, monthly_fee, billing_day, branch_id
    FROM contracts
    WHERE id = ?
  `).get(contractId) as ContractBillingRow | undefined;

  if (!contract) throw new Error("Contrato no encontrado");

  const fromDate = options.fromDate || currentDateString();
  const today = currentDateString();
  const dueDates = buildContractDueDates({
    startDate: contract.start_date,
    endDate: contract.end_date,
    billingDay: contract.billing_day,
    openEndedHorizonMonths: options.openEndedHorizonMonths,
  });
  const futureDueDates = dueDates.filter(dueDate => compareDateStrings(dueDate, fromDate) >= 0);
  const desired = new Set(futureDueDates);
  const currentPayments = db.prepare(`
    SELECT p.*,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           inv.id as invoice_id
    FROM payments p
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    LEFT JOIN invoices inv ON inv.payment_id = p.id
    WHERE p.contract_id = ? AND p.due_date >= ?
    ORDER BY p.due_date ASC, p.id ASC
  `).all(contract.id, fromDate) as PaymentReceivableRow[];

  const activePaymentsByDueDate = new Map<string, PaymentReceivableRow>();
  for (const payment of currentPayments) {
    if (payment.status !== "cancelled" && !activePaymentsByDueDate.has(payment.due_date)) {
      activePaymentsByDueDate.set(payment.due_date, payment);
    }
  }

  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let locked = 0;
  let skipped = 0;

  const lockedPayments = currentPayments.filter(payment => payment.status !== "cancelled" && isPaymentLocked(payment));
  const lockedAffected = lockedPayments.filter(payment => {
    if (!desired.has(payment.due_date)) return true;
    return Number(payment.amount) !== Number(contract.monthly_fee);
  });
  if (lockedAffected.length > 0) {
    throw new Error("No se pueden recalcular los cobros: existen cuotas futuras pagadas, conciliadas o facturadas");
  }

  for (const payment of currentPayments) {
    if (payment.status === "cancelled" || desired.has(payment.due_date)) continue;
    if (isPaymentLocked(payment)) {
      locked++;
      continue;
    }
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ?").run(payment.id);
    cancelled++;
  }

  const insertPayment = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, branch_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const dueDate of futureDueDates) {
    const existing = activePaymentsByDueDate.get(dueDate);
    const status = paymentStatusForDueDate(dueDate, today);
    if (!existing) {
      insertPayment.run(contract.id, contract.monthly_fee, dueDate, status, contract.branch_id || null);
      created++;
      continue;
    }
    if (isPaymentLocked(existing)) {
      skipped++;
      continue;
    }
    if (Number(existing.amount) !== Number(contract.monthly_fee) || existing.status !== status) {
      db.prepare("UPDATE payments SET amount = ?, status = ? WHERE id = ?").run(contract.monthly_fee, status, existing.id);
      updated++;
    } else {
      skipped++;
    }
  }

  return {
    contractId: contract.id,
    created,
    updated,
    cancelled,
    locked,
    skipped,
    dueDates: futureDueDates,
    firstDueDate: futureDueDates[0] || null,
    lastDueDate: futureDueDates[futureDueDates.length - 1] || null,
    fromDate,
  };
}

export function cancelContractReceivablesAfter(contractId: number | string, afterDate: string) {
  const payments = db.prepare(`
    SELECT p.*,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           inv.id as invoice_id
    FROM payments p
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    LEFT JOIN invoices inv ON inv.payment_id = p.id
    WHERE p.contract_id = ? AND p.due_date > ? AND p.status != 'cancelled'
    ORDER BY p.due_date ASC, p.id ASC
  `).all(contractId, afterDate) as PaymentReceivableRow[];

  const locked = payments.filter(isPaymentLocked);
  if (locked.length > 0) {
    throw new Error("No se puede terminar el contrato: existen cobros futuros pagados, conciliados o facturados");
  }

  let cancelled = 0;
  for (const payment of payments) {
    db.prepare("UPDATE payments SET status = 'cancelled' WHERE id = ?").run(payment.id);
    cancelled++;
  }

  return { contractId: Number(contractId), afterDate, cancelled, locked: 0 };
}
