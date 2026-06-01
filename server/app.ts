import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { originGuard } from "./middleware/originGuard";
import { rateLimit } from "./middleware/rateLimit";
import { requestLogger } from "./middleware/requestLogger";
import { securityHeaders } from "./middleware/securityHeaders";
import { registerApiRoutes } from "./routes";

type CreateApiAppOptions = {
  logger?: boolean;
};

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = express();
  const { logger = true } = options;

  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(originGuard);
  app.use(rateLimit);
  app.use(express.json({ limit: "8mb" }));
  if (logger) app.use(requestLogger);
  registerApiRoutes(app);

  return app;
}

export function attachErrorHandler(app: ReturnType<typeof express>) {
  app.use(errorHandler);
}
