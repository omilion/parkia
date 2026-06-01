import type { NextFunction, Request, Response } from "express";

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  console.error(`Unhandled error on ${req.method} ${req.path}`, error);

  if (res.headersSent) return;

  res.status(500).json({
    error: "Internal server error",
  });
}
