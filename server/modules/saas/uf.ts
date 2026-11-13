import { db } from "../../db";
import { runWithoutTenant } from "../../db/engine/context";
import { DEFAULT_TIMEZONE, localDate } from "../../platform/timezone";

export interface UfRateRecord {
  rate_date: string;
  value_clp: number;
  source: string;
  exact: boolean;
}

export function getFallbackUfValue(): number {
  const envVal = Number(process.env.PARKIA_UF_FALLBACK_CLP || 38000);
  return Number.isFinite(envVal) && envVal > 0 ? envVal : 38000;
}

export async function upsertUfRate(rateDate: string, valueClp: number, source = "manual"): Promise<void> {
  await runWithoutTenant(async () => {
    await db
      .prepare(
        `INSERT INTO uf_rates (rate_date, value_clp, source, fetched_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(rate_date) DO UPDATE SET
           value_clp = excluded.value_clp,
           source = excluded.source,
           fetched_at = datetime('now')`,
      )
      .run(rateDate, valueClp, source);
  });
}

export async function getUfRate(targetDate = localDate(DEFAULT_TIMEZONE)): Promise<UfRateRecord> {
  return await runWithoutTenant(async () => {
    const exact = await db
      .prepare("SELECT rate_date, value_clp, source FROM uf_rates WHERE rate_date = ?")
      .get<{ rate_date: string; value_clp: number; source: string }>(targetDate);
    if (exact) {
      return {
        rate_date: String(exact.rate_date),
        value_clp: Number(exact.value_clp),
        source: String(exact.source),
        exact: true,
      };
    }

    const latestPrior = await db
      .prepare(
        `SELECT rate_date, value_clp, source
         FROM uf_rates
         WHERE rate_date <= ?
         ORDER BY rate_date DESC
         LIMIT 1`,
      )
      .get<{ rate_date: string; value_clp: number; source: string }>(targetDate);
    if (latestPrior) {
      return {
        rate_date: String(latestPrior.rate_date),
        value_clp: Number(latestPrior.value_clp),
        source: String(latestPrior.source),
        exact: false,
      };
    }

    const latestAny = await db
      .prepare("SELECT rate_date, value_clp, source FROM uf_rates ORDER BY rate_date DESC LIMIT 1")
      .get<{ rate_date: string; value_clp: number; source: string }>();
    if (latestAny) {
      return {
        rate_date: String(latestAny.rate_date),
        value_clp: Number(latestAny.value_clp),
        source: String(latestAny.source),
        exact: false,
      };
    }

    return {
      rate_date: targetDate,
      value_clp: getFallbackUfValue(),
      source: "fallback_env",
      exact: false,
    };
  });
}

export async function syncUfFromProvider(fetchImpl: typeof fetch = fetch): Promise<UfRateRecord> {
  const url = process.env.PARKIA_UF_API_URL || "https://mindicador.cl/api/uf";
  // Sin limite, un proveedor caido dejaria la tarea colgada y retrasaria a las demas.
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`No se pudo consultar valor UF (${response.status})`);
  }
  const payload = (await response.json()) as {
    serie?: Array<{ fecha?: string; valor?: number }>;
  };
  const latest = payload.serie?.[0];
  if (!latest?.fecha || !Number.isFinite(Number(latest.valor))) {
    throw new Error("Respuesta de API UF sin serie válida");
  }
  const rateDate = String(latest.fecha).slice(0, 10);
  const valueClp = Number(latest.valor);
  await upsertUfRate(rateDate, valueClp, "mindicador.cl");
  return { rate_date: rateDate, value_clp: valueClp, source: "mindicador.cl", exact: true };
}

export function ufCentisToClp(ufCentis: number, ufValueClp: number): number {
  return Math.round((ufCentis / 100) * ufValueClp);
}
