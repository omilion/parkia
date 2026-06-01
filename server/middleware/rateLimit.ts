import type { NextFunction, Request, Response } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const WINDOW_MS = 60_000;
const GENERAL_MUTATION_LIMIT = 600;
const AUTH_LIMIT = 40;

function isDisabled() {
  return process.env.NODE_ENV === "test" || process.env.RATE_LIMIT_DISABLED === "true";
}

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function routeLimit(req: Request) {
  if (req.path === "/api/auth/login") return AUTH_LIMIT;
  if (MUTATION_METHODS.has(req.method)) return GENERAL_MUTATION_LIMIT;
  return null;
}

function cleanupExpired(now: number) {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  if (isDisabled()) return next();

  const limit = routeLimit(req);
  if (!limit) return next();

  const now = Date.now();
  cleanupExpired(now);
  const key = `${clientKey(req)}:${req.path}:${req.method}`;
  const current = buckets.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + WINDOW_MS };

  bucket.count += 1;
  buckets.set(key, bucket);

  const remaining = Math.max(limit - bucket.count, 0);
  res.setHeader("X-RateLimit-Limit", String(limit));
  res.setHeader("X-RateLimit-Remaining", String(remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

  if (bucket.count > limit) {
    return res.status(429).json({ error: "Demasiadas solicitudes. Intenta nuevamente en unos minutos." });
  }

  next();
}

export function isRateLimitEnabled() {
  return !isDisabled();
}
