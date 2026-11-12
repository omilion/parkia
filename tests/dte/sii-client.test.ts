import assert from "node:assert/strict";
import { test } from "node:test";
import { clearTokenCache, getSiiToken } from "../../server/modules/dte/providers/sii/auth";
import { loadPfx } from "../../server/modules/dte/providers/sii/cert";
import { parseCaf } from "../../server/modules/dte/providers/sii/caf";
import { queryBoletaUploadStatus, queryDteUploadStatus, uploadDteEnvelope } from "../../server/modules/dte/providers/sii/client";
import { getSiiEndpoints } from "../../server/modules/dte/providers/sii/endpoints";
import { SiiError } from "../../server/modules/dte/providers/sii/errors";
import { verifySignatures } from "../../server/modules/dte/providers/sii/signer";
import { SiiDteProvider } from "../../server/modules/dte/providers/sii";
import { boletaInput, createTestCaf, createTestPfx, PFX_PASSWORD, RUT_EMISOR } from "./fixtures";

const cert = loadPfx(createTestPfx(), PFX_PASSWORD);
const endpoints = getSiiEndpoints("certificacion");

type Call = { url: string; init?: RequestInit; body?: string };

/** fetch simulado: responde segun la URL y registra cada llamada. Ningun test sale a la red. */
function mockFetch(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : undefined;
    const call = { url, init, body };
    calls.push(call);
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix));
    if (!key) throw new Error(`URL no simulada: ${url}`);
    return routes[key](call);
  };
  return { fetch, calls };
}

function soapReturn(tag: string, inner: string) {
  const escaped = inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return new Response(`<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><ns1:${tag.replace("Return", "Response")} xmlns:ns1="urn:x"><ns1:${tag}>${escaped}</ns1:${tag}></ns1:${tag.replace("Return", "Response")}></soapenv:Body></soapenv:Envelope>`);
}

const seedXml = `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><SEMILLA>012345678901</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;
const tokenXml = (token: string) => `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY><TOKEN>${token}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO><GLOSA>Token Creado</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`;

test("endpoints: produccion bloqueada salvo autorizacion explicita", () => {
  assert.match(endpoints.dte.seed, /^https:\/\/maullin\.sii\.cl\//);
  assert.match(endpoints.boleta.seed, /^https:\/\/apicert\.sii\.cl\//);
  assert.throws(() => getSiiEndpoints("produccion"), /bloqueado/);
  assert.match(getSiiEndpoints("produccion", { allowProduction: true }).dte.seed, /palena/);
});

test("token DTE: semilla SOAP, semilla firmada y cache", async () => {
  clearTokenCache();
  let signedSeed = "";
  const { fetch, calls } = mockFetch({
    [endpoints.dte.seed]: () => soapReturn("getSeedReturn", seedXml),
    [endpoints.dte.token]: call => {
      signedSeed = /<!\[CDATA\[([\s\S]*)\]\]>/.exec(call.body || "")![1];
      return soapReturn("getTokenReturn", tokenXml("TOKENDTE123"));
    },
  });
  const token = await getSiiToken({ kind: "dte", endpoints, cert, http: { fetch } });
  assert.equal(token, "TOKENDTE123");
  assert.match(signedSeed, /^<getToken><item><Semilla>012345678901<\/Semilla><\/item><Signature/);
  assert.match(signedSeed, /<Reference URI="">/);
  assert.deepEqual(verifySignatures(signedSeed), { ok: true, count: 1, errors: [] });

  await getSiiToken({ kind: "dte", endpoints, cert, http: { fetch } });
  assert.equal(calls.length, 2, "la segunda llamada usa el token en cache");
  await getSiiToken({ kind: "dte", endpoints, cert, http: { fetch }, forceRefresh: true });
  assert.equal(calls.length, 4);
});

test("token DTE: semilla rechazada se informa", async () => {
  clearTokenCache();
  const { fetch } = mockFetch({
    [endpoints.dte.seed]: () => soapReturn("getSeedReturn", seedXml.replace("<ESTADO>00</ESTADO>", "<ESTADO>-1</ESTADO>")),
  });
  await assert.rejects(getSiiToken({ kind: "dte", endpoints, cert, http: { fetch } }), (error: unknown) => error instanceof SiiError && /semilla/.test(error.message));
});

test("token boletas: API REST con semilla firmada", async () => {
  clearTokenCache();
  const { fetch, calls } = mockFetch({
    [endpoints.boleta.seed]: () => new Response(seedXml),
    [endpoints.boleta.token]: () => new Response(tokenXml("TOKENBOL456")),
  });
  assert.equal(await getSiiToken({ kind: "boleta", endpoints, cert, http: { fetch } }), "TOKENBOL456");
  assert.equal(calls[1].init?.method, "POST");
  assert.match(calls[1].body || "", /<Semilla>012345678901<\/Semilla>/);
});

test("subida DTE: STATUS 0 entrega track id; otros estados se traducen", async () => {
  const ok = mockFetch({
    [endpoints.dte.upload]: call => {
      assert.equal((call.init?.headers as Record<string, string>).Cookie, "TOKEN=T1");
      const form = call.init?.body as FormData;
      assert.equal(form.get("rutCompany"), "76192083");
      assert.equal(form.get("dvCompany"), "9");
      return new Response("<?xml version=\"1.0\"?><RECEPCIONDTE><RUTSUBMITTER>11111111-1</RUTSUBMITTER><FILE>envio.xml</FILE><TIMESTAMP>2026-11-11 10:00:00</TIMESTAMP><STATUS>0</STATUS><TRACKID>0123456789</TRACKID></RECEPCIONDTE>");
    },
  });
  const result = await uploadDteEnvelope({ endpoints, token: "T1", rutEmisor: RUT_EMISOR, rutEnvia: "11111111-1", envelope: Buffer.from("<x/>"), http: { fetch: ok.fetch } });
  assert.equal(result.trackId, "0123456789");

  const bad = mockFetch({ [endpoints.dte.upload]: () => new Response("<RECEPCIONDTE><STATUS>7</STATUS></RECEPCIONDTE>") });
  await assert.rejects(
    uploadDteEnvelope({ endpoints, token: "T1", rutEmisor: RUT_EMISOR, rutEnvia: "11111111-1", envelope: Buffer.from("<x/>"), http: { fetch: bad.fetch } }),
    (error: unknown) => error instanceof SiiError && error.code === "SII_UPLOAD_7" && /esquema/.test(error.message),
  );
});

test("estado de envio: DTE por SOAP y boletas por REST", async () => {
  const dte = mockFetch({
    [endpoints.dte.queryUpload]: () => soapReturn("getEstUpReturn", "<SII:RESPUESTA xmlns:SII=\"x\"><SII:RESP_HDR><ESTADO>RCT</ESTADO><GLOSA>Rechazado por error en caratula</GLOSA></SII:RESP_HDR></SII:RESPUESTA>"),
  });
  const dteStatus = await queryDteUploadStatus({ endpoints, token: "T", rutEmisor: RUT_EMISOR, trackId: "1", http: { fetch: dte.fetch } });
  assert.equal(dteStatus.state, "rejected");
  assert.equal(dteStatus.message, "Rechazado por error en caratula");

  const boleta = mockFetch({
    [endpoints.boleta.uploadStatus]: call => {
      assert.ok(call.url.endsWith("/76192083-9-555"));
      return new Response(JSON.stringify({ estado: "EPR", estadistica: [{ tipo: 39, informados: 2, aceptados: 2, rechazados: 0, reparos: 0 }] }));
    },
  });
  const boletaStatus = await queryBoletaUploadStatus({ endpoints, token: "T", rutEmisor: RUT_EMISOR, trackId: "555", http: { fetch: boleta.fetch } });
  assert.equal(boletaStatus.state, "accepted");
});

test("proveedor SII: emite, arma el sobre, obtiene token y sube boletas", async () => {
  clearTokenCache();
  const caf = parseCaf(createTestCaf({ type: 39 }));
  let uploadedXml = "";
  const { fetch } = mockFetch({
    [endpoints.boleta.seed]: () => new Response(seedXml),
    [endpoints.boleta.token]: () => new Response(tokenXml("TB")),
    [endpoints.boleta.upload]: async call => {
      uploadedXml = Buffer.from(await (await (call.init?.body as FormData).get("archivo") as Blob).arrayBuffer()).toString("latin1");
      return new Response(JSON.stringify({ rut_emisor: "76192083-9", trackid: 9999, estado: "REC" }));
    },
  });
  const provider = new SiiDteProvider({
    environment: "certificacion",
    rutEmisor: RUT_EMISOR,
    fechaResolucion: "2026-11-01",
    numeroResolucion: 0,
    certificate: cert,
    resolveCaf: () => caf,
    http: { fetch },
  });
  const doc = await provider.issue(boletaInput(10));
  const result = await provider.sendBatch([doc]);
  assert.equal(result.trackId, "9999");
  assert.match(uploadedXml, /<EnvioBOLETA /);
  assert.match(uploadedXml, /<RutEnvia>11111111-1<\/RutEnvia>/);
  assert.equal(verifySignatures(uploadedXml).ok, true);
});
