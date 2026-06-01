import type { NextFunction, Request, Response } from "express";
import type { AuthUser } from "./auth/sessions";
import { getCurrentUser } from "./auth/sessions";
import { db } from "./db";

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
  };
};

function queryTenantContextForUser(userId: number) {
  return db.prepare(`
    SELECT t.id as tenant_id,
           t.name as tenant_name,
           t.rut as tenant_rut,
           t.status as tenant_status,
           tm.role as membership_role,
           p.id as plan_id,
           p.code as plan_code,
           p.name as plan_name,
           p.max_branches,
           p.max_spaces,
           p.max_users,
           p.monthly_ticket_limit,
           p.price_clp,
           s.id as subscription_id,
           s.status as subscription_status,
           s.current_period_start,
           s.current_period_end
    FROM tenant_memberships tm
    JOIN tenants t ON t.id = tm.tenant_id
    JOIN subscriptions s ON s.tenant_id = t.id
    JOIN plans p ON p.id = s.plan_id
    WHERE tm.staff_id = ?
      AND tm.status = 'active'
      AND t.status != 'archived'
    ORDER BY
      CASE s.status WHEN 'active' THEN 0 WHEN 'trialing' THEN 1 ELSE 2 END,
      tm.id ASC
    LIMIT 1
  `).get(userId) as any | undefined;
}

function ensureDefaultTenantMembership(user: AuthUser) {
  const tenant = db.prepare("SELECT id FROM tenants WHERE status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (!tenant) return;
  db.prepare(`
    INSERT OR IGNORE INTO tenant_memberships (tenant_id, staff_id, role, status)
    VALUES (?, ?, ?, 'active')
  `).run(tenant.id, user.id, user.role === "admin" ? "owner" : "member");
}

export function getTenantContextForUser(user: AuthUser | null | undefined): TenantContext | null {
  if (!user) return null;
  let row = queryTenantContextForUser(user.id);
  if (!row) {
    ensureDefaultTenantMembership(user);
    row = queryTenantContextForUser(user.id);
  }
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
    },
  };
}

export function getTenantUsage(tenantId: number) {
  const branches = db.prepare("SELECT COUNT(*) as count FROM branches WHERE tenant_id = ? AND status = 'active'").get(tenantId) as { count: number };
  const spaces = db.prepare("SELECT COUNT(*) as count FROM spaces WHERE tenant_id = ? AND type = 'parking'").get(tenantId) as { count: number };
  const users = db.prepare("SELECT COUNT(*) as count FROM tenant_memberships WHERE tenant_id = ? AND status = 'active'").get(tenantId) as { count: number };
  const ticketsThisMonth = db.prepare(`
    SELECT COUNT(*) as count
    FROM visitor_tickets
    WHERE tenant_id = ?
      AND strftime('%Y-%m', entry_time) = strftime('%Y-%m', 'now')
  `).get(tenantId) as { count: number };
  return {
    branches: Number(branches.count || 0),
    spaces: Number(spaces.count || 0),
    users: Number(users.count || 0),
    ticketsThisMonth: Number(ticketsThisMonth.count || 0),
  };
}

export function isTenantSubscriptionUsable(context: TenantContext | null) {
  if (!context) return false;
  if (context.tenant.status !== "active") return false;
  if (!["active", "trialing"].includes(context.subscription.status)) return false;
  if (context.subscription.current_period_end && context.subscription.current_period_end < new Date().toISOString().slice(0, 10)) return false;
  return true;
}

export function requireUsableTenantSubscription(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const user = getCurrentUser(req);
  const context = getTenantContextForUser(user);
  if (!isTenantSubscriptionUsable(context)) {
    return res.status(402).json({
      error: "La suscripcion del tenant no esta activa. Regulariza el plan para operar nuevas acciones.",
      code: "SUBSCRIPTION_INACTIVE",
    });
  }
  next();
}
