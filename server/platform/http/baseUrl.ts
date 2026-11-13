import type { Request } from "express";

/**
 * URL publica del sistema para armar enlaces que salen de el (correos, retorno de pasarelas).
 * Usa APP_URL cuando es una URL valida; si no (p. ej. el valor de ejemplo "MY_APP_URL"), el host de la peticion.
 */
export function publicBaseUrl(req?: Pick<Request, "protocol" | "get">): string {
  const configured = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin + parsed.pathname.replace(/\/+$/, "");
    } catch {
      /* Valor de ejemplo o mal escrito: se ignora. */
    }
  }
  if (req) return `${req.protocol}://${req.get("host")}`;
  return "http://localhost:8080";
}
