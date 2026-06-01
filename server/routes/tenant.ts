import type { Express } from "express";
import { getCurrentUser, requireAnyRole } from "../auth/sessions";
import { getTenantContextForUser, getTenantUsage, isTenantSubscriptionUsable } from "../tenant";

export function registerTenantRoutes(app: Express) {
  app.get("/api/tenant/context", requireAnyRole(["admin", "finance"]), (req, res) => {
    const context = getTenantContextForUser(getCurrentUser(req));
    if (!context) return res.status(404).json({ error: "Tenant no configurado para el usuario actual" });
    const usage = getTenantUsage(context.tenant.id);
    res.json({
      ...context,
      usage,
      limits: {
        branches: context.plan.max_branches,
        spaces: context.plan.max_spaces,
        users: context.plan.max_users,
        ticketsThisMonth: context.plan.monthly_ticket_limit,
      },
      canOperate: isTenantSubscriptionUsable(context),
    });
  });
}
