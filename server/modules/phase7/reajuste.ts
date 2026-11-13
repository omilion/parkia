import type { Express } from "express";
import { contractReajusteSchema, ipcRateUpsertSchema } from "../../../shared/schemas/phase7";
import { requireAnyRole } from "../../auth/sessions";
import { db } from "../../db";
import { runWithTenant, runWithoutTenant } from "../../db/engine/context";
import { getTenantContextFromRequest, requirePlatformAdmin } from "../../platform/tenant/service";
import { parseBody } from "../../validation";

function currentMonthPeriod(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Santiago" }).slice(0, 7);
}

async function applyContractAdjustment(params: {
  tenantId: number;
  contractId: number;
  indexType: "ipc" | "uf";
  periodKey: string;
  ufValueClp?: number;
}): Promise<
  | { ok: true; adjustment: Record<string, unknown> }
  | { ok: false; code: "not_found" | "already_applied" | "missing_rate" }
> {
  return await runWithTenant(params.tenantId, async () => {
    const contract = await db
      .prepare(
        `SELECT id, monthly_fee, base_uf_value, adjustment_index, status
         FROM contracts
         WHERE tenant_id = ? AND id = ?
         LIMIT 1`,
      )
      .get<{
        id: number;
        monthly_fee: number;
        base_uf_value: number | null;
        adjustment_index: string;
        status: string;
      }>(params.tenantId, params.contractId);

    if (!contract) return { ok: false, code: "not_found" };

    const existing = await db
      .prepare(
        `SELECT id FROM contract_adjustments
         WHERE tenant_id = ? AND contract_id = ? AND index_type = ? AND period_key = ?
         LIMIT 1`,
      )
      .get<{ id: number }>(params.tenantId, params.contractId, params.indexType, params.periodKey);
    if (existing) return { ok: false, code: "already_applied" };

    let factorPct = 0;
    let nextBaseUf = contract.base_uf_value;

    if (params.indexType === "ipc") {
      const rate = await db
        .prepare("SELECT period, variation_pct FROM ipc_rates WHERE period = ? LIMIT 1")
        .get<{ period: string; variation_pct: number }>(params.periodKey);
      if (!rate) return { ok: false, code: "missing_rate" };
      factorPct = rate.variation_pct;
    } else {
      let currentUf = params.ufValueClp;
      if (!currentUf) {
        const ufRow = await db
          .prepare("SELECT value_clp FROM uf_rates ORDER BY rate_date DESC LIMIT 1")
          .get<{ value_clp: number }>();
        currentUf = ufRow?.value_clp;
      }
      if (!currentUf || currentUf <= 0) return { ok: false, code: "missing_rate" };
      const baseUf = contract.base_uf_value && contract.base_uf_value > 0 ? contract.base_uf_value : currentUf;
      factorPct = Number((((currentUf - baseUf) / baseUf) * 100).toFixed(4));
      nextBaseUf = currentUf;
    }

    const previousFee = contract.monthly_fee;
    const newFee = Math.max(0, Math.round(previousFee * (1 + factorPct / 100)));

    await db
      .prepare(
        `UPDATE contracts
         SET monthly_fee = ?, adjustment_index = ?, base_uf_value = ?, last_adjusted_at = datetime('now')
         WHERE tenant_id = ? AND id = ?`,
      )
      .run(newFee, params.indexType, nextBaseUf, params.tenantId, params.contractId);

    const inserted = await db
      .prepare(
        `INSERT INTO contract_adjustments
           (tenant_id, contract_id, index_type, period_key, previous_fee, new_fee, factor_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(params.tenantId, params.contractId, params.indexType, params.periodKey, previousFee, newFee, factorPct);

    const saved = await db
      .prepare("SELECT * FROM contract_adjustments WHERE tenant_id = ? AND id = ?")
      .get<Record<string, unknown>>(params.tenantId, Number(inserted.lastInsertRowid));

    return { ok: true, adjustment: saved || {} };
  });
}

export async function runContractReajusteJob(): Promise<{ checked: number; adjusted: number }> {
  const periodKey = currentMonthPeriod();
  const candidates = await runWithoutTenant(async () =>
    db
      .prepare(
        `SELECT id, tenant_id, adjustment_index
         FROM contracts
         WHERE status = 'active' AND adjustment_index IN ('ipc', 'uf')`,
      )
      .all<{ id: number; tenant_id: number; adjustment_index: "ipc" | "uf" }>(),
  );

  let adjusted = 0;
  for (const c of candidates) {
    const res = await applyContractAdjustment({
      tenantId: c.tenant_id,
      contractId: c.id,
      indexType: c.adjustment_index,
      periodKey,
    });
    if (res.ok) adjusted += 1;
  }
  return { checked: candidates.length, adjusted };
}

export function registerReajusteRoutes(app: Express) {
  app.get("/api/contracts/reajuste/ipc", requireAnyRole(["admin", "finance"]), async (_req, res) => {
    const rates = await runWithoutTenant(async () =>
      db.prepare("SELECT * FROM ipc_rates ORDER BY period DESC LIMIT 36").all<Record<string, unknown>>(),
    );
    res.json({ rates });
  });

  // El IPC es un dato de la plataforma, no de una empresa: lo usa el reajuste de TODOS los contratos de TODAS las empresas.
  // Solo lo carga un administrador de plataforma (PARKIA_PLATFORM_ADMINS); un administrador de empresa no puede tocarlo.
  app.post("/api/contracts/reajuste/ipc", requirePlatformAdmin, async (req, res) => {
    const body = parseBody(ipcRateUpsertSchema, req.body, res);
    if (!body) return;

    await runWithoutTenant(async () => {
      await db
        .prepare(
          `INSERT INTO ipc_rates (period, variation_pct, source)
           VALUES (?, ?, ?)
           ON CONFLICT (period) DO UPDATE SET variation_pct = EXCLUDED.variation_pct, source = EXCLUDED.source`,
        )
        .run(body.period, body.variation_pct, body.source);
    });

    res.status(201).json({ ok: true, period: body.period, variation_pct: body.variation_pct });
  });

  app.get("/api/contracts/:id/reajustes", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const contractId = Number(req.params.id);
    if (!Number.isInteger(contractId) || contractId <= 0) {
      res.status(400).json({ message: "ID de contrato inválido" });
      return;
    }
    const ctx = await getTenantContextFromRequest(req);
    const items = await runWithTenant(ctx.tenant.id, async () =>
      db
        .prepare(
          `SELECT * FROM contract_adjustments
           WHERE tenant_id = ? AND contract_id = ?
           ORDER BY applied_at DESC, id DESC`,
        )
        .all<Record<string, unknown>>(ctx.tenant.id, contractId),
    );
    res.json({ adjustments: items });
  });

  app.post("/api/contracts/:id/reajuste", requireAnyRole(["admin", "finance"]), async (req, res) => {
    const contractId = Number(req.params.id);
    if (!Number.isInteger(contractId) || contractId <= 0) {
      res.status(400).json({ message: "ID de contrato inválido" });
      return;
    }
    const body = parseBody(contractReajusteSchema, req.body, res);
    if (!body) return;

    const ctx = await getTenantContextFromRequest(req);
    const periodKey = body.period_key || currentMonthPeriod();
    const result = await applyContractAdjustment({
      tenantId: ctx.tenant.id,
      contractId,
      indexType: body.index_type,
      periodKey,
      ufValueClp: body.uf_value_clp,
    });

    if ("code" in result) {
      const status =
        result.code === "not_found" ? 404 : result.code === "already_applied" ? 409 : 422;
      res.status(status).json({ message: `No se pudo reajustar contrato (${result.code})` });
      return;
    }

    res.status(201).json({ ok: true, adjustment: result.adjustment });
  });
}
