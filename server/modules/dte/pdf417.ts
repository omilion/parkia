import bwipjs from "bwip-js/node";

/**
 * Codigo PDF417 del Timbre Electronico, para la representacion impresa (carta o termica 80 mm).
 * VERIFICAR-SII: el SII exige nivel de correccion de errores 5 y define dimensiones minimas
 * del modulo; revisar contra el "Instructivo tecnico" al disenar el PDF final.
 */

const OPTIONS = {
  bcid: "pdf417",
  eclevel: 5,
  columns: 12,
  scaleX: 2,
  scaleY: 2,
  rowmult: 2,
  // El TED va codificado en ISO-8859-1.
  binarytext: true,
} as const;

/** Convierte el TED (texto latin1) a la cadena binaria que espera bwip-js. */
function latin1Text(tedXml: string) {
  return Buffer.from(tedXml, "latin1").toString("latin1");
}

export async function tedToPng(tedXml: string): Promise<Buffer> {
  return bwipjs.toBuffer({ ...OPTIONS, text: latin1Text(tedXml) });
}

export function tedToSvg(tedXml: string): string {
  return bwipjs.toSVG({ ...OPTIONS, text: latin1Text(tedXml) });
}
