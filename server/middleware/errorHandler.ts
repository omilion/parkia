import type { NextFunction, Request, Response } from "express";
import { captureException } from "../platform/http/logger";
import { PlanLimitError } from "../tenant";
import type { RequestWithId } from "./requestLogger";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof PlanLimitError) {
    if (!res.headersSent) res.status(error.status).json(error.toJSON());
    return;
  }

  captureException(error, req);
  console.error(`Unhandled error on ${req.method} ${req.path}`, error);

  if (res.headersSent) return;

  const requestId = (req as RequestWithId).requestId || undefined;
  res.status(500).json({
    error: "Internal server error",
    ...(requestId ? { request_id: requestId } : {}),
  });
}
