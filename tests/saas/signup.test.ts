import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createSaasTestServer } from "../support/saasTestHarness";

let harness: Awaited<ReturnType<typeof createSaasTestServer>>;
let memoryOutbox: typeof import("../../server/platform/mail").memoryOutbox;
let resetMemoryOutbox: typeof import("../../server/platform/mail").resetMemoryOutbox;
let resetPublicAttemptsForTesting: typeof import("../../server/middleware/publicAttempts").resetPublicAttemptsForTesting;

before(async () => {
  harness = await createSaasTestServer();
  ({ memoryOutbox, resetMemoryOutbox } = await import("../../server/platform/mail"));
  ({ resetPublicAttemptsForTesting } = await import("../../server/middleware/publicAttempts"));
});

after(async () => {
  await harness.close();
});

test("6.1 alta autoservicio: valida campos, no revela correos existentes, bloquea sin verificacion y desbloquea al confirmar", async () => {
  resetMemoryOutbox();
  resetPublicAttemptsForTesting();

  // 1. Rechaza RUT invalido y aceptacion de terminos faltante
  const invalidRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Norte SpA",
      company_rut: "11.111.111-9",
      owner_name: "Camila Rojas",
      email: "camila@norte.cl",
      password: "Password123!",
      accept_terms: true,
    }),
  });
  assert.equal(invalidRes.status, 400);

  // 2. Registro exitoso crea tenant + sucursal + owner sin verificar + trial 15 dias
  const signupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Estacionamiento Norte SpA",
      company_rut: "76.123.456-0",
      owner_name: "Camila Rojas",
      email: "camila@norte.cl",
      password: "Password123!",
      branch_name: "Sucursal Providencia",
      accept_terms: true,
    }),
  });
  assert.equal(signupRes.status, 201);
  const signupBody = await signupRes.json() as any;
  assert.equal(signupBody.success, true);
  assert.ok(signupBody.verification_token);

  // Correo enviado con la plantilla de verificacion
  assert.equal(memoryOutbox.length, 1);
  assert.equal(memoryOutbox[0].to, "camila@norte.cl");
  assert.match(memoryOutbox[0].subject, /Confirma tu correo/);

  // 3. Reintentar con el mismo correo no revela existencia (200 con mismo mensaje, sin crear tenant nuevo)
  const dupRes = await fetch(`${harness.baseUrl}/api/public/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      company_name: "Otra Empresa",
      company_rut: "76.123.456-0",
      owner_name: "Otro Nombre",
      email: "camila@norte.cl",
      password: "Password123!",
      accept_terms: true,
    }),
  });
  assert.equal(dupRes.status, 200);
  const dupBody = await dupRes.json() as any;
  assert.equal(dupBody.message, signupBody.message);
  assert.equal(dupBody.verification_token, undefined);

  // 4. Inicia sesion pero sin verificar correo no puede operar escrituras (403 EMAIL_NOT_VERIFIED)
  const cookie = await harness.loginAs("camila@norte.cl", "Password123!");
  const contextBefore = await fetch(`${harness.baseUrl}/api/tenant/context`, {
    headers: { Cookie: cookie },
  });
  assert.equal(contextBefore.status, 200);
  const ctxBeforeBody = await contextBefore.json() as any;
  assert.equal(ctxBeforeBody.email_verified, false);
  assert.equal(ctxBeforeBody.canOperate, false);
  assert.equal(ctxBeforeBody.subscription.status, "trialing");

  const blockedWrite = await fetch(`${harness.baseUrl}/api/branches`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "Segunda", code: "S2", status: "active" }),
  });
  assert.equal(blockedWrite.status, 403);
  const blockedBody = await blockedWrite.json() as any;
  assert.equal(blockedBody.code, "EMAIL_NOT_VERIFIED");

  // 5. Confirma correo con token valido y ahora puede operar
  const verifyRes = await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: signupBody.verification_token }),
  });
  assert.equal(verifyRes.status, 200);
  const verifyBody = await verifyRes.json() as any;
  assert.equal(verifyBody.verified, true);

  // Token ya usado falla
  const reuseRes = await fetch(`${harness.baseUrl}/api/public/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: signupBody.verification_token }),
  });
  assert.equal(reuseRes.status, 400);

  // Ahora la escritura funciona (ej. crear un espacio en la sucursal inicial)
  const branchesRes = await fetch(`${harness.baseUrl}/api/branches`, {
    headers: { Cookie: cookie },
  });
  const branches = (await branchesRes.json()) as Array<{ id: number }>;
  assert.equal(branches.length, 1);

  const allowedWrite = await fetch(`${harness.baseUrl}/api/spaces`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: "A-01", type: "parking", price: 0, branch_id: branches[0].id }),
  });
  assert.equal(allowedWrite.status, 200);
});
