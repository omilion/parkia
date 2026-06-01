import type { NextFunction, Request, Response } from "express";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - startedAt;
    if (req.path.startsWith("/api")) {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });

  next();
}
