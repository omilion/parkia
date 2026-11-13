import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Proteccion contra SSRF para la URL del rele de la barrera (Shelly).
 *
 * El servidor hace una peticion HTTP a una direccion que escribe el administrador de cada empresa. Sin control,
 * podria apuntarla al propio servidor (127.0.0.1), a la red interna (base de datos, otros servicios) o al servicio
 * de metadatos de la nube (169.254.169.254) y usar a Parkia para llegar ahi.
 *
 * - Solo http/https, sin usuario ni clave en la URL.
 * - Siempre se bloquean: la maquina misma (loopback, 0.0.0.0), enlace local (169.254/16, fe80::/10, incluye metadatos),
 *   multicast/reservadas y CGNAT. Los nombres `localhost`, `*.localhost`, `*.internal` y `*.local` tambien.
 * - Las redes privadas (10/8, 172.16/12, 192.168/16, fc00::/7) se bloquean salvo
 *   PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS=true: una instalacion dentro del estacionamiento (on-premise) habla con su rele
 *   por la red local, un servicio en la nube no deberia.
 * - Se revisan TODAS las direcciones a las que resuelve el nombre, justo antes de cada llamada.
 *
 * Limite conocido: entre esta comprobacion y la conexion, un DNS malicioso podria cambiar su respuesta (rebinding).
 * Por eso ademas se exige un tiempo maximo, y no se siguen redirecciones.
 */

export class UnsafeRelayUrlError extends Error {}

export function allowPrivateRelayNetworks(): boolean {
  return process.env.PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS === "true";
}

function ipv4Parts(ip: string): number[] | null {
  const parts = ip.split(".").map(Number);
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

function classifyIpv4(parts: number[]): "public" | "private" | "forbidden" {
  const [a, b] = parts;
  if (a === 0 || a === 127) return "forbidden"; // esta maquina
  if (a === 169 && b === 254) return "forbidden"; // enlace local: incluye el servicio de metadatos de la nube
  if (a >= 224) return "forbidden"; // multicast, reservadas y broadcast
  if (a === 100 && b >= 64 && b <= 127) return "forbidden"; // CGNAT
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  return "public";
}

/** Direccion IPv6 a 8 grupos de 16 bits (null si no es valida). */
function expandIpv6(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const embedded = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (embedded) {
    const v4 = ipv4Parts(embedded[1]);
    if (!v4) return null;
    text = text.slice(0, -embedded[1].length) + `${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(group => parseInt(group, 16));
  return groups.length === 8 && groups.every(group => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function classifyIpv6(groups: number[]): "public" | "private" | "forbidden" {
  const isMappedV4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
  if (isMappedV4) return classifyIpv4([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255]);
  if (groups.every(group => group === 0)) return "forbidden"; // ::
  if (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1) return "forbidden"; // ::1
  if ((groups[0] & 0xffc0) === 0xfe80) return "forbidden"; // fe80::/10 enlace local
  if ((groups[0] & 0xff00) === 0xff00) return "forbidden"; // multicast
  if ((groups[0] & 0xfe00) === 0xfc00) return "private"; // fc00::/7 (ULA)
  return "public";
}

/** ¿Se puede conectar el servidor a esta direccion IP? */
export function isForbiddenAddress(ip: string, allowPrivate = allowPrivateRelayNetworks()): boolean {
  const kind = isIP(ip) === 4
    ? classifyIpv4(ipv4Parts(ip) ?? [0, 0, 0, 0])
    : isIP(ip) === 6
      ? classifyIpv6(expandIpv6(ip) ?? [0, 0, 0, 0, 0, 0, 0, 0])
      : "forbidden"; // lo que no se entiende, no se usa
  return kind === "forbidden" || (kind === "private" && !allowPrivate);
}

const BLOCKED_NAMES = /(^|\.)(localhost|internal|local|localdomain)$/i;

/** Valida la URL de un rele y devuelve la URL ya normalizada. Lanza UnsafeRelayUrlError si no es segura. */
export async function assertSafeRelayUrl(raw: string, options: { allowPrivate?: boolean } = {}): Promise<URL> {
  const allowPrivate = options.allowPrivate ?? allowPrivateRelayNetworks();
  let url: URL;
  try { url = new URL(raw); } catch { throw new UnsafeRelayUrlError("La URL del rele no es valida"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeRelayUrlError("La URL del rele debe ser http o https");
  if (url.username || url.password) throw new UnsafeRelayUrlError("La URL del rele no puede incluir usuario ni clave");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_NAMES.test(host)) throw new UnsafeRelayUrlError("La URL del rele apunta a una direccion interna no permitida");

  const addresses = isIP(host) ? [host] : await lookup(host, { all: true }).then(found => found.map(item => item.address)).catch(() => []);
  if (!addresses.length) throw new UnsafeRelayUrlError("No se pudo resolver el nombre de la URL del rele");
  if (addresses.some(address => isForbiddenAddress(address, allowPrivate))) {
    throw new UnsafeRelayUrlError(
      allowPrivate
        ? "La URL del rele apunta a una direccion no permitida"
        : "La URL del rele apunta a una red interna o no permitida. Usa una direccion publica del rele (o, en una instalacion local, activa PARKIA_DEVICE_ALLOW_PRIVATE_NETWORKS)",
    );
  }
  return url;
}
