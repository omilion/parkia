import { db } from "../../../db";
import { likeValue, type PaginationParams } from "../../../pagination";
import {
  ensureFinanceDateOpen,
  ensureFinanceDatesOpen,
  getMovementAllocatedAmount,
  getPaymentAllocatedAmount,
  markPaymentAsPaid,
  paymentRemainingSql,
} from "../shared";

export function listBankMovementsFromDb(params: {
  tenantId: number;
  branchId: number | null;
  status: string;
  month: string;
  search: string;
  pagination: PaginationParams;
}) {
  const { tenantId, branchId, status, month, search, pagination } = params;
  const sqlParams: any[] = [tenantId];
  let where = "WHERE bm.tenant_id = ?";
  if (branchId) {
    where += " AND bm.branch_id = ?";
    sqlParams.push(branchId);
  }
  if (status === "attention") {
    where += " AND bm.status IN ('pending', 'partial')";
  } else if (status && status !== "all") {
    where += " AND bm.status = ?";
    sqlParams.push(status);
  }
  if (month) {
    where += " AND bm.date LIKE ?";
    sqlParams.push(`${month}%`);
  }
  if (search) {
    const like = likeValue(search);
    where += " AND (bm.description LIKE ? OR bm.rut LIKE ? OR COALESCE(bm.notes, '') LIKE ? OR bm.date LIKE ? OR CAST(bm.amount AS TEXT) LIKE ?)";
    sqlParams.push(like, like, like, like, like);
  }

  const fromSql = `
    FROM bank_movements bm
    LEFT JOIN (
      SELECT bank_movement_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY bank_movement_id
    ) pa ON pa.bank_movement_id = bm.id
    ${where}
  `;
  const fromParams = [tenantId, ...sqlParams];
  const total = Number((db.prepare(`SELECT COUNT(*) as count ${fromSql}`).get(...fromParams) as { count: number }).count || 0);
  let listQuery = `
    SELECT bm.*,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
    ${fromSql}
    ORDER BY bm.date DESC
  `;
  const listParams = [...fromParams];
  if (pagination.requested) {
    listQuery += " LIMIT ? OFFSET ?";
    listParams.push(pagination.pageSize, pagination.offset);
  }
  const movements = db.prepare(listQuery).all(...listParams);
  return { movements, total };
}

export function findBankMovementWithRemainingInDb(movementId: string | number, tenantId: number) {
  return db.prepare(`
    SELECT bm.*,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           MAX(bm.amount - COALESCE(pa.allocated_amount, 0), 0) as remaining_amount
    FROM bank_movements bm
    LEFT JOIN (
      SELECT bank_movement_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY bank_movement_id
    ) pa ON pa.bank_movement_id = bm.id
    WHERE bm.id = ? AND bm.tenant_id = ?
  `).get(tenantId, movementId, tenantId) as any | undefined;
}

export function listCandidatePaymentsForBankMovementFromDb(tenantId: number, branchId: number | null) {
  return db.prepare(`
    SELECT p.*,
           cl.name as client_name,
           cl.rut as client_rut,
           c.id as contract_id_display,
           COALESCE(pa.allocated_amount, 0) as allocated_amount,
           ${paymentRemainingSql} as remaining_amount
    FROM payments p
    JOIN contracts c ON p.contract_id = c.id
    JOIN clients cl ON c.client_id = cl.id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN (
      SELECT payment_id, SUM(amount) as allocated_amount
      FROM payment_allocations
      WHERE reversed_at IS NULL AND tenant_id = ?
      GROUP BY payment_id
    ) pa ON pa.payment_id = p.id
    WHERE p.status IN ('pending', 'overdue')
      AND p.tenant_id = ?
      ${branchId ? "AND p.branch_id = ?" : ""}
  `).all(...(branchId ? [tenantId, tenantId, branchId] : [tenantId, tenantId])) as any[];
}

export function importBankMovementsIntoDb(
  tenantId: number,
  branchId: number | null,
  rows: { date: string; description: string; rut: string; amount: number }[]
) {
  let imported = 0;
  let duplicated = 0;

  const transaction = db.transaction(() => {
    const insertMovement = db.prepare(`
      INSERT INTO bank_movements (date, description, rut, amount, status, notes, branch_id, tenant_id)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `);
    const findDuplicate = db.prepare(`
      SELECT id FROM bank_movements
      WHERE date = ? AND description = ? AND rut = ? AND amount = ? AND COALESCE(branch_id, 0) = COALESCE(?, 0) AND tenant_id = ?
      LIMIT 1
    `);

    for (const movement of rows) {
      ensureFinanceDateOpen(movement.date, tenantId);
      const duplicate = findDuplicate.get(movement.date, movement.description, movement.rut, movement.amount, branchId, tenantId);
      if (duplicate) {
        duplicated++;
      } else {
        insertMovement.run(movement.date, movement.description, movement.rut, movement.amount, "Importado desde cartola bancaria", branchId, tenantId);
        imported++;
      }
    }
  });

  transaction();
  return { imported, duplicated };
}

export function updateBankMovementInDb(
  movementId: string | number,
  tenantId: number,
  body: {
    date?: string;
    description?: string | null;
    rut?: string | null;
    amount?: number;
    notes?: string | null;
  }
) {
  const transaction = db.transaction(() => {
    const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ? AND tenant_id = ?").get(movementId, tenantId) as any | undefined;
    if (!movement) throw new Error("Movimiento bancario no encontrado");
    if (movement.status === "reconciled") throw new Error("No se puede editar un movimiento conciliado");

    const next = {
      date: body.date ?? movement.date,
      description: body.description ?? movement.description,
      rut: body.rut ?? movement.rut,
      amount: body.amount ?? movement.amount,
      notes: body.notes ?? movement.notes,
    };
    ensureFinanceDatesOpen([movement.date, next.date], tenantId);

    db.prepare(`
      UPDATE bank_movements
      SET date = ?, description = ?, rut = ?, amount = ?, notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(next.date, next.description, next.rut, next.amount, next.notes, movementId, tenantId);

    return { previous: movement, next };
  });

  return transaction();
}

export function markBankMovementPartialInDb(movementId: string | number, tenantId: number, note: string) {
  const transaction = db.transaction(() => {
    const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ? AND tenant_id = ?").get(movementId, tenantId) as any | undefined;
    if (!movement) throw new Error("Movimiento bancario no encontrado");
    if (movement.status === "reconciled") throw new Error("No se puede marcar parcial un movimiento conciliado");
    ensureFinanceDateOpen(movement.date, tenantId);

    db.prepare(`
      UPDATE bank_movements
      SET status = 'partial', notes = ?
      WHERE id = ? AND tenant_id = ?
    `).run(note, movementId, tenantId);

    return movement;
  });

  return transaction();
}

export function allocateBankMovementInDb(
  movementId: string | number,
  tenantId: number,
  body: { payment_id?: number; amount?: number; note?: string }
) {
  const transaction = db.transaction(() => {
    const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ? AND tenant_id = ?").get(movementId, tenantId) as any | undefined;
    if (!movement) throw new Error("Movimiento bancario no encontrado");
    if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
    ensureFinanceDateOpen(movement.date, tenantId);

    const payment = db.prepare(`
      SELECT p.*, c.client_id
      FROM payments p
      JOIN contracts c ON p.contract_id = c.id
      WHERE p.id = ? AND p.tenant_id = ?
    `).get(body.payment_id, tenantId) as any | undefined;
    if (!payment) throw new Error("Pago no encontrado");
    if (movement.branch_id && payment.branch_id && Number(movement.branch_id) !== Number(payment.branch_id)) {
      throw new Error("El pago pertenece a otra sucursal");
    }
    if (payment.status === "paid") throw new Error("El pago ya fue registrado");
    if (payment.status === "cancelled") throw new Error("El pago está cancelado");

    const amount = Number(body.amount || 0);
    const allocatedToMovement = getMovementAllocatedAmount(movementId, tenantId);
    const allocatedToPayment = getPaymentAllocatedAmount(payment.id, tenantId);
    const movementRemaining = Number(movement.amount) - allocatedToMovement;
    const paymentRemaining = Number(payment.amount) - allocatedToPayment;

    if (amount > movementRemaining) throw new Error("El abono supera el saldo disponible del movimiento");
    if (amount > paymentRemaining) throw new Error("El abono supera el saldo pendiente del pago");

    db.prepare(`
      INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(payment.id, movementId, amount, body.note || null, tenantId);
    if (!movement.branch_id && payment.branch_id) {
      db.prepare("UPDATE bank_movements SET branch_id = ? WHERE id = ? AND tenant_id = ?").run(payment.branch_id, movement.id, tenantId);
    }

    const nextMovementRemaining = movementRemaining - amount;
    const nextPaymentRemaining = paymentRemaining - amount;
    const movementStatus = nextMovementRemaining <= 0 ? "reconciled" : "partial";
    db.prepare(`
      UPDATE bank_movements
      SET status = ?, notes = COALESCE(?, notes)
      WHERE id = ? AND tenant_id = ?
    `).run(movementStatus, body.note || null, movementId, tenantId);

    let folio: number | null = null;
    if (nextPaymentRemaining <= 0) {
      const paid = markPaymentAsPaid({
        paymentId: payment.id,
        method: "transfer",
        paymentDate: movement.date,
        reference: `Abonos cartola bancaria #${movement.id}`,
      });
      folio = paid.folio;
    }

    return {
      movementId,
      paymentId: payment.id,
      amount,
      note: body.note,
      movementStatus,
      paymentFullyPaid: nextPaymentRemaining <= 0,
      movementRemaining: Math.max(nextMovementRemaining, 0),
      paymentRemaining: Math.max(nextPaymentRemaining, 0),
      folio,
    };
  });

  return transaction();
}

export function reconcileBankMovementInDb(
  movementId: string | number,
  tenantId: number,
  body: { payment_id?: number; note?: string }
) {
  const transaction = db.transaction(() => {
    const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ? AND tenant_id = ?").get(movementId, tenantId) as any | undefined;
    if (!movement) throw new Error("Movimiento bancario no encontrado");
    if (movement.status === "reconciled") throw new Error("El movimiento ya está conciliado");
    ensureFinanceDateOpen(movement.date, tenantId);

    const payment = db.prepare("SELECT id, amount, status, branch_id FROM payments WHERE id = ? AND tenant_id = ?").get(body.payment_id, tenantId) as {
      id: number;
      amount: number;
      status: string;
      branch_id: number | null;
    } | undefined;
    if (!payment) throw new Error("Pago no encontrado");
    if (movement.branch_id && payment.branch_id && Number(movement.branch_id) !== Number(payment.branch_id)) {
      throw new Error("El pago pertenece a otra sucursal");
    }
    if (payment.status === "paid") throw new Error("El pago ya fue registrado");
    if (payment.status === "cancelled") throw new Error("El pago está cancelado");

    const movementRemaining = Number(movement.amount) - getMovementAllocatedAmount(movement.id, tenantId);
    const paymentRemaining = Number(payment.amount) - getPaymentAllocatedAmount(payment.id, tenantId);
    if (movementRemaining <= 0) throw new Error("El movimiento no tiene saldo disponible");
    if (paymentRemaining <= 0) throw new Error("El pago no tiene saldo pendiente");
    if (movementRemaining !== paymentRemaining) throw new Error("El saldo del movimiento no coincide con el saldo pendiente del pago");

    db.prepare(`
      INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(payment.id, movement.id, movementRemaining, body.note || null, tenantId);
    if (!movement.branch_id && payment.branch_id) {
      db.prepare("UPDATE bank_movements SET branch_id = ? WHERE id = ? AND tenant_id = ?").run(payment.branch_id, movement.id, tenantId);
    }

    const reference = body.note
      ? `Cartola bancaria #${movement.id} - ${body.note}`
      : `Cartola bancaria #${movement.id}`;
    const result = markPaymentAsPaid({
      paymentId: payment.id,
      method: "transfer",
      paymentDate: movement.date,
      reference,
    });

    db.prepare("UPDATE bank_movements SET status = 'reconciled' WHERE id = ? AND tenant_id = ?").run(movement.id, tenantId);

    return {
      ...result,
      movement,
      paymentId: payment.id,
      reference,
      allocatedAmount: movementRemaining,
    };
  });

  return transaction();
}

export function autoReconcilePendingBankMovementsInDb(tenantId: number) {
  const movements = db.prepare("SELECT * FROM bank_movements WHERE status = 'pending' AND tenant_id = ?").all(tenantId) as any[];
  let autoConciliated = 0;

  const transaction = db.transaction(() => {
    const unmatched: number[] = [];
    for (const move of movements) {
      ensureFinanceDateOpen(move.date, tenantId);
      const match = db.prepare(`
        SELECT p.id,
               con.client_id,
               ${paymentRemainingSql} as remaining_amount
        FROM payments p 
        JOIN contracts con ON p.contract_id = con.id 
        JOIN clients c ON con.client_id = c.id 
        LEFT JOIN (
          SELECT payment_id, SUM(amount) as allocated_amount
          FROM payment_allocations
          WHERE reversed_at IS NULL AND tenant_id = ?
          GROUP BY payment_id
        ) pa ON pa.payment_id = p.id
        WHERE c.rut = ?
          AND ${paymentRemainingSql} = ?
          AND p.status IN ('pending', 'overdue')
          AND p.tenant_id = ?
          ${move.branch_id ? "AND p.branch_id = ?" : ""}
        LIMIT 1
      `).get(...(move.branch_id ? [tenantId, move.rut, move.amount, tenantId, move.branch_id] : [tenantId, move.rut, move.amount, tenantId])) as {
        id: number;
        client_id: number;
        remaining_amount: number;
      } | undefined;

      if (match) {
        db.prepare(`
          INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, tenant_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(match.id, move.id, move.amount, "Conciliación automática", tenantId);
        markPaymentAsPaid({
          paymentId: match.id,
          method: "transfer",
          paymentDate: move.date,
          reference: `Cartola bancaria #${move.id}`,
        });
        db.prepare("UPDATE bank_movements SET status = 'reconciled' WHERE id = ? AND tenant_id = ?").run(move.id, tenantId);
        autoConciliated++;
      } else {
        db.prepare(`
          UPDATE bank_movements
          SET notes = COALESCE(NULLIF(notes, ''), 'Sin coincidencia automática. Revisar manualmente.')
          WHERE id = ? AND tenant_id = ?
        `).run(move.id, tenantId);
        unmatched.push(move.id);
      }
    }
    return { autoConciliated, unmatched, total: movements.length };
  });

  return transaction();
}

