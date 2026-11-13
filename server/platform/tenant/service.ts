import { runWithTenant } from "../../db/engine/context";
import type { NextFunction, Request, Response } from "express";
import { recordAuditEvent } from "../../audit";
import type { AuthUser } from "../../auth/sessions";
import { getCurrentUser } from "../../auth/sessions";
import {
  insertTenantMembershipForStaff,
  queryTenantContextByTenantId,
  queryTenantContextForUserRow,
  queryTenantExportTables,
  queryTenantUsageCounts,
} from "./repo";

export type TenantContext = {
  tenant: {
    id: number;
    name: string;
    rut: string | null;
    status: "active" | "suspended" | "archived";
  };
  membership: {
    role: "owner" | "admin" | "member";
  };
  plan: {
    id: number;
    code: string;
    name: string;
    max_branches: number | null;
    max_spaces: number | null;
    max_users: number | null;
    monthly_ticket_limit: number | null;
    price_clp: number;
  };
  subscription: {
    id: number;
    status: "trialing" | "active" | "past_due" | "suspended" | "cancelled";
    current_period_start: string | null;
    current_period_end: string | null;
    grace_until: string | null;
    suspended_at: string | null;
  };
};

export async function getTenantContextForUser(user: AuthUser | null | undefined): Promise<TenantContext | null> {
  if (!user) return null;
  const row = user.impersonation
    ? await queryTenantContextByTenantId(user.impersonation.tenant_id)
    : await queryTenantContextForUserRow(user.id);
  if (!row) return null;
  return {
    tenant: {
      id: Number(row.tenant_id),
      name: String(row.tenant_name),
      rut: row.tenant_rut || null,
      status: row.tenant_status,
    },
    membership: {
      role: row.membership_role,
    },
    plan: {
      id: Number(row.plan_id),
      code: String(row.plan_code),
      name: String(row.plan_name),
      max_branches: row.max_branches === null ? null : Number(row.max_branches),
      max_spaces: row.max_spaces === null ? null : Number(row.max_spaces),
      max_users: row.max_users === null ? null : Number(row.max_users),
      monthly_ticket_limit: row.monthly_ticket_limit === null ? null : Number(row.monthly_ticket_limit),
      price_clp: Number(row.price_clp || 0),
    },
    subscription: {
      id: Number(row.subscription_id),
      status: row.subscription_status,
      current_period_start: row.current_period_start || null,
      current_period_end: row.current_period_end || null,
      grace_until: row.grace_until ? String(row.grace_until).slice(0, 10) : null,
      suspended_at: row.suspended_at || null,
    },
  };
}

type TenantRequest = Request & { tenantContext?: TenantContext };

export async function getTenantContextFromRequest(req: Request): Promise<TenantContext | null> {
  return (req as TenantRequest).tenantContext || await getTenantContextForUser(await getCurrentUser(req));
}

export async function getTenantIdFromRequest(req: Request) {
  const context = await getTenantContextFromRequest(req);
  if (!context) throw new Error("Tenant no configurado para el usuario actual");
  return context.tenant.id;
}

export async function requireTenantContext(req: Request, res: Response, next: NextFunction) {
  const context = await getTenantContextForUser(await getCurrentUser(req));
  if (!context) {
    return res.status(403).json({
      error: "Tenant no configurado para el usuario actual",
      code: "TENANT_CONTEXT_REQUIRED",
    });
  }
  (req as TenantRequest).tenantContext = context;
  // Desde aqui las consultas de esta peticion corren con la empresa fijada: en PostgreSQL,
  // las politicas RLS limitan cada consulta a esta empresa aunque el SQL olvide filtrar.
  runWithTenant(context.tenant.id, () => next());
}

export async function createTenantMembershipForStaff(tenantId: number, staffId: number, staffRole: AuthUser["role"]) {
  await insertTenantMembershipForStaff(tenantId, staffId, staffRole === "admin" ? "admin" : "member");
}

export async function getTenantUsage(tenantId: number) {
  return await queryTenantUsageCounts(tenantId);
}

export type PlanLimitResource = "branches" | "spaces" | "users" | "tickets";

const planLimitDefinitions: Record<
  PlanLimitResource,
  {
    planField: "max_branches" | "max_spaces" | "max_users" | "monthly_ticket_limit";
    usageField: keyof Awaited<ReturnType<typeof getTenantUsage>>;
    label: string;
  }
> = {
  branches: { planField: "max_branches", usageField: "branches", label: "sucursales activas" },
  spaces: { planField: "max_spaces", usageField: "spaces", label: "estacionamientos" },
  users: { planField: "max_users", usageField: "users", label: "usuarios activos" },
  tickets: { planField: "monthly_ticket_limit", usageField: "ticketsThisMonth", label: "tickets de visita del mes" },
};

export class PlanLimitError extends Error {
  readonly status = 402;
  readonly code = "PLAN_LIMIT_REACHED";

  constructor(
    readonly resource: PlanLimitResource,
    readonly limit: number,
    readonly usage: number,
    planName: string,
  ) {
    super(
      `Tu plan ${planName} permite hasta ${limit} ${planLimitDefinitions[resource].label} y ya tienes ${usage}. Actualiza el plan para continuar.`,
    );
    this.name = "PlanLimitError";
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      limit: this.limit,
      usage: this.usage,
      resource: this.resource,
    };
  }
}

export async function assertPlanLimit(req: Request, resource: PlanLimitResource, increment = 1) {
  const context = await getTenantContextFromRequest(req);
  if (!context) throw new Error("Tenant no configurado para el usuario actual");

  const definition = planLimitDefinitions[resource];
  const limit = context.plan[definition.planField];
  if (limit === null || limit === undefined) return;

  const usage = (await getTenantUsage(context.tenant.id))[definition.usageField];
  if (usage + increment > limit) {
    throw new PlanLimitError(resource, limit, usage, context.plan.name);
  }
}

export function sendPlanLimitError(res: Response, error: unknown) {
  if (!(error instanceof PlanLimitError)) return false;
  res.status(error.status).json(error.toJSON());
  return true;
}

function getPlatformAdminEmails() {
  return (process.env.PARKIA_PLATFORM_ADMINS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdmin(user: Pick<AuthUser, "email" | "role"> | null | undefined) {
  if (!user || user.role !== "admin" || !user.email) return false;
  return getPlatformAdminEmails().includes(user.email.trim().toLowerCase());
}

export async function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isPlatformAdmin(user)) {
    return res.status(403).json({
      error: "Esta accion requiere un administrador de plataforma.",
      code: "PLATFORM_ADMIN_REQUIRED",
    });
  }
  next();
}

export function isTenantSubscriptionUsable(context: TenantContext | null) {
  if (!context) return false;
  if (context.tenant.status !== "active") return false;
  const today = new Date().toISOString().slice(0, 10);
  if (context.subscription.status === "past_due") {
    if (context.subscription.grace_until && context.subscription.grace_until < today) {
      return false;
    }
    return true;
  }
  if (!["active", "trialing"].includes(context.subscription.status)) return false;
  if (
    context.subscription.current_period_end &&
    context.subscription.current_period_end < today
  ) {
    return false;
  }
  return true;
}

export async function requireUsableTenantSubscription(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const user = await getCurrentUser(req);
  if (user && !user.email_verified) {
    return res.status(403).json({
      error: "Debes confirmar tu correo electrónico antes de operar.",
      code: "EMAIL_NOT_VERIFIED",
    });
  }
  const context = await getTenantContextForUser(user);
  if (!isTenantSubscriptionUsable(context)) {
    return res.status(402).json({
      error: "La suscripcion del tenant no esta activa. Regulariza el plan para operar nuevas acciones.",
      code: "SUBSCRIPTION_INACTIVE",
    });
  }
  next();
}

export async function buildTenantContextPayload(req: Request) {
  const user = await getCurrentUser(req);
  const context = await getTenantContextForUser(user);
  if (!context) return null;
  const usage = await getTenantUsage(context.tenant.id);
  return {
    ...context,
    usage,
    limits: {
      branches: context.plan.max_branches,
      spaces: context.plan.max_spaces,
      users: context.plan.max_users,
      ticketsThisMonth: context.plan.monthly_ticket_limit,
    },
    email_verified: Boolean(user?.email_verified),
    canOperate: isTenantSubscriptionUsable(context) && Boolean(user?.email_verified),
    is_platform_admin: isPlatformAdmin(user),
  };
}

function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (val: unknown) => {
    const str = val === null || val === undefined ? "" : String(val);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  const headerLine = headers.map(escape).join(",");
  const dataLines = rows.map((row) => headers.map((h) => escape(row[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArchiveFromEntries(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.content;
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0, 6); // Flags
    localHeader.writeUInt16LE(0, 8); // Compression method 0 (STORE)
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field len
    nameBuf.copy(localHeader, 30);

    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0, 8); // Flags
    centralHeader.writeUInt16LE(0, 10); // Compression method 0 (STORE)
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);

    localParts.push(localHeader, dataBuf);
    centralParts.push(centralHeader);
    offset += localHeader.length + dataBuf.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

export async function exportTenantDataForRequest(req: Request) {
  const context = await getTenantContextFromRequest(req);
  if (!context) return null;

  const tenantId = context.tenant.id;
  const rawTables = await queryTenantExportTables(tenantId);
  const csvFiles: Record<string, string> = {};
  const counts: Record<string, number> = {};

  for (const [tableName, rows] of Object.entries(rawTables)) {
    csvFiles[`${tableName}.csv`] = rowsToCsv(rows);
    counts[tableName] = rows.length;
  }

  const zipEntries = Object.entries(csvFiles).map(([name, csv]) => ({
    name,
    content: Buffer.from(csv, "utf8"),
  }));
  const zipBuffer = buildZipArchiveFromEntries(zipEntries);

  await recordAuditEvent(req, {
    action: "tenant.export_downloaded",
    entityType: "tenant",
    entityId: tenantId,
    metadata: {
      counts,
      format: String(req.query.format || "json"),
    },
  });

  return {
    tenant: context.tenant,
    generated_at: new Date().toISOString(),
    counts,
    files: csvFiles,
    zipBuffer,
  };
}
