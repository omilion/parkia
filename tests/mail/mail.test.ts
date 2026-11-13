import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTemplate, assertSafeUrl, escapeHtml } from "../../server/platform/mail/templates";
import { createConsoleTransport, createMemoryTransport, createResendTransport, createSmtpTransport, getMailConfig, memoryOutbox, resetMemoryOutbox } from "../../server/platform/mail/transports";
import { MailDeliveryError } from "../../server/platform/mail/types";
import { publicBaseUrl } from "../../server/platform/http/baseUrl";

const message = { to: "ana@example.cl", subject: "Hola", text: "texto", html: "<p>texto</p>" };

test("plantillas: escapan los datos y solo aceptan enlaces http(s)", () => {
  const rendered = renderTemplate("password_reset", { name: `<img src=x onerror="alert(1)">`, url: "https://app.parkia.cl/restablecer?token=abc&x=1", expiresMinutes: 30 });
  assert.ok(!rendered.html.includes("<img"), "el nombre se escapa");
  assert.ok(rendered.html.includes("&lt;img"));
  assert.ok(rendered.html.includes("token=abc&amp;x=1"), "el enlace del boton se escapa para HTML");
  assert.ok(rendered.text.includes("https://app.parkia.cl/restablecer?token=abc&x=1"), "el texto plano conserva el enlace tal cual");
  assert.match(rendered.text, /30 minutos/);

  for (const bad of ["javascript:alert(1)", "data:text/html,hola", "ftp://x.cl/a", "no es url"]) {
    assert.throws(() => assertSafeUrl(bad), undefined, bad);
    assert.throws(() => renderTemplate("notice", { title: "t", paragraphs: ["p"], cta: { label: "ir", url: bad } }), undefined, bad);
  }
  assert.equal(escapeHtml(`"a" & 'b' <c>`), "&quot;a&quot; &amp; &#39;b&#39; &lt;c&gt;");
});

test("plantillas: aviso generico y verificacion tienen asunto, texto y HTML", () => {
  const notice = renderTemplate("notice", { title: "Tu cuota vence pronto", paragraphs: ["Vence el 5.", "Gracias."], cta: { label: "Pagar", url: "https://x.cl/pagar/r_1" }, footnote: "Pie" });
  assert.equal(notice.subject, "Tu cuota vence pronto");
  assert.match(notice.html, /lang="es-CL"/);
  assert.match(notice.text, /Pagar: https:\/\/x\.cl\/pagar\/r_1/);
  const verification = renderTemplate("email_verification", { name: "Ana", url: "https://x.cl/verificar?t=1", expiresHours: 24 });
  assert.match(verification.subject, /Confirma tu correo/);
  assert.match(verification.text, /24 horas/);
});

test("configuracion: valores por omision segun el entorno y problemas de configuracion", () => {
  assert.equal(getMailConfig({ NODE_ENV: "test" }).transport, "memory");
  assert.equal(getMailConfig({ NODE_ENV: "development" }).transport, "console");
  const production = getMailConfig({ NODE_ENV: "production" });
  assert.deepEqual([production.transport, production.configured], ["disabled", false], "en produccion nunca se simula un envio");

  const noUrl = getMailConfig({ NODE_ENV: "production", PARKIA_MAIL_TRANSPORT: "smtp", PARKIA_MAIL_FROM: "Parkia <a@b.cl>" });
  assert.deepEqual([noUrl.configured, noUrl.problem], [false, "Falta PARKIA_SMTP_URL"]);
  const noFrom = getMailConfig({ NODE_ENV: "production", PARKIA_MAIL_TRANSPORT: "resend", RESEND_API_KEY: "k" });
  assert.match(noFrom.problem ?? "", /PARKIA_MAIL_FROM/);
  const ok = getMailConfig({ NODE_ENV: "production", PARKIA_MAIL_TRANSPORT: "resend", RESEND_API_KEY: "k", PARKIA_MAIL_FROM: "Parkia <no-reply@parkia.cl>" });
  assert.deepEqual([ok.transport, ok.configured, ok.from], ["resend", true, "Parkia <no-reply@parkia.cl>"]);
  assert.match(getMailConfig({ NODE_ENV: "production", PARKIA_MAIL_TRANSPORT: "console" }).problem ?? "", /consola/);
  assert.match(getMailConfig({ NODE_ENV: "development", PARKIA_MAIL_TRANSPORT: "carrierpigeon" }).problem ?? "", /no es valido/);
});

test("transporte Resend: arma la solicitud y clasifica los errores", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const respond = (status: number, body: unknown) => (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }); }) as typeof fetch;

  const ok = createResendTransport({ apiKey: "re_123", fetchImpl: respond(200, { id: "email-1" }) });
  assert.deepEqual(await ok.send(message, "Parkia <no-reply@parkia.cl>"), { providerId: "email-1" });
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, "Bearer re_123");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)).to, ["ana@example.cl"]);

  const classify = async (status: number) => {
    const transport = createResendTransport({ apiKey: "k", fetchImpl: respond(status, { message: "x" }) });
    return await transport.send(message, "f").then(() => null, (error: MailDeliveryError) => error.retryable);
  };
  assert.equal(await classify(422), false, "una direccion invalida no se reintenta");
  assert.equal(await classify(403), false);
  assert.equal(await classify(429), true, "el limite de uso se reintenta");
  assert.equal(await classify(503), true);

  const down = createResendTransport({ apiKey: "k", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
  await assert.rejects(() => down.send(message, "f"), (error: MailDeliveryError) => error.retryable === true && !/fetch failed/.test(error.message));
});

test("transporte SMTP: 5xx es definitivo, lo demas se reintenta", async () => {
  const sent: any[] = [];
  const ok = createSmtpTransport({ url: "smtp://x", transporter: { sendMail: async (options: any) => { sent.push(options); return { messageId: "<m1@x>" }; } } as any });
  assert.deepEqual(await ok.send(message, "Parkia <a@b.cl>"), { providerId: "<m1@x>" });
  assert.deepEqual([sent[0].from, sent[0].to, sent[0].subject], ["Parkia <a@b.cl>", "ana@example.cl", "Hola"]);

  const failing = (error: object) => createSmtpTransport({ url: "smtp://x", transporter: { sendMail: async () => { throw Object.assign(new Error("boom"), error); } } as any });
  await assert.rejects(() => failing({ responseCode: 550 }).send(message, "f"), (error: MailDeliveryError) => error.retryable === false);
  await assert.rejects(() => failing({ responseCode: 421 }).send(message, "f"), (error: MailDeliveryError) => error.retryable === true);
  await assert.rejects(() => failing({ code: "ETIMEDOUT" }).send(message, "f"), (error: MailDeliveryError) => error.retryable === true);
});

test("transportes de memoria y consola", async () => {
  resetMemoryOutbox();
  const memory = createMemoryTransport();
  await memory.send(message, "Parkia <a@b.cl>");
  assert.equal(memoryOutbox.length, 1);
  assert.equal(memoryOutbox[0].from, "Parkia <a@b.cl>");

  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try { await createConsoleTransport().send(message, "f"); } finally { console.log = original; }
  assert.match(lines.join("\n"), /ana@example\.cl/);
});

test("URL publica: usa APP_URL si es valida; ignora el valor de ejemplo", () => {
  const previous = process.env.APP_URL;
  try {
    const request = { protocol: "http", get: () => "localhost:8080" } as any;
    process.env.APP_URL = "https://app.parkia.cl/";
    assert.equal(publicBaseUrl(request), "https://app.parkia.cl");
    process.env.APP_URL = "MY_APP_URL";
    assert.equal(publicBaseUrl(request), "http://localhost:8080");
    process.env.APP_URL = "javascript:alert(1)";
    assert.equal(publicBaseUrl(request), "http://localhost:8080");
    delete process.env.APP_URL;
    assert.equal(publicBaseUrl(), "http://localhost:8080");
  } finally {
    if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous;
  }
});
