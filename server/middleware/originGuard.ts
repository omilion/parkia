import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigins() {
  return [
    process.env.APP_URL,
    ...(process.env.TRUSTED_ORIGINS || "").split(","),
  ]
    .map((origin) => origin?.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    });
}

function requestOrigin(req: Request) {
  const origin = req.headers.origin;
  if (origin) return origin;

  const referer = req.headers.referer;
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function sameHostOrigin(req: Request, origin: string) {
  try {
    const parsed = new URL(origin);
    return parsed.host === req.get("host");
  } catch {
    return false;
  }
}

// El cliente vuelve desde la pasarela con un POST de otro origen y los avisos de pago no traen sesion:
// ambos se autentican por el token de la transaccion o por la firma, no por el origen.
const CROSS_ORIGIN_PATHS = ["/api/public/payments/return/", "/api/public/payments/webhook/"];

export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CROSS_ORIGIN_PATHS.some((prefix) => req.path.startsWith(prefix))) return next();

  const origin = requestOrigin(req);
  if (!origin) return next();

  if (sameHostOrigin(req, origin) || configuredOrigins().includes(origin)) {
    return next();
  }

  return res.status(403).json({ error: "Cross-origin request rejected" });
}
