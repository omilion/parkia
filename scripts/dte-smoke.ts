/**
 * Prueba manual contra el ambiente de CERTIFICACION del SII (Maullin / apicert / pangal).
 * No toca la base de datos. Lee el certificado y el CAF desde disco; no los copia ni los imprime.
 *
 * Uso (PowerShell):
 *   $env:DTE_PFX_PATH="C:\ruta\certificado.pfx"; $env:DTE_PFX_PASSWORD="..."
 *   $env:DTE_RUT_EMISOR="76123456-7"
 *   npm run dte:smoke -- auth                 # obtiene token de facturas y de boletas
 *   npm run dte:smoke -- boleta               # arma, firma y envia una boleta de prueba (requiere CAF 39)
 *   npm run dte:smoke -- boleta --dry-run     # solo arma y firma; guarda el XML sin enviarlo
 *   npm run dte:smoke -- status <trackId> [boleta|dte]
 *
 * Variables para "boleta": DTE_CAF_PATH, DTE_FOLIO, DTE_RAZON_SOCIAL, DTE_GIRO, DTE_DIRECCION, DTE_COMUNA,
 * DTE_FECHA_RESOLUCION (fecha de autorizacion de pruebas, YYYY-MM-DD), DTE_NUMERO_RESOLUCION (0 en certificacion),
 * DTE_RUT_ENVIA (si el certificado no trae el RUT), DTE_MONTO (por defecto 1000), DTE_OUT_DIR (por defecto ./tmp-dte).
 *
 * Produccion queda bloqueada: requiere DTE_ENV=produccion y DTE_ALLOW_PRODUCTION=si.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getSiiToken } from "../server/modules/dte/providers/sii/auth";
import { buildDte } from "../server/modules/dte/providers/sii/builder";
import { parseCaf } from "../server/modules/dte/providers/sii/caf";
import { daysUntilExpiry, loadPfx } from "../server/modules/dte/providers/sii/cert";
import { queryBoletaUploadStatus, queryDteUploadStatus, uploadBoletaEnvelope } from "../server/modules/dte/providers/sii/client";
import { getSiiEndpoints } from "../server/modules/dte/providers/sii/endpoints";
import { buildEnvelope } from "../server/modules/dte/providers/sii/envelope";
import { verifySignatures } from "../server/modules/dte/providers/sii/signer";
import { chileDate } from "../server/modules/dte/providers/sii/xml";
import type { SiiEnvironment } from "../server/modules/dte/types";

function env(name: string, fallback?: string) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    console.error(`Falta la variable de entorno ${name}`);
    process.exit(2);
  }
  return value;
}

const [command = "auth", ...args] = process.argv.slice(2);
const environment = (process.env.DTE_ENV || "certificacion") as SiiEnvironment;
const allowProduction = environment === "produccion" && process.env.DTE_ALLOW_PRODUCTION === "si";
const endpoints = getSiiEndpoints(environment, { allowProduction });

const cert = loadPfx(readFileSync(env("DTE_PFX_PATH")), env("DTE_PFX_PASSWORD"));
const rutEmisor = env("DTE_RUT_EMISOR");
const rutEnvia = process.env.DTE_RUT_ENVIA || cert.subjectRut;

console.log(`Ambiente: ${environment}`);
console.log(`Certificado: ${cert.subjectName} | RUT titular: ${cert.subjectRut ?? "(no detectado, use DTE_RUT_ENVIA)"} | vence en ${daysUntilExpiry(cert)} dias`);

async function main() {
  if (command === "auth") {
    console.log("Token facturas/notas:", (await getSiiToken({ kind: "dte", endpoints, cert })).slice(0, 6) + "...");
    console.log("Token boletas:", (await getSiiToken({ kind: "boleta", endpoints, cert })).slice(0, 6) + "...");
    console.log("OK: el certificado autentica contra el SII.");
    return;
  }

  if (command === "boleta") {
    if (!rutEnvia) throw new Error("No se detecto el RUT del titular: defina DTE_RUT_ENVIA");
    const caf = parseCaf(readFileSync(env("DTE_CAF_PATH")), { rutEmisor, type: 39 });
    if (caf.environment !== environment) throw new Error(`El CAF es de ${caf.environment} y el ambiente elegido es ${environment}`);
    const folio = Number(env("DTE_FOLIO", String(caf.folioFrom)));
    const monto = Number(process.env.DTE_MONTO || 1000);

    const dte = buildDte({
      type: 39,
      folio,
      fechaEmision: chileDate(),
      emisor: {
        rut: rutEmisor,
        razonSocial: env("DTE_RAZON_SOCIAL"),
        giro: env("DTE_GIRO"),
        direccion: env("DTE_DIRECCION"),
        comuna: env("DTE_COMUNA"),
      },
      items: [{ nombre: "Servicio de estacionamiento", descripcion: "Boleta de prueba Parkia", monto }],
    }, caf);

    const envelope = buildEnvelope([dte], {
      rutEmisor,
      rutEnvia,
      fechaResolucion: env("DTE_FECHA_RESOLUCION"),
      numeroResolucion: Number(process.env.DTE_NUMERO_RESOLUCION || 0),
    }, cert);

    const signatures = verifySignatures(envelope.xml);
    if (!signatures.ok) throw new Error(`Firmas invalidas: ${signatures.errors.join(", ")}`);

    const outDir = resolve(process.env.DTE_OUT_DIR || "tmp-dte");
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, `EnvioBOLETA-F${folio}.xml`);
    writeFileSync(file, envelope.bytes);
    console.log(`Sobre firmado guardado en ${file} (${signatures.count} firmas validas)`);

    if (args.includes("--dry-run")) return;
    const token = await getSiiToken({ kind: "boleta", endpoints, cert });
    const result = await uploadBoletaEnvelope({ endpoints, token, rutEmisor, rutEnvia, envelope: envelope.bytes, fileName: `EnvioBOLETA-F${folio}.xml` });
    console.log(`Enviado. Track ID: ${result.trackId}`);
    console.log(`Consulte el estado con: npm run dte:smoke -- status ${result.trackId} boleta`);
    return;
  }

  if (command === "status") {
    const trackId = args[0];
    const kind = (args[1] || "boleta") as "boleta" | "dte";
    if (!trackId) throw new Error("Indique el track id");
    const token = await getSiiToken({ kind, endpoints, cert });
    const query = { endpoints, token, rutEmisor, trackId };
    const status = kind === "boleta" ? await queryBoletaUploadStatus(query) : await queryDteUploadStatus(query);
    console.log(JSON.stringify({ code: status.code, state: status.state, message: status.message, detail: status.detail }, null, 2));
    return;
  }

  throw new Error(`Comando desconocido: ${command}. Use auth, boleta o status.`);
}

main().catch(error => {
  console.error("ERROR:", error instanceof Error ? error.message : error);
  if (error?.detail) console.error("Detalle del SII:", typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail));
  process.exit(1);
});
