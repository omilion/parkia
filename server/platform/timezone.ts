import { db } from "../db";

export const DEFAULT_TIMEZONE = "America/Santiago";

export function resolveTimezone(branchOrTz?: { timezone?: string | null } | string | null): string {
  const candidate =
    typeof branchOrTz === "string"
      ? branchOrTz.trim()
      : branchOrTz?.timezone
        ? String(branchOrTz.timezone).trim()
        : "";
  if (!candidate) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function localDate(
  branchOrTz?: { timezone?: string | null } | string | null,
  now: Date = new Date(),
): string {
  const timeZone = resolveTimezone(branchOrTz);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = (type: string) => parts.find((part) => part.type === type)?.value || "01";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export async function getBranchTimezone(branchId?: number | null, tenantId?: number | null): Promise<string> {
  try {
    if (branchId) {
      const row = tenantId
        ? (await db
            .prepare("SELECT timezone FROM branches WHERE id = ? AND tenant_id = ?")
            .get(branchId, tenantId) as { timezone?: string | null } | undefined)
        : (await db.prepare("SELECT timezone FROM branches WHERE id = ?").get(branchId) as
            | { timezone?: string | null }
            | undefined);
      if (row?.timezone) return resolveTimezone(row.timezone);
    }

    const fallback = tenantId
      ? (await db
          .prepare("SELECT timezone FROM branches WHERE tenant_id = ? AND status = 'active' ORDER BY id ASC LIMIT 1")
          .get(tenantId) as { timezone?: string | null } | undefined)
      : (await db
          .prepare("SELECT timezone FROM branches WHERE status = 'active' ORDER BY id ASC LIMIT 1")
          .get() as { timezone?: string | null } | undefined);

    return resolveTimezone(fallback?.timezone);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

