import type { Express } from "express";
import { requireAuth } from "./auth/sessions";
import { registerAccessRoutes } from "./routes/access";
import { registerAdminRoutes } from "./routes/admin";
import { registerAuthRoutes } from "./routes/auth";
import { registerBranchesRoutes } from "./routes/branches";
import { registerClientsRoutes } from "./routes/clients";
import { registerContractsRoutes } from "./routes/contracts";
import { registerDocumentsRoutes } from "./routes/documents";
import { registerFinanceRoutes } from "./routes/finance";
import { registerGeneralRoutes } from "./routes/general";
import { registerHealthRoutes } from "./routes/health";
import { registerPaymentsRoutes } from "./routes/payments";
import { registerSpacesRoutes } from "./routes/spaces";
import { registerTasksRoutes } from "./routes/tasks";
import { registerTenantRoutes } from "./routes/tenant";
import { registerVisitorsRoutes } from "./routes/visitors";
import { requireUsableTenantSubscription } from "./tenant";

export function registerApiRoutes(app: Express) {
  registerHealthRoutes(app);
  registerAuthRoutes(app);
  app.use("/api", requireAuth);
  registerTenantRoutes(app);
  app.use("/api", requireUsableTenantSubscription);
  registerBranchesRoutes(app);
  registerGeneralRoutes(app);
  registerContractsRoutes(app);
  registerClientsRoutes(app);
  registerSpacesRoutes(app);
  registerVisitorsRoutes(app);
  registerPaymentsRoutes(app);
  registerAccessRoutes(app);
  registerAdminRoutes(app);
  registerFinanceRoutes(app);
  registerDocumentsRoutes(app);
  registerTasksRoutes(app);
}
