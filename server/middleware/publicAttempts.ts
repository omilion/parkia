/**
 * Limite de intentos para rutas publicas (sin sesion): validacion de convenios, paginas de pago.
 * Cuenta por clave en ventanas de 10 minutos; se usa ademas del limite general de escritura.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function allowPublicAttempt(key: string, limit = Number(process.env.PARKIA_PUBLIC_RATE_LIMIT || 20)) {
  const now = Date.now();
  const current = attempts.get(key);
  const bucket = current && current.resetAt > now ? current : { count: 0, resetAt: now + 10 * 60_000 };
  bucket.count += 1;
  attempts.set(key, bucket);
  if (attempts.size > 5000) for (const [stored, value] of attempts) if (value.resetAt <= now) attempts.delete(stored);
  return bucket.count <= limit;
}

export function resetPublicAttemptsForTesting() {
  attempts.clear();
}
