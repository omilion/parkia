import { randomUUID } from "crypto";
import type { NextFunction, Request, Response } from "express";
import { logStructured } from "../platform/http/logger";

export type RequestWithId = Request & { requestId?: string };

export function assignRequestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = raw && String(raw).trim() ? String(raw).trim().slice(0, 128) : randomUUID();
  (req as RequestWithId).requestId = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    if (req.path.startsWith("/api")) {
      const requestId = (req as RequestWithId).requestId || null;
      if (process.env.PARKIA_LOG_FORMAT === "json" || process.env.NODE_ENV === "production") {
        logStructured("info", `${req.method} ${req.path}`, {
          request_id: requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: duration,
        });
      } else {
        console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
      }
    }
  });

  next();
}
