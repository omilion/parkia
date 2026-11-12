import type { Express } from "express";
import { requireAnyRole } from "../../auth/sessions";
import { registerBankRoutes } from "./bank/routes";
import { registerClosuresRoutes } from "./closures/routes";
import { registerExpensesRoutes } from "./expenses/routes";
import { registerReceivablesRoutes } from "./receivables/routes";
import { registerReportsRoutes } from "./reports/routes";

export function registerFinanceRoutes(app: Express) {
  app.use("/api/finance", requireAnyRole(["admin", "finance"]));

  registerReportsRoutes(app);
  registerExpensesRoutes(app);
  registerReceivablesRoutes(app);
  registerClosuresRoutes(app);
  registerBankRoutes(app);
}

