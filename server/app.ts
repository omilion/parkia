import "./middleware/asyncErrors";
import express from "express";
import { errorHandler } from "./middleware/errorHandler";
import { originGuard } from "./middleware/originGuard";
import { rateLimit } from "./middleware/rateLimit";
import { assignRequestId, requestLogger } from "./middleware/requestLogger";
import { securityHeaders } from "./middleware/securityHeaders";
import { registerApiRoutes } from "./routes";

type CreateApiAppOptions = {
  logger?: boolean;
};

export function createApiApp(options: CreateApiAppOptions = {}) {
  const app = express();
  const { logger = true } = options;

  app.disable("x-powered-by");
  app.use(assignRequestId);
  app.use(securityHeaders);
  app.use(originGuard);
  app.use(rateLimit);
  // El cuerpo crudo se conserva para verificar la firma de los webhooks de pago.
  app.use(express.json({ limit: "8mb", verify: (req, _res, buffer) => { (req as { rawBody?: Buffer }).rawBody = buffer; } }));
  // Webpay devuelve al cliente con un formulario (application/x-www-form-urlencoded).
  app.use(express.urlencoded({ extended: false, limit: "32kb" }));
  if (logger) app.use(requestLogger);
  registerApiRoutes(app);

  return app;
}

export function attachErrorHandler(app: ReturnType<typeof express>) {
  app.use(errorHandler);
}
