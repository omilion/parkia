import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import ExcelJS from "exceljs";

const tempDir = mkdtempSync(join(tmpdir(), "parkia-test-"));
process.env.PARKIA_DB_PATH = join(tempDir, "test.db");
process.env.PARKIA_STORAGE_PATH = join(tempDir, "storage");
process.env.PARKIA_BACKUP_PATH = join(tempDir, "backups");
process.env.NODE_ENV = "test";

const { db } = await import("../server/db");
const { attachErrorHandler, createApiApp } = await import("../server/app");
const { hashPassword } = await import("../server/auth/password");

const app = createApiApp({ logger: false });
attachErrorHandler(app);

let server: Server;
let baseUrl: string;

async function readXlsxWorkbook(response: Response) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
  return workbook;
}

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

async function login(email = "admin@parkia.local", password = "admin123", autoResolvePasswordChange = true) {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie");
  assert(cookie?.includes("parkia_session="));
  const body = await res.json();
  const sessionCookie = cookie.split(";")[0];

  if (body.user?.must_change_password && autoResolvePasswordChange) {
    const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ current_password: password, new_password: `${password}Nueva1` }),
    });
    assert.equal(changeRes.status, 200);
    const changedCookie = changeRes.headers.get("set-cookie");
    assert(changedCookie?.includes("parkia_session="));
    return changedCookie.split(";")[0];
  }

  return sessionCookie;
}

function toSqliteUtc(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function addMs(value: string | Date, ms: number) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Date(date.getTime() + ms);
}

function getChileHour(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
}

async function createStaff(cookie: string, role: "finance" | "guard" | "cashier", email: string, rut?: string) {
  const res = await fetch(`${baseUrl}/api/staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: `${role} Test`,
      rut: rut || ({ finance: "35.555.555-5", guard: "45.555.555-5", cashier: "46.555.555-5" }[role]),
      email,
      phone: "",
      role,
      password: "Cambiar123!",
    }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  return body.id as number;
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

test("rejects protected API requests without a session", async () => {
  const res = await fetch(`${baseUrl}/api/clients`);
  assert.equal(res.status, 401);
});

test("sets baseline security headers", async () => {
  const res = await fetch(`${baseUrl}/api/auth/me`);

  assert.equal(res.headers.get("x-powered-by"), null);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "same-origin");
  assert.match(res.headers.get("strict-transport-security") || "", /max-age=/);
  assert.match(res.headers.get("content-security-policy") || "", /default-src 'self'/);
});

test("serves unauthenticated health checks", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.database, undefined);

  const deniedDetailsRes = await fetch(`${baseUrl}/api/health/details`);
  assert.equal(deniedDetailsRes.status, 401);

  const adminCookie = await login();
  const detailsRes = await fetch(`${baseUrl}/api/health/details`, {
    headers: { Cookie: adminCookie },
  });
  const details = await detailsRes.json();

  assert.equal(detailsRes.status, 200);
  assert.equal(details.database.ok, true);
  assert.equal(typeof details.database.migrations, "number");
  assert.equal(details.storage.ok, true);
  assert.equal(details.backups.ok, true);
  assert.equal(typeof details.readiness.productionReady, "boolean");
  assert(Array.isArray(details.readiness.checks));
  assert(details.readiness.checks.some((check: any) => check.id === "database-path"));
  assert(details.readiness.checks.some((check: any) => check.id === "backup-freshness"));
  assert(details.readiness.checks.some((check: any) => check.id === "security-headers" && check.status === "ok"));
  assert(details.readiness.checks.some((check: any) => check.id === "session-cookie-secure"));
  assert(details.readiness.checks.some((check: any) => check.id === "company-profile"));
  assert(details.readiness.checks.some((check: any) => check.id === "initial-inventory"));
  assert(details.readiness.checks.some((check: any) => check.id === "admin-password" && check.status === "critical"));
});

test("marks production readiness true when required production inputs are complete", async () => {
  const adminCookie = await login();
  const previousEnv = {
    nodeEnv: process.env.NODE_ENV,
    appUrl: process.env.APP_URL,
    seedDemo: process.env.PARKIA_SEED_DEMO,
  };
  const originalAdmin = db.prepare("SELECT password_hash FROM staff WHERE email = ?").get("admin@parkia.local") as { password_hash: string };
  const originalConfig = db.prepare("SELECT company_name, company_rut, company_address, sii_mode, sii_provider FROM system_config WHERE id = 1").get() as any;
  const distIndex = join(process.cwd(), "dist", "index.html");
  const hadDistIndex = existsSync(distIndex);

  if (!hadDistIndex) {
    mkdirSync(join(process.cwd(), "dist"), { recursive: true });
    writeFileSync(distIndex, "<!doctype html><html><body></body></html>");
  }

  try {
    process.env.NODE_ENV = "production";
    process.env.APP_URL = "https://app.parkia.cl";
    process.env.PARKIA_SEED_DEMO = "false";
    mkdirSync(process.env.PARKIA_BACKUP_PATH!, { recursive: true });
    writeFileSync(join(process.env.PARKIA_BACKUP_PATH!, "parkia-production-ready.sqlite"), "backup");

    db.prepare("UPDATE staff SET password_hash = ? WHERE email = ?").run(hashPassword("ClaveProduccion123!"), "admin@parkia.local");
    db.prepare(`
      UPDATE system_config
      SET company_name = ?, company_rut = ?, company_address = ?, sii_mode = 'disabled', sii_provider = 'external_provider'
      WHERE id = 1
    `).run("Parkia SpA", "76.123.456-7", "Av. Principal 123, Santiago");

    const res = await fetch(`${baseUrl}/api/health/details`, {
      headers: { Cookie: adminCookie },
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.readiness.productionReady, true);
    assert(body.readiness.checks.every((check: any) => check.status === "ok"));
  } finally {
    restoreEnv("NODE_ENV", previousEnv.nodeEnv);
    restoreEnv("APP_URL", previousEnv.appUrl);
    restoreEnv("PARKIA_SEED_DEMO", previousEnv.seedDemo);
    db.prepare("UPDATE staff SET password_hash = ? WHERE email = ?").run(originalAdmin.password_hash, "admin@parkia.local");
    db.prepare(`
      UPDATE system_config
      SET company_name = ?, company_rut = ?, company_address = ?, sii_mode = ?, sii_provider = ?
      WHERE id = 1
    `).run(originalConfig.company_name, originalConfig.company_rut, originalConfig.company_address, originalConfig.sii_mode, originalConfig.sii_provider);

    if (!hadDistIndex) {
      rmSync(distIndex, { force: true });
    }
  }
});

test("marks SII mock as critical in production readiness", async () => {
  const adminCookie = await login();
  const previousNodeEnv = process.env.NODE_ENV;
  const originalConfig = db.prepare("SELECT sii_mode, sii_provider FROM system_config WHERE id = 1").get() as any;

  try {
    process.env.NODE_ENV = "production";
    db.prepare("UPDATE system_config SET sii_mode = 'mock', sii_provider = 'local_mock' WHERE id = 1").run();

    const res = await fetch(`${baseUrl}/api/health/details`, {
      headers: { Cookie: adminCookie },
    });
    const body = await res.json();
    const siiCheck = body.readiness.checks.find((check: any) => check.id === "sii-mode");

    assert.equal(res.status, 200);
    assert.equal(siiCheck.status, "critical");
    assert.equal(body.readiness.productionReady, false);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    db.prepare("UPDATE system_config SET sii_mode = ?, sii_provider = ? WHERE id = 1").run(originalConfig.sii_mode, originalConfig.sii_provider);
  }
});

test("rejects cross-origin mutating requests", async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://evil.example",
    },
    body: JSON.stringify({ email: "admin@parkia.local", password: "admin123" }),
  });

  assert.equal(res.status, 403);
});

test("allows same-origin mutating requests", async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: baseUrl,
    },
    body: JSON.stringify({ email: "admin@parkia.local", password: "admin123" }),
  });

  assert.equal(res.status, 200);
});

test("records applied database migrations", () => {
  const rows = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as { id: string }[];
  assert.deepEqual(rows.map((row) => row.id), [
    "001_initial_schema",
    "002_legacy_column_backfill",
    "003_audit_events",
    "004_operational_finance_fields",
    "005_payment_receipt_storage",
    "006_documents",
    "007_document_tracking_fields",
    "008_bank_movement_review_notes",
    "009_payment_allocations",
    "010_reversible_payment_allocations",
    "011_collection_actions",
    "012_expenses",
    "013_financial_budgets",
    "014_overdue_recovery_rate",
    "015_operational_tasks",
    "016_monthly_finance_closures",
    "017_guard_shift_log",
    "018_guard_shift_follow_up_tasks",
    "019_client_master_data",
    "020_staff_security_controls",
    "021_document_task_follow_up",
    "022_physical_operations",
    "023_finance_control_real",
    "024_access_denial_resolution",
    "025_sii_provider_layer",
    "026_default_access_rates",
    "027_vehicle_soft_delete",
    "028_visitor_ticket_payment_timestamp",
    "029_visitor_ticket_quotes",
    "030_operational_cash_sessions",
    "031_minute_billing_and_manual_tickets",
    "032_cashier_role",
    "033_branch_foundation",
  ]);
});

test("manages branches and assigns spaces to a branch", async () => {
  const cookie = await login();

  const listRes = await fetch(`${baseUrl}/api/branches`, {
    headers: { Cookie: cookie },
  });
  const branches = await listRes.json();
  assert.equal(listRes.status, 200);
  assert(branches.some((branch: any) => branch.code === "MAIN" && branch.status === "active"));

  const createBranchRes = await fetch(`${baseUrl}/api/branches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: "Sucursal Norte",
      code: "norte",
      address: "Av. Norte 123",
      commune: "Recoleta",
      city: "Santiago",
      phone: "+56911112222",
    }),
  });
  const createdBranch = await createBranchRes.json();
  assert.equal(createBranchRes.status, 200);
  assert.equal(typeof createdBranch.id, "number");

  const createSpaceRes = await fetch(`${baseUrl}/api/spaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: "Norte A-01",
      type: "parking",
      status: "available",
      price: 62000,
      branch_id: createdBranch.id,
    }),
  });
  const createdSpace = await createSpaceRes.json();
  assert.equal(createSpaceRes.status, 200);

  const branchSpacesRes = await fetch(`${baseUrl}/api/spaces?branch_id=${createdBranch.id}`, {
    headers: { Cookie: cookie },
  });
  const branchSpaces = await branchSpacesRes.json();
  assert.equal(branchSpacesRes.status, 200);
  assert(branchSpaces.some((space: any) => space.id === createdSpace.id && space.branch_name === "Sucursal Norte"));
  assert(branchSpaces.every((space: any) => space.branch_id === createdBranch.id));

  const storedSpace = db.prepare("SELECT branch_id FROM spaces WHERE id = ?").get(createdSpace.id) as { branch_id: number };
  assert.equal(storedSpace.branch_id, createdBranch.id);
});

test("filters contracts and dashboard metrics by branch", async () => {
  const cookie = await login();
  const branchA = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Filtro A", "FILTER-A").lastInsertRowid as number;
  const branchB = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Filtro B", "FILTER-B").lastInsertRowid as number;
  const spaceA1 = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 60000, ?)").run("Filtro A Ocupado", branchA).lastInsertRowid as number;
  db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'available', 60000, ?)").run("Filtro A Disponible", branchA);
  const spaceB1 = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 60000, ?)").run("Filtro B Ocupado", branchB).lastInsertRowid as number;
  const contractA = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id)
    VALUES (1, ?, date('now'), 60000, 5, ?)
  `).run(spaceA1, branchA).lastInsertRowid as number;
  db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id)
    VALUES (2, ?, date('now'), 60000, 5, ?)
  `).run(spaceB1, branchB);
  db.prepare(`
    INSERT INTO access_logs (space_id, branch_id, access_type, status, method, reason, plate)
    VALUES (?, ?, 'entry', 'authorized', 'manual', 'Filtro sucursal A', 'BRANCH-A-1')
  `).run(spaceA1, branchA);
  db.prepare(`
    INSERT INTO access_logs (space_id, branch_id, access_type, status, method, reason, plate)
    VALUES (?, ?, 'entry', 'authorized', 'manual', 'Filtro sucursal B', 'BRANCH-B-1')
  `).run(spaceB1, branchB);

  const contractsRes = await fetch(`${baseUrl}/api/contracts?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const contractsBody = await contractsRes.json();
  const branchContracts = Array.isArray(contractsBody) ? contractsBody : contractsBody.items;
  assert.equal(contractsRes.status, 200);
  assert(branchContracts.some((contract: any) => contract.id === contractA && contract.branch_name === "Sucursal Filtro A"));
  assert(branchContracts.every((contract: any) => contract.branch_id === branchA));

  const dashboardRes = await fetch(`${baseUrl}/api/dashboard?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const dashboard = await dashboardRes.json();
  assert.equal(dashboardRes.status, 200);
  assert.equal(dashboard.branch.id, branchA);
  assert.equal(dashboard.occupancy.total, 2);
  assert.equal(dashboard.occupancy.occupied, 1);
  assert.equal(dashboard.occupancy.parking_free, 1);
  assert(dashboard.occupancy.available_parking.every((space: any) => space.branch_id === branchA));
  assert(dashboard.access.today_access.some((log: any) => log.plate === "BRANCH-A-1"));
  assert(!dashboard.access.today_access.some((log: any) => log.plate === "BRANCH-B-1"));
});

test("filters finance summary, lists, and reports by branch", async () => {
  const cookie = await login();
  const branchA = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Finanzas A", "FIN-A").lastInsertRowid as number;
  const branchB = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Finanzas B", "FIN-B").lastInsertRowid as number;
  const spaceA = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 70000, ?)").run("Finanzas A", branchA).lastInsertRowid as number;
  const spaceB = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 70000, ?)").run("Finanzas B", branchB).lastInsertRowid as number;
  const contractA = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, status, branch_id)
    VALUES (1, ?, '2026-01-01', 70000, 5, 'terminated', ?)
  `).run(spaceA, branchA).lastInsertRowid as number;
  const contractB = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, status, branch_id)
    VALUES (2, ?, '2026-01-01', 80000, 5, 'terminated', ?)
  `).run(spaceB, branchB).lastInsertRowid as number;
  const paidA = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method, branch_id)
    VALUES (?, 30000, '2026-04-05', 'paid', '2026-04-06', 'transfer', ?)
  `).run(contractA, branchA).lastInsertRowid as number;
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, branch_id)
    VALUES (?, 70000, '2026-06-05', 'pending', ?)
  `).run(contractA, branchA);
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, branch_id)
    VALUES (?, 9000, '2026-01-05', 'overdue', ?)
  `).run(contractA, branchA);
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method, branch_id)
    VALUES (?, 150000, '2026-04-05', 'paid', '2026-04-06', 'transfer', ?)
  `).run(contractB, branchB);
  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status, due_date, branch_id)
    VALUES ('2026-05-01', 'maintenance', 'Proveedor Finanzas A', 'Gasto A pendiente', 5000, 'pending', '2026-12-01', ?)
  `).run(branchA);
  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status, due_date, branch_id)
    VALUES ('2026-05-02', 'utilities', 'Proveedor Finanzas A', 'Gasto A vencido', 2000, 'overdue', '2026-01-01', ?)
  `).run(branchA);
  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status, due_date, branch_id)
    VALUES ('2026-05-03', 'maintenance', 'Proveedor Finanzas B', 'Gasto B pendiente', 40000, 'pending', '2026-12-01', ?)
  `).run(branchB);
  db.prepare(`
    INSERT INTO collection_actions (payment_id, staff_id, channel, note, status, next_action_at)
    VALUES (?, 1, 'phone', 'Cobranza sucursal A', 'open', date('now'))
  `).run(paidA);

  const summaryRes = await fetch(`${baseUrl}/api/finance/summary?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert.equal(summary.totalPending, 70000);
  assert.equal(summary.totalCollected, 30000);
  assert.equal(summary.totalOverdue, 9000);
  assert.equal(summary.pendingExpenses, 5000);
  assert.equal(summary.overdueExpenses, 2000);

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const payments = await paymentsRes.json();
  assert.equal(paymentsRes.status, 200);
  assert(payments.length >= 3);
  assert(payments.every((payment: any) => payment.branch_id === branchA));

  const expensesRes = await fetch(`${baseUrl}/api/finance/expenses?status=all&category=all&due=all&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const expenses = await expensesRes.json();
  assert.equal(expensesRes.status, 200);
  assert(expenses.some((expense: any) => expense.supplier_name === "Proveedor Finanzas A" && expense.branch_name === "Sucursal Finanzas A"));
  assert(expenses.every((expense: any) => expense.branch_id === branchA));

  const collectionRes = await fetch(`${baseUrl}/api/finance/collection-actions?status=open&due=all&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const collectionActions = await collectionRes.json();
  assert.equal(collectionRes.status, 200);
  assert(collectionActions.some((action: any) => action.note === "Cobranza sucursal A" && action.branch_id === branchA));

  const collectionsReportRes = await fetch(`${baseUrl}/api/finance/reports/collections?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const collectionsReport = await collectionsReportRes.json();
  assert.equal(collectionsReportRes.status, 200);
  assert.equal(collectionsReport.totalCollected, 30000);
  assert.equal(collectionsReport.paidPaymentsCount, 1);
});

test("filters access monitor, audit, and guard shift logs by branch", async () => {
  const cookie = await login();
  const branchA = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Accesos A", "ACC-A").lastInsertRowid as number;
  const branchB = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Accesos B", "ACC-B").lastInsertRowid as number;
  const spaceA = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'available', 55000, ?)").run("Accesos A", branchA).lastInsertRowid as number;
  const spaceB = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'available', 55000, ?)").run("Accesos B", branchB).lastInsertRowid as number;

  db.prepare(`
    INSERT INTO access_logs (space_id, branch_id, access_type, status, method, reason, plate, timestamp)
    VALUES (?, ?, 'entry', 'authorized', 'manual', 'Filtro acceso A', 'ACCESS-A-1', datetime('now', '+1 minute'))
  `).run(spaceA, branchA);
  db.prepare(`
    INSERT INTO access_logs (space_id, branch_id, access_type, status, method, reason, plate, timestamp)
    VALUES (?, ?, 'entry', 'authorized', 'manual', 'Filtro acceso B', 'ACCESS-B-1', datetime('now', '+2 minutes'))
  `).run(spaceB, branchB);

  const liveRes = await fetch(`${baseUrl}/api/access/live?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const liveLogs = await liveRes.json();
  assert.equal(liveRes.status, 200);
  assert(liveLogs.some((log: any) => log.plate === "ACCESS-A-1" && log.branch_name === "Sucursal Accesos A"));
  assert(liveLogs.every((log: any) => log.branch_id === branchA));
  assert(!liveLogs.some((log: any) => log.plate === "ACCESS-B-1"));

  const auditRes = await fetch(`${baseUrl}/api/access/audit?branch_id=${branchA}&user=ACCESS&page=1&pageSize=20`, {
    headers: { Cookie: cookie },
  });
  const audit = await auditRes.json();
  assert.equal(auditRes.status, 200);
  assert.equal(audit.total, 1);
  assert.equal(audit.items[0].plate, "ACCESS-A-1");
  assert.equal(audit.items[0].branch_id, branchA);

  const staffId = (db.prepare("SELECT id FROM staff WHERE email = ?").get("guardia@parkia.local") as { id: number }).id;
  const shiftA = db.prepare(`
    INSERT INTO guard_shift_logs (staff_id, shift_date, shift_name, status, opening_notes, branch_id, opened_at, closed_at)
    VALUES (?, '2026-05-16', 'morning', 'closed', 'Turno sucursal A', ?, datetime('now', '+3 minutes'), datetime('now', '+4 minutes'))
  `).run(staffId, branchA).lastInsertRowid as number;
  const shiftB = db.prepare(`
    INSERT INTO guard_shift_logs (staff_id, shift_date, shift_name, status, opening_notes, branch_id, opened_at, closed_at)
    VALUES (?, '2026-05-16', 'morning', 'closed', 'Turno sucursal B', ?, datetime('now', '+5 minutes'), datetime('now', '+6 minutes'))
  `).run(staffId, branchB).lastInsertRowid as number;
  const entryA = db.prepare(`
    INSERT INTO guard_shift_log_entries (shift_log_id, staff_id, category, priority, title, follow_up_required)
    VALUES (?, ?, 'access', 'medium', 'Seguimiento sucursal A', 1)
  `).run(shiftA, staffId).lastInsertRowid as number;
  db.prepare(`
    INSERT INTO guard_shift_log_entries (shift_log_id, staff_id, category, priority, title, follow_up_required)
    VALUES (?, ?, 'access', 'medium', 'Seguimiento sucursal B', 1)
  `).run(shiftB, staffId);

  const shiftsRes = await fetch(`${baseUrl}/api/access/shift-logs?status=all&date=2026-05-16&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const shifts = await shiftsRes.json();
  assert.equal(shiftsRes.status, 200);
  assert(shifts.some((shift: any) => shift.id === shiftA && shift.branch_name === "Sucursal Accesos A"));
  assert(shifts.every((shift: any) => shift.branch_id === branchA));
  assert(!shifts.some((shift: any) => shift.id === shiftB));

  const followUpsRes = await fetch(`${baseUrl}/api/access/shift-log-follow-ups?status=open&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const followUps = await followUpsRes.json();
  assert.equal(followUpsRes.status, 200);
  assert(followUps.some((followUp: any) => followUp.id === entryA && followUp.branch_id === branchA));
  assert(!followUps.some((followUp: any) => followUp.title === "Seguimiento sucursal B"));

  db.prepare("UPDATE guard_shift_log_entries SET resolved_at = datetime('now') WHERE shift_log_id IN (?, ?)").run(shiftA, shiftB);
});

test("filters operational tasks by branch", async () => {
  const cookie = await login();
  const branchA = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Tareas A", "TASK-A").lastInsertRowid as number;
  const branchB = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Tareas B", "TASK-B").lastInsertRowid as number;

  const taskARes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Tarea sucursal A",
      category: "general",
      priority: "medium",
      branch_id: branchA,
    }),
  });
  const taskA = await taskARes.json();
  assert.equal(taskARes.status, 200);
  assert.equal(taskA.task.branch_id, branchA);
  assert.equal(taskA.task.branch_name, "Sucursal Tareas A");

  const taskBRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Tarea sucursal B",
      category: "general",
      priority: "medium",
      branch_id: branchB,
    }),
  });
  const taskB = await taskBRes.json();
  assert.equal(taskBRes.status, 200);

  const listARes = await fetch(`${baseUrl}/api/tasks?status=active&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const listA = await listARes.json();
  assert.equal(listARes.status, 200);
  assert(listA.some((task: any) => task.id === taskA.task.id && task.branch_name === "Sucursal Tareas A"));
  assert(listA.every((task: any) => task.branch_id === branchA));
  assert(!listA.some((task: any) => task.id === taskB.task.id));

  const summaryARes = await fetch(`${baseUrl}/api/tasks/summary?branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const summaryA = await summaryARes.json();
  assert.equal(summaryARes.status, 200);
  assert(summaryA.open >= 1);

  const moveRes = await fetch(`${baseUrl}/api/tasks/${taskA.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ branch_id: branchB }),
  });
  const moved = await moveRes.json();
  assert.equal(moveRes.status, 200);
  assert.equal(moved.task.branch_id, branchB);
  assert.equal(moved.task.branch_name, "Sucursal Tareas B");

  const listAAfterRes = await fetch(`${baseUrl}/api/tasks?status=active&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const listAAfter = await listAAfterRes.json();
  assert.equal(listAAfterRes.status, 200);
  assert(!listAAfter.some((task: any) => task.id === taskA.task.id));

  db.prepare("UPDATE operational_tasks SET status = 'done', completed_at = datetime('now') WHERE id IN (?, ?)").run(taskA.task.id, taskB.task.id);
});

test("filters document review and document follow-up tasks by branch", async () => {
  const cookie = await login();
  const branchA = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Docs A", "DOC-A").lastInsertRowid as number;
  const branchB = db.prepare("INSERT INTO branches (name, code, status) VALUES (?, ?, 'active')").run("Sucursal Docs B", "DOC-B").lastInsertRowid as number;
  const spaceA = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 65000, ?)").run("Docs A", branchA).lastInsertRowid as number;
  const spaceB = db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, 'parking', 'occupied', 65000, ?)").run("Docs B", branchB).lastInsertRowid as number;
  const contractA = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id)
    VALUES (1, ?, '2026-01-01', 65000, 5, ?)
  `).run(spaceA, branchA).lastInsertRowid as number;
  const contractB = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id)
    VALUES (2, ?, '2026-01-01', 65000, 5, ?)
  `).run(spaceB, branchB).lastInsertRowid as number;

  const uploadARes = await fetch(`${baseUrl}/api/documents/contract/${contractA}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Documento sucursal A",
      document_type: "contract",
      status: "pending",
      notes: "Revision documental sucursal A",
      fileName: "documento-a.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("documento sucursal A").toString("base64"),
    }),
  });
  const uploadA = await uploadARes.json();
  assert.equal(uploadARes.status, 200);

  const uploadBRes = await fetch(`${baseUrl}/api/documents/contract/${contractB}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Documento sucursal B",
      document_type: "contract",
      status: "pending",
      notes: "Revision documental sucursal B",
      fileName: "documento-b.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("documento sucursal B").toString("base64"),
    }),
  });
  const uploadB = await uploadBRes.json();
  assert.equal(uploadBRes.status, 200);

  const reviewARes = await fetch(`${baseUrl}/api/documents/review?scope=all&branch_id=${branchA}&page=1&pageSize=20`, {
    headers: { Cookie: cookie },
  });
  const reviewA = await reviewARes.json();
  assert.equal(reviewARes.status, 200);
  assert(reviewA.documents.some((document: any) => document.id === uploadA.id && document.branch_name === "Sucursal Docs A"));
  assert(reviewA.documents.every((document: any) => document.branch_id === branchA));
  assert(!reviewA.documents.some((document: any) => document.id === uploadB.id));

  const documentTasksARes = await fetch(`${baseUrl}/api/tasks?source=document&branch_id=${branchA}`, {
    headers: { Cookie: cookie },
  });
  const documentTasksA = await documentTasksARes.json();
  assert.equal(documentTasksARes.status, 200);
  assert(documentTasksA.some((task: any) => task.source_id === String(uploadA.id) && task.branch_id === branchA));
  assert(!documentTasksA.some((task: any) => task.source_id === String(uploadB.id)));

  db.prepare("UPDATE documents SET status = 'approved' WHERE id IN (?, ?)").run(uploadA.id, uploadB.id);
  db.prepare("UPDATE operational_tasks SET status = 'done', completed_at = datetime('now') WHERE source_type = 'document' AND source_id IN (?, ?)").run(String(uploadA.id), String(uploadB.id));
});

test("logs in and resolves the current user from the session cookie", async () => {
  const cookie = await login();

  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.email, "admin@parkia.local");
  assert.equal(body.user.role, "admin");
  assert.equal(body.user.password_hash, undefined);
});

test("seeds a real finance user for role QA", async () => {
  const cookie = await login("finance@parkia.local", "Cambiar123!");

  const res = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.user.email, "finance@parkia.local");
  assert.equal(body.user.role, "finance");
  assert.equal(body.user.status, "active");
});

test("rejects invalid client payloads with validation errors", async () => {
  const cookie = await login();

  const res = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ name: "", email: "not-email", rut: "", type: "invalid" }),
  });
  const body = await res.json();

  assert.equal(res.status, 400);
  assert.equal(typeof body.error, "string");
});

test("imports clients from CSV and reports skipped rows", async () => {
  const cookie = await login();

  const csvText = [
    "name,rut,email,phone,type,plate",
    "Cliente CSV Uno,11.111.111-1,uno@example.com,+56911111111,natural,CSVV-11",
    "Cliente CSV Dos,22.222.222-2,dos@example.com,+56922222222,company,CSVV-22",
    "Cliente Malo,12.345.678-0,malo@example.com,+56933333333,natural,CSVV-33",
    "Cliente Repetido,11.111.111-1,repetido@example.com,+56944444444,natural,CSVV-44",
  ].join("\n");

  const templatesRes = await fetch(`${baseUrl}/api/import/templates`, {
    headers: { Cookie: cookie },
  });
  const templates = await templatesRes.json();
  assert.equal(templatesRes.status, 200);
  assert(templates.templates.some((template: any) => template.id === "clients"));

  const clientTemplateRes = await fetch(`${baseUrl}/api/import/templates/clients.csv`, {
    headers: { Cookie: cookie },
  });
  const clientTemplate = await clientTemplateRes.text();
  assert.equal(clientTemplateRes.status, 200);
  assert(clientTemplate.startsWith("Nombre,RUT,Correo,Teléfono,Tipo,Patente"));

  const spanishCsvText = [
    "Nombre,RUT,Correo,Teléfono,Tipo,Patente,Dirección,Comuna,Ciudad,Giro,Representante legal,RUT representante legal,Contacto facturación,Correo facturación,Teléfono facturación,Notas",
    "Cliente CSV Tres,33.333.333-3,tres@example.com,+56955555555,Persona natural,CSVV-55,Av. Tres 123,Santiago,Santiago,,,,Cliente CSV Tres,tres@example.com,+56955555555,Importado en español",
    "Empresa CSV Cuatro,44.444.444-4,cuatro@example.com,+56966666666,Empresa,CSVV-66,Av. Cuatro 456,Providencia,Santiago,Servicios,Representante Cuatro,12.345.678-5,Finanzas Cuatro,finanzas4@example.com,+56966666666,Empresa en español",
  ].join("\n");
  const spanishDryRunRes = await fetch(`${baseUrl}/api/clients/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ csvText: spanishCsvText, dryRun: true }),
  });
  const spanishDryRun = await spanishDryRunRes.json();
  assert.equal(spanishDryRunRes.status, 200);
  assert.equal(spanishDryRun.valid, 2);
  assert.equal(spanishDryRun.preview[0].type, "natural");
  assert.equal(spanishDryRun.preview[1].type, "company");

  const dryRunRes = await fetch(`${baseUrl}/api/clients/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ csvText, dryRun: true }),
  });
  const dryRun = await dryRunRes.json();
  assert.equal(dryRunRes.status, 200);
  assert.equal(dryRun.valid, 2);
  assert.equal(dryRun.skipped, 2);

  const res = await fetch(`${baseUrl}/api/clients/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ csvText }),
  });
  const body = await res.json();

  assert.equal(res.status, 200);
  assert.equal(body.imported, 2);
  assert.equal(body.skipped, 2);
  assert.equal(body.errors.length, 2);

  const clients = db.prepare("SELECT name, rut FROM clients WHERE rut IN (?, ?) ORDER BY rut").all("11.111.111-1", "22.222.222-2") as any[];
  assert.equal(clients.length, 2);

  const vehicle = db.prepare("SELECT plate FROM vehicles WHERE plate = ?").get("CSVV-11") as any;
  assert.equal(vehicle.plate, "CSVV-11");

  const importEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'clients.imported'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(importEvent);
  assert.equal(JSON.parse(importEvent.metadata).imported, 2);
});

test("manages client master data, vehicles, debt summary, and archive status", async () => {
  const cookie = await login();

  const createRes = await fetch(`${baseUrl}/api/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      name: "Empresa Sprint A SpA",
      rut: "77.777.777-7",
      email: "facturacion@sprinta.cl",
      phone: "+56977777777",
      type: "company",
      address: "Av. Producto 100",
      commune: "Santiago",
      city: "Santiago",
      business_activity: "Arriendo de estacionamientos",
      legal_representative_name: "Representante Sprint",
      legal_representative_rut: "12.345.678-9",
      billing_contact_name: "Finanzas Sprint",
      billing_contact_email: "cobros@sprinta.cl",
      billing_contact_phone: "+56911112222",
      notes: "Cliente creado para validar ficha completa",
      plate: "SPRT-01",
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(typeof created.id, "number");

  const vehicleRes = await fetch(`${baseUrl}/api/clients/${created.id}/vehicles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      plate: "SPRT-02",
      brand: "Hyundai",
      model: "Porter",
      color: "Blanco",
      notes: "Vehiculo secundario",
    }),
  });
  const vehicleBody = await vehicleRes.json();
  assert.equal(vehicleRes.status, 200);

  const detailRes = await fetch(`${baseUrl}/api/clients/${created.id}`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.client.business_activity, "Arriendo de estacionamientos");
  assert.equal(detail.client.billing_contact_email, "cobros@sprinta.cl");
  assert.equal(detail.vehicles.length, 2);
  assert.equal(detail.summary.totalDebt, 0);

  const archiveVehicleRes = await fetch(`${baseUrl}/api/clients/${created.id}/vehicles/${vehicleBody.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ reason: "Cambio de vehiculo informado por cliente" }),
  });
  assert.equal(archiveVehicleRes.status, 200);

  const archivedVehicle = db.prepare("SELECT status, archive_reason FROM vehicles WHERE id = ?").get(vehicleBody.id) as any;
  assert.equal(archivedVehicle.status, "archived");
  assert.equal(archivedVehicle.archive_reason, "Cambio de vehiculo informado por cliente");

  const detailAfterVehicleArchiveRes = await fetch(`${baseUrl}/api/clients/${created.id}`, {
    headers: { Cookie: cookie },
  });
  const detailAfterVehicleArchive = await detailAfterVehicleArchiveRes.json();
  assert.equal(detailAfterVehicleArchiveRes.status, 200);
  assert.equal(detailAfterVehicleArchive.vehicles.length, 1);
  assert(!detailAfterVehicleArchive.vehicles.some((vehicle: any) => vehicle.plate === "SPRT-02"));

  const reactivateVehicleRes = await fetch(`${baseUrl}/api/clients/${created.id}/vehicles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      plate: "SPRT-02",
      brand: "Hyundai",
      model: "Porter",
      color: "Blanco",
      notes: "Vehiculo reactivado",
    }),
  });
  const reactivatedVehicle = await reactivateVehicleRes.json();
  assert.equal(reactivateVehicleRes.status, 200);
  assert.equal(reactivatedVehicle.reactivated, true);

  const updateRes = await fetch(`${baseUrl}/api/clients/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      address: "Av. Producto 200",
      notes: "Actualizado desde prueba",
    }),
  });
  assert.equal(updateRes.status, 200);

  const activeArchiveRes = await fetch(`${baseUrl}/api/clients/1/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "archived", reason: "No debe permitir con contrato activo" }),
  });
  assert.equal(activeArchiveRes.status, 400);

  const archiveRes = await fetch(`${baseUrl}/api/clients/${created.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "archived", reason: "Cliente duplicado de prueba" }),
  });
  assert.equal(archiveRes.status, 200);

  const availableSpace = db.prepare("SELECT id FROM spaces WHERE status = 'available' LIMIT 1").get() as { id: number };
  const contractForArchivedRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: created.id,
      space_id: availableSpace.id,
      start_date: "2026-09-01",
      monthly_fee: 70000,
      billing_day: 5,
    }),
  });
  assert.equal(contractForArchivedRes.status, 400);

  const clientsRes = await fetch(`${baseUrl}/api/clients?includeArchived=true`, {
    headers: { Cookie: cookie },
  });
  const clients = await clientsRes.json();
  assert.equal(clientsRes.status, 200);
  const archived = clients.find((client: any) => client.id === created.id);
  assert.equal(archived.status, "archived");
  assert.equal(archived.vehicles_count, 2);

  const clientEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'client.status_updated' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(String(created.id)) as any;
  assert(clientEvent);
  assert.equal(JSON.parse(clientEvent.metadata).status, "archived");

  const vehicleArchiveEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'client.vehicle_archived' AND entity_id = ?
    ORDER BY id DESC LIMIT 1
  `).get(String(vehicleBody.id)) as any;
  assert(vehicleArchiveEvent);
  assert.equal(JSON.parse(vehicleArchiveEvent.metadata).reason, "Cambio de vehiculo informado por cliente");
});

test("paginates and filters high-volume operational lists", async () => {
  const cookie = await login();
  const insertClient = db.prepare(`
    INSERT INTO clients (name, email, phone, rut, type, status)
    VALUES (?, ?, ?, ?, 'company', ?)
  `);
  const insertSpace = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES (?, 'parking', 'occupied', ?)
  `);
  const insertContract = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, end_date, monthly_fee, billing_day, status)
    VALUES (?, ?, '2026-01-01', '2026-12-31', ?, 5, 'active')
  `);
  const contractIds: number[] = [];

  for (let i = 1; i <= 12; i++) {
    const suffix = String(i).padStart(2, "0");
    const client = insertClient.run(
      `Sprint6 Cliente ${suffix}`,
      `sprint6-${suffix}@example.cl`,
      `+5690000${suffix}`,
      `S6-CLIENT-${suffix}`,
      "archived"
    );
    const space = insertSpace.run(`Sprint6 Contract Space ${suffix}`, 100000 + i);
    const contract = insertContract.run(client.lastInsertRowid, space.lastInsertRowid, 100000 + i);
    contractIds.push(Number(contract.lastInsertRowid));
    db.prepare(`
      INSERT INTO payments (contract_id, amount, due_date, status, reference)
      VALUES (?, ?, ?, 'pending', ?)
    `).run(contract.lastInsertRowid, 100000 + i, `2026-06-${suffix}`, `S6PAY-${suffix}`);
  }

  for (let i = 1; i <= 9; i++) {
    const suffix = String(i).padStart(2, "0");
    db.prepare(`
      INSERT INTO bank_movements (date, description, rut, amount, status, notes)
      VALUES (?, ?, ?, ?, 'pending', ?)
    `).run(`2026-07-${suffix}`, `Sprint6 bank movement ${suffix}`, `S6-BANK-${suffix}`, 50000 + i, "Sprint6 volume");
  }

  for (let i = 1; i <= 7; i++) {
    const suffix = String(i).padStart(2, "0");
    db.prepare(`
      INSERT INTO access_logs (client_id, space_id, access_type, status, method, reason, plate)
      VALUES (
        (SELECT client_id FROM contracts WHERE id = ?),
        (SELECT space_id FROM contracts WHERE id = ?),
        'entry',
        'authorized',
        'manual',
        'Sprint6 audit volume',
        ?
      )
    `).run(contractIds[0], contractIds[0], `S6AUD-${suffix}`);
  }

  const clientsRes = await fetch(`${baseUrl}/api/clients?search=Sprint6%20Cliente&type=company&status=archived&page=2&pageSize=5`, {
    headers: { Cookie: cookie },
  });
  assert.equal(clientsRes.status, 200);
  const clientsPage = await clientsRes.json();
  assert.equal(clientsPage.total, 12);
  assert.equal(clientsPage.page, 2);
  assert.equal(clientsPage.pageSize, 5);
  assert.equal(clientsPage.items.length, 5);
  assert(clientsPage.items.every((client: any) => client.status === "archived"));

  const contractsRes = await fetch(`${baseUrl}/api/contracts?search=Sprint6%20Contract%20Space&status=active&page=2&pageSize=5`, {
    headers: { Cookie: cookie },
  });
  assert.equal(contractsRes.status, 200);
  const contractsPage = await contractsRes.json();
  assert.equal(contractsPage.total, 12);
  assert.equal(contractsPage.items.length, 5);
  assert(contractsPage.items.every((contract: any) => contract.space_name.includes("Sprint6 Contract Space")));

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments?search=S6PAY&status=pending&page=3&pageSize=4`, {
    headers: { Cookie: cookie },
  });
  assert.equal(paymentsRes.status, 200);
  const paymentsPage = await paymentsRes.json();
  assert.equal(paymentsPage.total, 12);
  assert.equal(paymentsPage.items.length, 4);
  assert(paymentsPage.items.every((payment: any) => payment.reference.startsWith("S6PAY-")));

  const movementsRes = await fetch(`${baseUrl}/api/finance/bank-movements?search=Sprint6%20bank&status=pending&page=2&pageSize=4`, {
    headers: { Cookie: cookie },
  });
  assert.equal(movementsRes.status, 200);
  const movementsPage = await movementsRes.json();
  assert.equal(movementsPage.total, 9);
  assert.equal(movementsPage.items.length, 4);
  assert(movementsPage.items.every((movement: any) => movement.description.includes("Sprint6 bank movement")));

  const auditRes = await fetch(`${baseUrl}/api/access/audit?user=S6AUD&page=2&pageSize=3`, {
    headers: { Cookie: cookie },
  });
  assert.equal(auditRes.status, 200);
  const auditPage = await auditRes.json();
  assert.equal(auditPage.total, 7);
  assert.equal(auditPage.items.length, 3);
  assert(auditPage.items.every((log: any) => log.plate.startsWith("S6AUD-")));
});

test("enforces role permissions for finance users", async () => {
  const adminCookie = await login();
  await createStaff(adminCookie, "finance", "finance.test@parkia.local");
  const financeCookie = await login("finance.test@parkia.local", "Cambiar123!");

  const financeRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(financeRes.status, 200);

  const contractsRes = await fetch(`${baseUrl}/api/contracts`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(contractsRes.status, 200);

  const spacesRes = await fetch(`${baseUrl}/api/spaces`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(spacesRes.status, 200);

  const visitorsRes = await fetch(`${baseUrl}/api/visitors`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(visitorsRes.status, 403);

  const openBarrierRes = await fetch(`${baseUrl}/api/spaces/1/open-barrier`, {
    method: "POST",
    headers: { Cookie: financeCookie },
  });
  assert.equal(openBarrierRes.status, 403);

  const staffRes = await fetch(`${baseUrl}/api/staff`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(staffRes.status, 403);

  const accessRes = await fetch(`${baseUrl}/api/access/live`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(accessRes.status, 403);

  const auditRes = await fetch(`${baseUrl}/api/audit-events`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(auditRes.status, 403);
});

test("enforces role permissions for guard users", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const accessRes = await fetch(`${baseUrl}/api/access/live`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(accessRes.status, 200);

  const spacesRes = await fetch(`${baseUrl}/api/spaces`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(spacesRes.status, 200);

  const financeRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(financeRes.status, 403);

  const contractsRes = await fetch(`${baseUrl}/api/contracts`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(contractsRes.status, 403);

  const ratesRes = await fetch(`${baseUrl}/api/access/rates`, {
    headers: { Cookie: guardCookie },
  });
  const rates = await ratesRes.json();
  assert.equal(ratesRes.status, 200);
  assert(Array.isArray(rates));

  const ratePatchRes = await fetch(`${baseUrl}/api/access/rates/${rates[0].id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ rate_per_minute: 165, grace_period_mins: 1 }),
  });
  assert.equal(ratePatchRes.status, 403);
});

test("manages physical space details, visitor pass metadata, and manual release reasons", async () => {
  const adminCookie = await login();
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const createSpaceRes = await fetch(`${baseUrl}/api/spaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Estacionamiento QA-1",
      type: "parking",
      status: "available",
      price: 12345,
      location: "Pasillo norte",
      level: "-1",
      width_m: 2.5,
      length_m: 4,
      height_m: 2.2,
      features: "Enchufe, camara, acceso techado",
      notes: "Sin humedad visible",
    }),
  });
  const createdSpace = await createSpaceRes.json();
  assert.equal(createSpaceRes.status, 200);

  const detailRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/detail`, {
    headers: { Cookie: adminCookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.space.location, "Pasillo norte");
  assert.equal(detail.space.level, "-1");
  assert.equal(detail.space.width_m, 2.5);
  assert(detail.history.some((item: any) => item.source === "created"));

  const updateSpaceRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Estacionamiento QA-1 Editada",
      price: 145000,
      location: "Pasillo norte actualizado",
      level: "-1",
      width_m: 2.8,
      length_m: 4.2,
      height_m: 2.3,
      features: "Enchufe, camara, acceso techado, sensor",
      notes: "Ficha fisica actualizada",
      reason: "Actualizacion de medidas despues de inspeccion",
    }),
  });
  assert.equal(updateSpaceRes.status, 200);

  const editedDetailRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/detail`, {
    headers: { Cookie: adminCookie },
  });
  const editedDetail = await editedDetailRes.json();
  assert.equal(editedDetailRes.status, 200);
  assert.equal(editedDetail.space.name, "Estacionamiento QA-1 Editada");
  assert.equal(editedDetail.space.price, 145000);
  assert.equal(editedDetail.space.location, "Pasillo norte actualizado");
  assert.equal(editedDetail.space.width_m, 2.8);
  assert(editedDetail.history.some((item: any) => item.source === "profile_update" && item.reason === "Actualizacion de medidas despues de inspeccion"));

  const passRes = await fetch(`${baseUrl}/api/visitors/passes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      name: "Proveedor QA",
      rut: "55.555.555-5",
      type: "provider",
      reason: "Mantencion preventiva",
      plate: "QA-1234",
      phone: "+56955555555",
      company: "Servicios QA",
      authorized_by: "Administracion",
      associated_space_id: createdSpace.id,
      valid_from: "2026-05-14",
      valid_to: "2026-05-15",
    }),
  });
  const pass = await passRes.json();
  assert.equal(passRes.status, 200);
  assert.equal(typeof pass.qr_token, "string");

  const passesRes = await fetch(`${baseUrl}/api/visitors/passes`, {
    headers: { Cookie: guardCookie },
  });
  const passes = await passesRes.json();
  assert.equal(passesRes.status, 200);
  const createdPass = passes.find((item: any) => item.id === pass.id);
  assert.equal(createdPass.plate, "QA-1234");
  assert.equal(createdPass.phone, "+56955555555");
  assert.equal(createdPass.company, "Servicios QA");
  assert.equal(createdPass.authorized_by, "Administracion");
  assert.equal(createdPass.space_name, "Estacionamiento QA-1 Editada");

  const parkingRes = await fetch(`${baseUrl}/api/spaces`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Estacionamiento QR QA",
      type: "parking",
      status: "available",
      price: 15000,
    }),
  });
  const parking = await parkingRes.json();
  assert.equal(parkingRes.status, 200);

  const validFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16);
  const validTo = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const qrPassRes = await fetch(`${baseUrl}/api/visitors/passes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      name: "Visita QR Activa",
      rut: "66.666.666-6",
      type: "provider",
      reason: "Ingreso con pase QR",
      plate: "QR-2026",
      authorized_by: "Administracion",
      associated_space_id: parking.id,
      valid_from: validFrom,
      valid_to: validTo,
    }),
  });
  const qrPass = await qrPassRes.json();
  assert.equal(qrPassRes.status, 200);

  const qrEntryRes = await fetch(`${baseUrl}/api/visitors/passes/${qrPass.id}/scan`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  const qrEntry = await qrEntryRes.json();
  assert.equal(qrEntryRes.status, 200);
  assert.equal(qrEntry.action, "entry");
  const occupiedParking = db.prepare("SELECT status FROM spaces WHERE id = ?").get(parking.id) as { status: string };
  assert.equal(occupiedParking.status, "occupied");

  const qrExitRes = await fetch(`${baseUrl}/api/visitors/passes/${qrPass.id}/scan`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  const qrExit = await qrExitRes.json();
  assert.equal(qrExitRes.status, 200);
  assert.equal(qrExit.action, "exit");
  const releasedParking = db.prepare("SELECT status FROM spaces WHERE id = ?").get(parking.id) as { status: string };
  const scannedPass = db.prepare("SELECT status FROM visitor_passes WHERE id = ?").get(qrPass.id) as { status: string };
  assert.equal(releasedParking.status, "available");
  assert.equal(scannedPass.status, "completed");

  const missingReasonRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/force-release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({}),
  });
  assert.equal(missingReasonRes.status, 400);

  const maintenanceRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ status: "maintenance", notes: "Mantencion preventiva documentada" }),
  });
  assert.equal(maintenanceRes.status, 200);

  const releaseRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/force-release`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ reason: "Regularizacion operacional con revision fisica completa" }),
  });
  assert.equal(releaseRes.status, 200);

  const afterReleaseRes = await fetch(`${baseUrl}/api/spaces/${createdSpace.id}/detail`, {
    headers: { Cookie: adminCookie },
  });
  const afterRelease = await afterReleaseRes.json();
  assert.equal(afterReleaseRes.status, 200);
  assert.equal(afterRelease.space.status, "available");
  assert(afterRelease.history.some((item: any) => item.source === "force_release" && item.reason === "Regularizacion operacional con revision fisica completa"));
});

test("manages guard shift logs with handover follow-up", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const financeCookie = await login("finance@parkia.local", "Cambiar123!");

  const deniedFinanceRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    headers: { Cookie: financeCookie },
  });
  assert.equal(deniedFinanceRes.status, 403);

  const openRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      shift_date: "2026-05-14",
      shift_name: "night",
      opening_notes: "Recibo turno con visita activa y barrera norte operativa",
    }),
  });
  const opened = await openRes.json();
  assert.equal(openRes.status, 200);
  assert.equal(opened.existing, false);
  assert.equal(opened.shiftLog.status, "open");
  assert.equal(opened.shiftLog.staff_name, "Guardia Parkia");

  const duplicateOpenRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ shift_date: "2026-05-14", shift_name: "night" }),
  });
  const duplicateOpen = await duplicateOpenRes.json();
  assert.equal(duplicateOpenRes.status, 200);
  assert.equal(duplicateOpen.existing, true);
  assert.equal(duplicateOpen.shiftLog.id, opened.shiftLog.id);

  const entryRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      category: "incident",
      priority: "high",
      title: "Visita sin QR validada manualmente",
      detail: "Se informa a administración para confirmar pase pendiente",
      follow_up_required: true,
      attachment: {
        label: "Foto porteria",
        fileName: "visita-sin-qr.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("evidencia de prueba").toString("base64"),
      },
    }),
  });
  const entry = await entryRes.json();
  assert.equal(entryRes.status, 200);
  assert.equal(typeof entry.id, "number");

  const detailRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}`, {
    headers: { Cookie: guardCookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.shiftLog.entries_count, 1);
  assert.equal(detail.shiftLog.pending_follow_ups, 1);
  assert.equal(detail.entries[0].follow_up_required, true);
  assert.equal(detail.entries[0].resolved_at, null);
  assert.equal(typeof detail.entries[0].task_id, "number");
  assert.equal(detail.entries[0].task_status, "open");
  assert.equal(detail.entries[0].attachment_count, 1);
  assert.equal(detail.entries[0].attachment_file_name, "visita-sin-qr.png");

  const attachmentRes = await fetch(`${baseUrl}/api/access/shift-log-entries/${entry.id}/attachments/${detail.entries[0].attachment_id}/download`, {
    headers: { Cookie: guardCookie },
  });
  const attachmentBody = await attachmentRes.text();
  assert.equal(attachmentRes.status, 200);
  assert.match(attachmentRes.headers.get("content-type") || "", /image\/png/);
  assert.equal(attachmentBody, "evidencia de prueba");

  const shiftTaskRes = await fetch(`${baseUrl}/api/tasks?source=guard_shift_log&status=active`, {
    headers: { Cookie: guardCookie },
  });
  const shiftTasks = await shiftTaskRes.json();
  assert.equal(shiftTaskRes.status, 200);
  assert(shiftTasks.some((task: any) => task.id === detail.entries[0].task_id && task.source_id === String(entry.id)));
  const shiftSummaryRes = await fetch(`${baseUrl}/api/tasks/summary`, {
    headers: { Cookie: guardCookie },
  });
  const shiftSummary = await shiftSummaryRes.json();
  assert.equal(shiftSummaryRes.status, 200);
  assert(shiftSummary.fromShiftLogs >= 1);

  const paymentEntryRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      category: "payment",
      priority: "high",
      title: "Cliente informa pago pendiente en porteria",
      detail: "Guardia reporta que cliente solicita validacion de transferencia antes de salida.",
      follow_up_required: true,
    }),
  });
  const paymentEntry = await paymentEntryRes.json();
  assert.equal(paymentEntryRes.status, 200);
  assert.equal(typeof paymentEntry.task_id, "number");

  const financeShiftTaskRes = await fetch(`${baseUrl}/api/tasks?source=guard_shift_log&status=active`, {
    headers: { Cookie: financeCookie },
  });
  const financeShiftTasks = await financeShiftTaskRes.json();
  assert.equal(financeShiftTaskRes.status, 200);
  const financeShiftTask = financeShiftTasks.find((task: any) => task.id === paymentEntry.task_id);
  assert(financeShiftTask);
  assert.equal(financeShiftTask.category, "finance");
  assert.match(financeShiftTask.source_href, /\/tasks\?source=guard_shift_log&taskId=/);

  const resolvePaymentEntryRes = await fetch(`${baseUrl}/api/access/shift-log-entries/${paymentEntry.id}/resolve`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ resolved: true }),
  });
  assert.equal(resolvePaymentEntryRes.status, 403);
  const paymentTaskStillOpen = db.prepare("SELECT status FROM operational_tasks WHERE id = ?").get(paymentEntry.task_id) as any;
  assert.equal(paymentTaskStillOpen.status, "open");

  const completePaymentTaskRes = await fetch(`${baseUrl}/api/tasks/${paymentEntry.task_id}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: financeCookie,
    },
    body: JSON.stringify({ note: "Finanzas valida el pendiente informado por guardia" }),
  });
  assert.equal(completePaymentTaskRes.status, 200);
  const paymentEntryAfterFinance = db.prepare("SELECT resolved_at FROM guard_shift_log_entries WHERE id = ?").get(paymentEntry.id) as any;
  assert(paymentEntryAfterFinance.resolved_at);

  const resolveRes = await fetch(`${baseUrl}/api/access/shift-log-entries/${entry.id}/resolve`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ resolved: true }),
  });
  assert.equal(resolveRes.status, 200);

  const resolvedTask = db.prepare("SELECT status, completed_note FROM operational_tasks WHERE id = ?").get(detail.entries[0].task_id) as any;
  assert.equal(resolvedTask.status, "done");
  assert.equal(resolvedTask.completed_note, "Resuelto desde bitácora de turno");

  const inheritedEntryRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      category: "maintenance",
      priority: "medium",
      title: "Cámara norte queda intermitente",
      detail: "Debe revisarse en el siguiente turno",
      follow_up_required: true,
    }),
  });
  const inheritedEntry = await inheritedEntryRes.json();
  assert.equal(inheritedEntryRes.status, 200);
  assert.equal(typeof inheritedEntry.task_id, "number");

  const closeRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/close`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      handover_notes: "Queda todo sin incidentes abiertos. Revisar cámara norte durante el siguiente turno.",
      cash_count_note: "Sin caja en turno nocturno",
      handover_items: [{
        category: "handover",
        priority: "high",
        title: "Verificar camara norte al recibir turno",
        detail: "Confirmar si la intermitencia continua y avisar a mantencion si falla otra vez.",
      }],
    }),
  });
  const closed = await closeRes.json();
  assert.equal(closeRes.status, 200);
  assert.equal(closed.shiftLog.status, "closed");
  assert.equal(closed.shiftLog.pending_follow_ups, 2);
  assert.equal(typeof closed.shiftLog.cash_session_id, "number");

  const cashSession = db.prepare("SELECT status, expected_cash, counted_cash, difference_cash FROM cash_sessions WHERE id = ?").get(closed.shiftLog.cash_session_id) as any;
  assert.equal(cashSession.status, "closed");
  assert.equal(cashSession.expected_cash, 0);
  assert.equal(cashSession.counted_cash, 0);
  assert.equal(cashSession.difference_cash, 0);

  const cashClosure = db.prepare("SELECT snapshot_json FROM cash_session_closures WHERE cash_session_id = ?").get(closed.shiftLog.cash_session_id) as any;
  assert(cashClosure);
  assert.equal(JSON.parse(cashClosure.snapshot_json).expected_cash, 0);

  const followUpsRes = await fetch(`${baseUrl}/api/access/shift-log-follow-ups?status=open`, {
    headers: { Cookie: guardCookie },
  });
  const followUps = await followUpsRes.json();
  assert.equal(followUpsRes.status, 200);
  assert(followUps.some((followUp: any) => followUp.id === inheritedEntry.id && followUp.shift_status === "closed"));
  const structuredHandover = followUps.find((followUp: any) => followUp.title === "Verificar camara norte al recibir turno");
  assert(structuredHandover);
  assert.equal(structuredHandover.shift_status, "closed");
  assert.equal(typeof structuredHandover.task_id, "number");

  const guardDashboardRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: guardCookie },
  });
  const guardDashboard = await guardDashboardRes.json();
  assert.equal(guardDashboardRes.status, 200);
  const guardFollowUpAlert = guardDashboard.alerts.find((alert: any) => alert.id === "guard-shift-follow-ups");
  assert(guardFollowUpAlert);
  assert.equal(guardFollowUpAlert.type, "access");
  assert.equal(guardFollowUpAlert.href, "/access?tab=shift-log");
  assert.equal(guardFollowUpAlert.taskId, inheritedEntry.task_id);

  const guardAlertTaskRes = await fetch(`${baseUrl}/api/dashboard/alerts/guard-shift-follow-ups/task`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  const guardAlertTask = await guardAlertTaskRes.json();
  assert.equal(guardAlertTaskRes.status, 200);
  assert.equal(guardAlertTask.existing, true);
  assert.equal(guardAlertTask.task.source_type, "guard_shift_log");
  assert.equal(guardAlertTask.task.id, inheritedEntry.task_id);

  const shiftExportRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/export.csv`, {
    headers: { Cookie: guardCookie },
  });
  const shiftExportCsv = await shiftExportRes.text();
  assert.equal(shiftExportRes.status, 200);
  assert.match(shiftExportRes.headers.get("content-type") || "", /text\/csv/);
  assert(shiftExportCsv.startsWith("Sección,Campo,Valor"));
  assert(shiftExportCsv.includes("Visita sin QR validada manualmente"));
  assert(shiftExportCsv.includes("intermitente"));

  const followUpsExportRes = await fetch(`${baseUrl}/api/access/export/shift-log-follow-ups.csv?status=open`, {
    headers: { Cookie: guardCookie },
  });
  const followUpsExportCsv = await followUpsExportRes.text();
  assert.equal(followUpsExportRes.status, 200);
  assert.match(followUpsExportRes.headers.get("content-type") || "", /text\/csv/);
  assert(followUpsExportCsv.startsWith("ID,Bitácora,Fecha turno,Turno,Estado turno,Categoría"));
  assert(followUpsExportCsv.includes(String(inheritedEntry.id)));
  assert(followUpsExportCsv.includes("intermitente"));

  const invalidFollowUpsExportRes = await fetch(`${baseUrl}/api/access/export/shift-log-follow-ups.csv?status=bad`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(invalidFollowUpsExportRes.status, 400);

  const resolveInheritedRes = await fetch(`${baseUrl}/api/access/shift-log-entries/${inheritedEntry.id}/resolve`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ resolved: true }),
  });
  assert.equal(resolveInheritedRes.status, 200);

  const resolveStructuredHandoverRes = await fetch(`${baseUrl}/api/access/shift-log-entries/${structuredHandover.id}/resolve`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ resolved: true }),
  });
  assert.equal(resolveStructuredHandoverRes.status, 200);

  const entryAfterCloseRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/entries`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      category: "handover",
      priority: "medium",
      title: "Registro tardío",
    }),
  });
  assert.equal(entryAfterCloseRes.status, 400);

  const listRes = await fetch(`${baseUrl}/api/access/shift-logs?status=all&date=2026-05-14`, {
    headers: { Cookie: guardCookie },
  });
  const logs = await listRes.json();
  assert.equal(listRes.status, 200);
  assert(logs.some((log: any) => log.id === opened.shiftLog.id && log.status === "closed"));

  const closeEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'guard_shift_log.closed' AND entity_type = 'guard_shift_log' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(opened.shiftLog.id)) as any;
  assert(closeEvent);
});

test("filters dashboard and global search by role", async () => {
  const adminCookie = await login();
  await createStaff(adminCookie, "finance", "role-filter.finance@parkia.local", "99.999.999-9");
  const financeCookie = await login("role-filter.finance@parkia.local", "Cambiar123!");
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const guardDashboardRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: guardCookie },
  });
  const guardDashboard = await guardDashboardRes.json();
  assert.equal(guardDashboardRes.status, 200);
  assert.equal(guardDashboard.revenue.total_collected, 0);
  assert.equal(guardDashboard.revenue.target, 0);
  assert.equal(guardDashboard.revenue.trend, 0);
  assert.deepEqual(guardDashboard.recent_payments, []);
  assert.deepEqual(guardDashboard.expiring_contracts, []);
  assert(!guardDashboard.alerts.some((alert: any) => alert.type === "finance" || alert.type === "contracts" || alert.type === "documents"));

  const guardClientSearchRes = await fetch(`${baseUrl}/api/search?q=Juan`, {
    headers: { Cookie: guardCookie },
  });
  const guardClientSearch = await guardClientSearchRes.json();
  assert.equal(guardClientSearchRes.status, 200);
  assert.deepEqual(guardClientSearch, []);

  const guardPlateSearchRes = await fetch(`${baseUrl}/api/search?q=ABCD`, {
    headers: { Cookie: guardCookie },
  });
  const guardPlateSearch = await guardPlateSearchRes.json();
  assert.equal(guardPlateSearchRes.status, 200);
  assert(guardPlateSearch.length > 0);
  assert.equal(guardPlateSearch[0].type, "space");
  assert(!JSON.stringify(guardPlateSearch).includes("Juan"));
  assert(!JSON.stringify(guardPlateSearch).includes("12.345.678-9"));

  const guardSpacesRes = await fetch(`${baseUrl}/api/spaces`, {
    headers: { Cookie: guardCookie },
  });
  const guardSpaces = await guardSpacesRes.json();
  assert.equal(guardSpacesRes.status, 200);
  assert(!JSON.stringify(guardSpaces).includes("12.345.678-9"));
  assert(guardSpaces.every((space: any) => !("client_rut" in space) && !("financial_status" in space)));
  assert(guardSpaces.every((space: any) => !space.assigned_client || !("rut" in space.assigned_client)));
  assert(guardSpaces.every((space: any) => !space.assigned_client || !("financial_status" in space.assigned_client)));
  const occupiedGuardSpace = guardSpaces.find((space: any) => space.assigned_client);
  if (occupiedGuardSpace) {
    const guardSpaceDetailRes = await fetch(`${baseUrl}/api/spaces/${occupiedGuardSpace.id}/detail`, {
      headers: { Cookie: guardCookie },
    });
    const guardSpaceDetail = await guardSpaceDetailRes.json();
    assert.equal(guardSpaceDetailRes.status, 200);
    assert(!JSON.stringify(guardSpaceDetail.space).includes("12.345.678-9"));
    assert(!("client_rut" in guardSpaceDetail.space));
    assert(!("financial_status" in guardSpaceDetail.space));
    assert(!("rut" in guardSpaceDetail.space.assigned_client));
    assert(!("financial_status" in guardSpaceDetail.space.assigned_client));
  }

  const financeAlertsRes = await fetch(`${baseUrl}/api/dashboard/alerts`, {
    headers: { Cookie: financeCookie },
  });
  const financeAlerts = await financeAlertsRes.json();
  assert.equal(financeAlertsRes.status, 200);
  assert(financeAlerts.alerts.every((alert: any) => ["finance", "documents", "contracts", "general"].includes(alert.type)));
});

test("allows admins to reset staff passwords", async () => {
  const adminCookie = await login();
  const staffId = await createStaff(adminCookie, "guard", "reset.guard@parkia.local", "66.666.666-6");
  const oldCookie = await login("reset.guard@parkia.local", "Cambiar123!");

  const resetRes = await fetch(`${baseUrl}/api/staff/${staffId}/password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ password: "NuevaClave123!", reason: "Reset solicitado por validacion de identidad" }),
  });
  assert.equal(resetRes.status, 200);

  const revokedSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: oldCookie },
  });
  assert.equal(revokedSessionRes.status, 401);

  const oldPasswordRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "reset.guard@parkia.local", password: "Cambiar123!" }),
  });
  assert.equal(oldPasswordRes.status, 401);

  const newCookie = await login("reset.guard@parkia.local", "NuevaClave123!");
  assert(newCookie.includes("parkia_session="));

  const resetEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'staff.password_reset' AND entity_type = 'staff' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(staffId)) as any;
  assert(resetEvent);
  const resetMetadata = JSON.parse(resetEvent.metadata);
  assert.equal(resetMetadata.email, "reset.guard@parkia.local");
  assert.equal(resetMetadata.reason, "Reset solicitado por validacion de identidad");
});

test("forces password changes before staff can operate", async () => {
  const adminCookie = await login();
  const staffId = await createStaff(adminCookie, "guard", "force.guard@parkia.local", "66.666.666-7");

  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "force.guard@parkia.local", password: "Cambiar123!" }),
  });
  const loginBody = await loginRes.json();
  const tempCookie = loginRes.headers.get("set-cookie")?.split(";")[0];
  assert.equal(loginRes.status, 200);
  assert.equal(loginBody.user.must_change_password, true);
  assert(tempCookie);

  const blockedRes = await fetch(`${baseUrl}/api/access/live`, {
    headers: { Cookie: tempCookie },
  });
  const blockedBody = await blockedRes.json();
  assert.equal(blockedRes.status, 403);
  assert.equal(blockedBody.code, "PASSWORD_CHANGE_REQUIRED");

  const changeRes = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: tempCookie,
    },
    body: JSON.stringify({ current_password: "Cambiar123!", new_password: "ClaveOperativa123!" }),
  });
  const changedCookie = changeRes.headers.get("set-cookie")?.split(";")[0];
  assert.equal(changeRes.status, 200);
  assert(changedCookie);

  const allowedRes = await fetch(`${baseUrl}/api/access/live`, {
    headers: { Cookie: changedCookie },
  });
  assert.equal(allowedRes.status, 200);

  const events = db.prepare(`
    SELECT event_type FROM staff_access_events
    WHERE staff_id = ?
    ORDER BY id ASC
  `).all(staffId).map((event: any) => event.event_type);
  assert(events.includes("login"));
  assert(events.includes("password_changed"));
});

test("protects staff status changes with reasons and session revocation", async () => {
  const adminCookie = await login();
  const staffId = await createStaff(adminCookie, "guard", "status.guard@parkia.local", "77.777.777-7");
  const guardCookie = await login("status.guard@parkia.local", "Cambiar123!");

  const missingReasonRes = await fetch(`${baseUrl}/api/staff/${staffId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ status: "inactive" }),
  });
  assert.equal(missingReasonRes.status, 400);

  const disableSelfRes = await fetch(`${baseUrl}/api/staff/1/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ status: "inactive", reason: "Prueba de autoproteccion" }),
  });
  assert.equal(disableSelfRes.status, 400);

  const disableRes = await fetch(`${baseUrl}/api/staff/${staffId}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ status: "inactive", reason: "Termino de turno" }),
  });
  assert.equal(disableRes.status, 200);

  const revokedSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(revokedSessionRes.status, 401);

  const disabledLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "status.guard@parkia.local", password: "Cambiar123!" }),
  });
  assert.equal(disabledLoginRes.status, 401);

  const statusEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'staff.status_updated' AND entity_type = 'staff' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(staffId)) as any;
  assert(statusEvent);
  assert.equal(JSON.parse(statusEvent.metadata).reason, "Termino de turno");
});

test("allows admins to edit staff profiles and roles with a reason", async () => {
  const adminCookie = await login();
  const staffId = await createStaff(adminCookie, "finance", "edit.finance@parkia.local", "77.777.777-8");

  const editRes = await fetch(`${baseUrl}/api/staff/${staffId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      name: "Operador Editado",
      rut: "77.777.777-8",
      email: "edit.finance@parkia.local",
      phone: "+56977777778",
      role: "guard",
      reason: "Cambio de funciones a porteria",
    }),
  });
  assert.equal(editRes.status, 200);

  const staffRes = await fetch(`${baseUrl}/api/staff`, {
    headers: { Cookie: adminCookie },
  });
  const staff = await staffRes.json();
  const edited = staff.find((user: any) => user.id === staffId);
  assert.equal(edited.name, "Operador Editado");
  assert.equal(edited.role, "guard");
  assert.equal(edited.phone, "+56977777778");

  const historyRes = await fetch(`${baseUrl}/api/staff/${staffId}/access-events`, {
    headers: { Cookie: adminCookie },
  });
  const history = await historyRes.json();
  assert.equal(historyRes.status, 200);
  assert(history.some((event: any) => event.event_type === "role_changed"));

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'staff.role_updated' AND entity_type = 'staff' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(staffId)) as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).reason, "Cambio de funciones a porteria");
});

test("serves dashboard priority alerts", async () => {
  const cookie = await login();

  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("2000-01-01", "utilities", "Proveedor Alerta", "Gasto vencido para alerta", 25000, "overdue", "2000-01-02");
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method)
    VALUES (?, ?, date('now'), 'paid', date('now'), 'transfer')
  `).run(1, 120000);
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method)
    VALUES (?, ?, date('now', 'start of month', '-1 month'), 'paid', date('now', 'start of month', '-1 month'), 'transfer')
  `).run(1, 80000);
  db.prepare(`
    INSERT INTO spaces (name, type, status, price, location, level)
    VALUES (?, 'parking', 'available', ?, ?, ?)
  `).run("Estacionamiento Dashboard QA", 45000, "Nivel calle", "1");
  const assignedOverdueTask = db.prepare(`
    INSERT INTO operational_tasks (title, description, category, priority, assigned_staff_id, due_date, created_by_staff_id)
    VALUES (?, ?, 'general', 'high', 1, date('now', '-1 day'), 1)
  `).run("Tarea atrasada para notificacion", "Debe aparecer en campana y dashboard");

  const res = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const dashboard = await res.json();

  assert.equal(res.status, 200);
  assert(Array.isArray(dashboard.alerts));
  assert(dashboard.occupancy.available_parking.some((space: any) => space.name === "Estacionamiento Dashboard QA"));
  assert.equal(dashboard.occupancy.storage_free, 0);
  assert.deepEqual(dashboard.occupancy.available_storage, []);
  assert.equal(dashboard.revenue.trend, 50);
  assert(dashboard.alerts.some((alert: any) => alert.id === "overdue-payments"));
  assert(dashboard.alerts.some((alert: any) => alert.id === "overdue-expenses" && alert.href === "/finance?tab=expenses&expenseStatus=overdue&expenseDue=all"));
  assert(dashboard.alerts.some((alert: any) =>
    alert.id === "my-overdue-tasks-1" &&
    alert.taskId === Number(assignedOverdueTask.lastInsertRowid) &&
    alert.href.includes("/tasks?assigned=me&due=overdue")
  ));
  assert(dashboard.alerts.every((alert: any) => ["critical", "warning", "info"].includes(alert.severity)));

  const alertsRes = await fetch(`${baseUrl}/api/dashboard/alerts`, {
    headers: { Cookie: cookie },
  });
  const alertsBody = await alertsRes.json();
  assert.equal(alertsRes.status, 200);
  assert(Array.isArray(alertsBody.alerts));
  assert(alertsBody.alerts.some((alert: any) => alert.id === "overdue-expenses"));

  const taskRes = await fetch(`${baseUrl}/api/dashboard/alerts/overdue-expenses/task`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const taskBody = await taskRes.json();
  assert.equal(taskRes.status, 200);
  assert.equal(taskBody.existing, false);
  assert.equal(taskBody.task.source_type, "dashboard_alert");
  assert.equal(taskBody.task.source_id, "overdue-expenses");
  assert.equal(taskBody.task.category, "finance");

  const duplicateTaskRes = await fetch(`${baseUrl}/api/dashboard/alerts/overdue-expenses/task`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const duplicateTaskBody = await duplicateTaskRes.json();
  assert.equal(duplicateTaskRes.status, 200);
  assert.equal(duplicateTaskBody.existing, true);
  assert.equal(duplicateTaskBody.task.id, taskBody.task.id);

  const alertTasksRes = await fetch(`${baseUrl}/api/tasks?source=dashboard_alert&status=active`, {
    headers: { Cookie: cookie },
  });
  const alertTasks = await alertTasksRes.json();
  assert.equal(alertTasksRes.status, 200);
  assert(alertTasks.some((task: any) => task.id === taskBody.task.id));

  const missingNoteRes = await fetch(`${baseUrl}/api/tasks/${taskBody.task.id}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ note: "" }),
  });
  assert.equal(missingNoteRes.status, 400);

  const refreshedAlertsRes = await fetch(`${baseUrl}/api/dashboard/alerts`, {
    headers: { Cookie: cookie },
  });
  const refreshedAlertsBody = await refreshedAlertsRes.json();
  const overdueExpensesAlert = refreshedAlertsBody.alerts.find((alert: any) => alert.id === "overdue-expenses");
  assert.equal(overdueExpensesAlert.taskId, taskBody.task.id);
});

test("dashboard access metrics ignore historical activity", async () => {
  const cookie = await login();
  const beforeRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const before = await beforeRes.json();
  assert.equal(beforeRes.status, 200);
  const historicalTimestamp = toSqliteUtc(addMs(before.access.window_start_utc, -3 * 24 * 60 * 60 * 1000));

  db.prepare(`
    INSERT INTO access_logs (access_type, status, method, reason, plate, timestamp)
    VALUES
      ('entry', 'authorized', 'manual', 'Historico no debe contar hoy', 'HIST-DASH-ENTRY', ?),
      ('exit', 'authorized', 'manual', 'Historico no debe contar hoy', 'HIST-DASH-EXIT', ?),
      ('entry', 'denied', 'manual', 'Historico no debe contar hoy', 'HIST-DASH-DENIED', ?)
  `).run(historicalTimestamp, historicalTimestamp, historicalTimestamp);

  const afterRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const after = await afterRes.json();

  assert.equal(afterRes.status, 200);
  assert.equal(after.access.daily_total, before.access.daily_total);
  assert.equal(after.access.today_total, before.access.today_total);
  assert.equal(after.access.entries, before.access.entries);
  assert.equal(after.access.exits, before.access.exits);
  assert.equal(after.access.denied, before.access.denied);
  assert.deepEqual(after.access.hourly_peaks, before.access.hourly_peaks);
  assert.deepEqual(after.access.hourly_series, before.access.hourly_series);
  assert(!after.access.today_access.some((log: any) => String(log.plate || "").startsWith("HIST-DASH")));
});

test("dashboard access metrics and today's list include today's activity", async () => {
  const cookie = await login();
  const beforeRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const before = await beforeRes.json();
  assert.equal(beforeRes.status, 200);
  const entryTime = addMs(before.access.window_end_utc, -3 * 60 * 1000);
  const exitTime = addMs(before.access.window_end_utc, -2 * 60 * 1000);
  const deniedTime = addMs(before.access.window_end_utc, -60 * 1000);
  const currentHour = getChileHour(entryTime);

  db.prepare(`
    INSERT INTO access_logs (access_type, status, method, reason, plate, timestamp)
    VALUES
      ('entry', 'authorized', 'manual', 'Entrada dashboard hoy', 'TODAY-DASH-ENTRY', ?),
      ('exit', 'authorized', 'manual', 'Salida dashboard hoy', 'TODAY-DASH-EXIT', ?),
      ('entry', 'denied', 'manual', 'Denegado dashboard hoy', 'TODAY-DASH-DENIED', ?)
  `).run(toSqliteUtc(entryTime), toSqliteUtc(exitTime), toSqliteUtc(deniedTime));

  const afterRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const after = await afterRes.json();
  const beforeHour = before.access.hourly_series.find((item: any) => item.hour === currentHour) || { count: 0, entries: 0, exits: 0, denied: 0 };
  const afterHour = after.access.hourly_series.find((item: any) => item.hour === currentHour);

  assert.equal(afterRes.status, 200);
  assert.equal(after.access.daily_total, before.access.daily_total + 3);
  assert.equal(after.access.today_total, before.access.today_total + 3);
  assert.equal(after.access.entries, before.access.entries + 1);
  assert.equal(after.access.exits, before.access.exits + 1);
  assert.equal(after.access.denied, before.access.denied + 1);
  assert(afterHour);
  assert.equal(afterHour.count, beforeHour.count + 3);
  assert.equal(afterHour.entries, beforeHour.entries + 1);
  assert.equal(afterHour.exits, beforeHour.exits + 1);
  assert.equal(afterHour.denied, beforeHour.denied + 1);
  assert(after.access.today_access.some((log: any) => log.plate === "TODAY-DASH-ENTRY"));
  assert(after.access.today_access.some((log: any) => log.plate === "TODAY-DASH-EXIT"));
  assert(after.access.today_access.some((log: any) => log.plate === "TODAY-DASH-DENIED"));
  assert.deepEqual(after.access.recent_access, []);
});

test("dashboard access exposes historical recent activity only when today is empty", async () => {
  const cookie = await login();
  const baselineRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const baseline = await baselineRes.json();
  assert.equal(baselineRes.status, 200);
  const oldTimestamp = toSqliteUtc(addMs(baseline.access.window_start_utc, -30 * 24 * 60 * 60 * 1000));
  const recentTimestamp = toSqliteUtc(addMs(baseline.access.window_start_utc, -24 * 60 * 60 * 1000));
  const originalTodayRows = db.prepare(`
    SELECT id, timestamp
    FROM access_logs
    WHERE timestamp >= ?
      AND timestamp < ?
  `).all(baseline.access.window_start_utc.slice(0, 19).replace("T", " "), baseline.access.window_end_utc.slice(0, 19).replace("T", " ")) as { id: number, timestamp: string }[];
  const restoreTimestamp = db.prepare("UPDATE access_logs SET timestamp = ? WHERE id = ?");

  try {
    db.prepare(`
      UPDATE access_logs
      SET timestamp = ?
      WHERE timestamp >= ?
        AND timestamp < ?
    `).run(oldTimestamp, baseline.access.window_start_utc.slice(0, 19).replace("T", " "), baseline.access.window_end_utc.slice(0, 19).replace("T", " "));
    db.prepare(`
      INSERT INTO access_logs (access_type, status, method, reason, plate, timestamp)
      VALUES ('entry', 'authorized', 'manual', 'Fallback historico dashboard', 'RECENT-DASH-HIST', ?)
    `).run(recentTimestamp);

    const res = await fetch(`${baseUrl}/api/dashboard`, {
      headers: { Cookie: cookie },
    });
    const dashboard = await res.json();

    assert.equal(res.status, 200);
    assert.equal(dashboard.access.daily_total, 0);
    assert.equal(dashboard.access.today_total, 0);
    assert.equal(dashboard.access.entries, 0);
    assert.equal(dashboard.access.exits, 0);
    assert.equal(dashboard.access.denied, 0);
    assert.deepEqual(dashboard.access.hourly_peaks, []);
    assert.deepEqual(dashboard.access.hourly_series, []);
    assert.deepEqual(dashboard.access.today_access, []);
    assert(dashboard.access.recent_access.some((log: any) => log.plate === "RECENT-DASH-HIST"));
    assert(dashboard.live_access.some((log: any) => log.plate === "RECENT-DASH-HIST"));
  } finally {
    originalTodayRows.forEach((row) => restoreTimestamp.run(row.timestamp, row.id));
  }
});

test("records denied visitor exit when unpaid ticket blocks totem scan", async () => {
  const cookie = await login();
  const plate = "DENY-777";
  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Test visitor denied dashboard', 'parking', 'occupied', 1000)
  `).run();
  const ticketResult = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES (?, ?, 'active', datetime('now', '-12 hours'))
  `).run(plate, spaceResult.lastInsertRowid);

  db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate)
    VALUES (?, ?, 'entry', 'authorized', 'qr', 'Visita temporal test', ?)
  `).run(ticketResult.lastInsertRowid, spaceResult.lastInsertRowid, plate);

  const res = await fetch(`${baseUrl}/api/totems/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ plate }),
  });
  const body = await res.json();
  const deniedLog = db.prepare(`
    SELECT access_type, status, reason
    FROM access_logs
    WHERE plate = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(plate) as { access_type: string, status: string, reason: string };
  const ticket = db.prepare("SELECT status FROM visitor_tickets WHERE id = ?").get(ticketResult.lastInsertRowid) as { status: string };
  const space = db.prepare("SELECT status FROM spaces WHERE id = ?").get(spaceResult.lastInsertRowid) as { status: string };

  assert.equal(res.status, 400);
  assert.match(body.error, /Debe pagar su ticket/);
  assert.equal(deniedLog.access_type, "exit");
  assert.equal(deniedLog.status, "denied");
  assert.equal(deniedLog.reason, "Ticket pendiente de pago");
  assert.equal(ticket.status, "active");
  assert.equal(space.status, "occupied");
});

test("creates visitor ticket manually at entry and assigns parking space", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Manual cashier ticket space', 'parking', 'available', 1000)
  `).run();

  const createRes = await fetch(`${baseUrl}/api/visitors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ plate: "MIN-001", space_id: spaceResult.lastInsertRowid }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(created.ticket.plate, "MIN-001");
  assert.equal(created.ticket.spaceId, Number(spaceResult.lastInsertRowid));

  const ticket = db.prepare("SELECT status, entry_method, created_by_staff_id FROM visitor_tickets WHERE id = ?").get(created.ticket.ticketId) as any;
  assert.equal(ticket.status, "active");
  assert.equal(ticket.entry_method, "manual");
  assert(ticket.created_by_staff_id);

  const space = db.prepare("SELECT status FROM spaces WHERE id = ?").get(spaceResult.lastInsertRowid) as any;
  assert.equal(space.status, "occupied");

  const accessLog = db.prepare(`
    SELECT access_type, status, method, reason
    FROM access_logs
    WHERE visitor_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(created.ticket.ticketId) as any;
  assert.equal(accessLog.access_type, "entry");
  assert.equal(accessLog.status, "authorized");
  assert.equal(accessLog.method, "manual");
  assert.equal(accessLog.reason, "Ticket creado en caja");

  const lookupRes = await fetch(`${baseUrl}/api/visitors/lookup?plate=MIN001&lost_ticket=true`, {
    headers: { Cookie: guardCookie },
  });
  const lookup = await lookupRes.json();
  assert.equal(lookupRes.status, 200);
  assert.equal(lookup.ticket.id, created.ticket.ticketId);
  assert.equal(lookup.ticket.space_name, "Manual cashier ticket space");
  assert.equal(lookup.quote.visitor_id, created.ticket.ticketId);
  assert.equal(lookup.quote.billing_mode, "per_minute");
  const lostLookupAudit = db.prepare(`
    SELECT *
    FROM audit_events
    WHERE action = 'visitor_ticket.lost_ticket_lookup'
      AND entity_id = ?
  `).get(String(created.ticket.ticketId)) as any;
  assert(lostLookupAudit);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/complete`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  assert.equal(completeRes.status, 200);
});

test("quotes visitor tickets and requires quoted amount for payment", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  db.prepare(`
    UPDATE access_rates
    SET rate_per_minute = 50,
        rate_per_hour = 3000,
        grace_period_mins = 15,
        billing_mode = 'per_minute'
    WHERE lower(type) LIKE '%general%'
  `).run();

  const graceSpace = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Quote grace space', 'parking', 'occupied', 1000)
  `).run();
  const graceTicket = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES ('QUOTE-GRACE', ?, 'active', datetime('now', '-5 minutes'))
  `).run(graceSpace.lastInsertRowid);

  const graceQuoteRes = await fetch(`${baseUrl}/api/visitors/${graceTicket.lastInsertRowid}/quote`, {
    headers: { Cookie: guardCookie },
  });
  const graceQuote = await graceQuoteRes.json();
  assert.equal(graceQuoteRes.status, 200);
  assert.equal(graceQuote.visitor_id, Number(graceTicket.lastInsertRowid));
  assert.equal(graceQuote.total, 0);
  assert.equal(graceQuote.inside_grace, true);
  assert(graceQuote.duration_minutes <= graceQuote.grace_period_mins);

  const paidSpace = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Quote paid space', 'parking', 'occupied', 1000)
  `).run();
  const paidTicket = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES ('QUOTE-PAID', ?, 'active', datetime('now', '-90 minutes'))
  `).run(paidSpace.lastInsertRowid);

  const quoteRes = await fetch(`${baseUrl}/api/visitors/${paidTicket.lastInsertRowid}/quote`, {
    headers: { Cookie: guardCookie },
  });
  const quote = await quoteRes.json();
  assert.equal(quoteRes.status, 200);
  assert.equal(quote.inside_grace, false);
  assert(quote.total > 0);
  assert.equal(typeof quote.rate_per_hour, "number");
  assert.equal(quote.rate_per_minute, 50);
  assert.equal(quote.billing_mode, "per_minute");
  assert.equal(typeof quote.billable_mins, "number");
  assert.equal(quote.total, quote.billable_mins * quote.rate_per_minute);
  assert.equal(quote.rounding_increment, 0);

  const lowPaymentRes = await fetch(`${baseUrl}/api/visitors/${paidTicket.lastInsertRowid}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total - 100 }),
  });
  assert.equal(lowPaymentRes.status, 400);
  const unpaidTicket = db.prepare("SELECT status, paid_at FROM visitor_tickets WHERE id = ?").get(paidTicket.lastInsertRowid) as any;
  assert.equal(unpaidTicket.status, "active");
  assert.equal(unpaidTicket.paid_at, null);

  const payRes = await fetch(`${baseUrl}/api/visitors/${paidTicket.lastInsertRowid}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total }),
  });
  const payBody = await payRes.json();
  assert.equal(payRes.status, 200);
  assert.equal(typeof payBody.cash_session_id, "number");
  assert.equal(payBody.receipt.ticket_id, Number(paidTicket.lastInsertRowid));
  assert.equal(payBody.receipt.plate, "QUOTE-PAID");
  assert.equal(payBody.receipt.billable_mins, quote.billable_mins);
  assert.equal(payBody.receipt.rate_per_minute, 50);
  assert.equal(payBody.receipt.amount_paid, quote.total);
  assert.equal(payBody.receipt.legal_note, "Cobro por minuto efectivo, descontando minutos de gracia y sin redondeo al alza.");

  const cashSummaryRes = await fetch(`${baseUrl}/api/visitors/cash/current`, {
    headers: { Cookie: guardCookie },
  });
  const cashSummary = await cashSummaryRes.json();
  assert.equal(cashSummaryRes.status, 200);
  assert(cashSummary.expectedCash >= quote.total);
  assert(cashSummary.tickets.some((ticket: any) => ticket.id === Number(paidTicket.lastInsertRowid)));

  const paymentsRes = await fetch(`${baseUrl}/api/visitors/payments?plate=QUOTEPAID`, {
    headers: { Cookie: guardCookie },
  });
  const payments = await paymentsRes.json();
  assert.equal(paymentsRes.status, 200);
  assert(payments.some((payment: any) => payment.ticket_id === Number(paidTicket.lastInsertRowid) && payment.receipt_number === payBody.receipt.receipt_number));

  const paid = db.prepare(`
    SELECT status, amount, payment_method, quote_id, quoted_amount, cash_session_id, paid_by_staff_id
    FROM visitor_tickets
    WHERE id = ?
  `).get(paidTicket.lastInsertRowid) as any;
  assert.equal(paid.status, "paid");
  assert.equal(paid.amount, quote.total);
  assert.equal(paid.payment_method, "cash");
  assert.equal(paid.quoted_amount, quote.total);
  assert.equal(paid.cash_session_id, payBody.cash_session_id);
  assert(paid.paid_by_staff_id);

  const movement = db.prepare(`
    SELECT *
    FROM cash_movements
    WHERE source_type = 'visitor_ticket'
      AND source_id = ?
      AND direction = 'in'
  `).get(String(paidTicket.lastInsertRowid)) as any;
  assert(movement);
  assert.equal(movement.cash_session_id, payBody.cash_session_id);
  assert.equal(movement.amount, quote.total);
  assert.equal(movement.method, "cash");
});

test("summarizes shift cash and closes with counted cash difference", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const openRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      shift_date: "2026-05-16",
      shift_name: "morning",
      opening_notes: "Inicio de turno con caja operativa",
    }),
  });
  const opened = await openRes.json();
  assert.equal(openRes.status, 200);
  assert.equal(typeof opened.shiftLog.cash_session_id, "number");

  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Shift cash visitor space', 'parking', 'occupied', 1000)
  `).run();
  const ticketResult = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES ('CASH-SHIFT', ?, 'active', datetime('now', '-120 minutes'))
  `).run(spaceResult.lastInsertRowid);

  const quoteRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/quote`, {
    headers: { Cookie: guardCookie },
  });
  const quote = await quoteRes.json();
  assert.equal(quoteRes.status, 200);
  assert(quote.total > 0);

  const payRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total, quote_id: quote.id }),
  });
  const paid = await payRes.json();
  assert.equal(payRes.status, 200);
  assert.equal(paid.cash_session_id, opened.shiftLog.cash_session_id);

  const detailRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}`, {
    headers: { Cookie: guardCookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.cash.expectedCash, quote.total);
  assert.equal(detail.cash.totals.cash, quote.total);
  assert.equal(detail.cash.blockers.paidTicketsAwaitingExit, 1);
  assert(detail.cash.tickets.some((ticket: any) => ticket.id === Number(ticketResult.lastInsertRowid)));

  const blockedCloseRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/close`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      handover_notes: "Intento de cierre con ticket pendiente de salida",
      counted_cash: quote.total,
      counted_transfer: 0,
      counted_card: 0,
      handover_items: [],
    }),
  });
  const blockedClose = await blockedCloseRes.json();
  assert.equal(blockedCloseRes.status, 400);
  assert.match(blockedClose.error, /pendientes de salida/);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/complete`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  assert.equal(completeRes.status, 200);

  const closeRes = await fetch(`${baseUrl}/api/access/shift-logs/${opened.shiftLog.id}/close`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      handover_notes: "Cierre con caja cuadrada y diferencia declarada",
      cash_count_note: "Sobra 500 en efectivo, se informa a administracion",
      counted_cash: quote.total + 500,
      counted_transfer: 0,
      counted_card: 0,
      handover_items: [],
    }),
  });
  const closed = await closeRes.json();
  assert.equal(closeRes.status, 200);
  assert.equal(closed.shiftLog.status, "closed");

  const cashSession = db.prepare(`
    SELECT status, expected_cash, counted_cash, counted_transfer, counted_card, difference_cash
    FROM cash_sessions
    WHERE id = ?
  `).get(opened.shiftLog.cash_session_id) as any;
  assert.equal(cashSession.status, "closed");
  assert.equal(cashSession.expected_cash, quote.total);
  assert.equal(cashSession.counted_cash, quote.total + 500);
  assert.equal(cashSession.counted_transfer, 0);
  assert.equal(cashSession.counted_card, 0);
  assert.equal(cashSession.difference_cash, 500);

  const cashClosure = db.prepare("SELECT snapshot_json FROM cash_session_closures WHERE cash_session_id = ?").get(opened.shiftLog.cash_session_id) as any;
  const snapshot = JSON.parse(cashClosure.snapshot_json);
  assert.equal(snapshot.expected_cash, quote.total);
  assert.equal(snapshot.difference_cash, 500);
  assert.equal(snapshot.tickets.length, 1);
});

test("closes visitor cash session from visits with audit snapshot and closure history", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const openRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      shift_date: "2026-05-17",
      shift_name: "afternoon",
      opening_notes: "Turno para cierre desde visitas",
    }),
  });
  const opened = await openRes.json();
  assert.equal(openRes.status, 200);
  assert.equal(typeof opened.shiftLog.cash_session_id, "number");

  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Visitor close cash space', 'parking', 'occupied', 1000)
  `).run();
  const ticketResult = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES ('VIS-CLOSE', ?, 'active', datetime('now', '-75 minutes'))
  `).run(spaceResult.lastInsertRowid);

  const quoteRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/quote`, {
    headers: { Cookie: guardCookie },
  });
  const quote = await quoteRes.json();
  assert.equal(quoteRes.status, 200);
  assert(quote.total > 0);

  const payRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total, quote_id: quote.id }),
  });
  const paid = await payRes.json();
  assert.equal(payRes.status, 200);
  assert.equal(paid.cash_session_id, opened.shiftLog.cash_session_id);

  const blockedCloseRes = await fetch(`${baseUrl}/api/visitors/cash/current/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      counted_cash: quote.total,
      counted_transfer: 0,
      counted_card: 0,
      notes: "Intento con salida pendiente",
    }),
  });
  const blockedClose = await blockedCloseRes.json();
  assert.equal(blockedCloseRes.status, 400);
  assert.match(blockedClose.error, /pendiente/);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/complete`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  assert.equal(completeRes.status, 200);

  const closeRes = await fetch(`${baseUrl}/api/visitors/cash/current/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      counted_cash: quote.total - 100,
      counted_transfer: 0,
      counted_card: 0,
      notes: "Faltan 100 pesos al cierre",
      handover_notes: "Caja cerrada desde visitas",
    }),
  });
  const closed = await closeRes.json();
  assert.equal(closeRes.status, 200);
  assert.equal(closed.success, true);
  assert.equal(closed.cash_session_id, opened.shiftLog.cash_session_id);
  assert.equal(closed.shift_log_closed, true);
  assert.equal(closed.closure.expected_cash, quote.total);
  assert.equal(closed.closure.difference_cash, -100);

  const cashSession = db.prepare(`
    SELECT status, expected_cash, counted_cash, difference_cash
    FROM cash_sessions
    WHERE id = ?
  `).get(opened.shiftLog.cash_session_id) as any;
  assert.equal(cashSession.status, "closed");
  assert.equal(cashSession.expected_cash, quote.total);
  assert.equal(cashSession.counted_cash, quote.total - 100);
  assert.equal(cashSession.difference_cash, -100);

  const shiftLog = db.prepare("SELECT status, handover_notes, cash_count_note FROM guard_shift_logs WHERE id = ?").get(opened.shiftLog.id) as any;
  assert.equal(shiftLog.status, "closed");
  assert.equal(shiftLog.handover_notes, "Caja cerrada desde visitas");
  assert.equal(shiftLog.cash_count_note, "Faltan 100 pesos al cierre");

  const closuresRes = await fetch(`${baseUrl}/api/visitors/cash/closures`, {
    headers: { Cookie: guardCookie },
  });
  const closures = await closuresRes.json();
  assert.equal(closuresRes.status, 200);
  assert(closures.some((closure: any) =>
    closure.id === opened.shiftLog.cash_session_id &&
    closure.expected_cash === quote.total &&
    closure.difference_cash === -100
  ));

  const closeEvent = db.prepare(`
    SELECT metadata
    FROM audit_events
    WHERE action = 'cash_session.closed'
      AND entity_type = 'cash_session'
      AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(opened.shiftLog.cash_session_id)) as any;
  assert(closeEvent);
  assert.equal(JSON.parse(closeEvent.metadata).difference_cash, -100);
});

test("cashier role operates visitor ticket flow without finance or security access", async () => {
  const adminCookie = await login();
  await createStaff(adminCookie, "cashier", "cashier.flow@parkia.local", "88.888.888-1");
  const cashierCookie = await login("cashier.flow@parkia.local", "Cambiar123!");

  const meRes = await fetch(`${baseUrl}/api/auth/me`, {
    headers: { Cookie: cashierCookie },
  });
  const me = await meRes.json();
  assert.equal(meRes.status, 200);
  assert.equal(me.user.role, "cashier");

  const financeRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: cashierCookie },
  });
  assert.equal(financeRes.status, 403);

  const accessRes = await fetch(`${baseUrl}/api/access/shift-logs`, {
    headers: { Cookie: cashierCookie },
  });
  assert.equal(accessRes.status, 403);

  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Cashier role ticket space', 'parking', 'available', 1000)
  `).run();

  const statusRes = await fetch(`${baseUrl}/api/spaces/${spaceResult.lastInsertRowid}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cashierCookie,
    },
    body: JSON.stringify({ status: "maintenance", notes: "cashier should not update space status" }),
  });
  assert.equal(statusRes.status, 403);

  const createRes = await fetch(`${baseUrl}/api/visitors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cashierCookie,
    },
    body: JSON.stringify({ plate: "CASHIER-1", space_id: spaceResult.lastInsertRowid }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  db.prepare("UPDATE visitor_tickets SET entry_time = datetime('now', '-90 minutes') WHERE id = ?").run(created.ticket.ticketId);

  const quoteRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/quote`, {
    headers: { Cookie: cashierCookie },
  });
  const quote = await quoteRes.json();
  assert.equal(quoteRes.status, 200);
  assert(quote.total > 0);

  const lowPayRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cashierCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total - 1, quote_id: quote.id }),
  });
  assert.equal(lowPayRes.status, 400);

  const payRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cashierCookie,
    },
    body: JSON.stringify({ method: "cash", amount: quote.total, quote_id: quote.id }),
  });
  const paid = await payRes.json();
  assert.equal(payRes.status, 200);
  assert.equal(paid.receipt.cashier_name, "cashier Test");

  const dashboardRes = await fetch(`${baseUrl}/api/dashboard`, {
    headers: { Cookie: cashierCookie },
  });
  const dashboard = await dashboardRes.json();
  assert.equal(dashboardRes.status, 200);
  assert.equal(dashboard.revenue.total_collected, 0);
  assert.deepEqual(dashboard.recent_payments, []);
  assert.equal(dashboard.operations_daily.visitorRevenue.total, 0);
  assert.equal(dashboard.operations_daily.visitorRevenue.count >= 1, true);
  assert.deepEqual(dashboard.operations_daily.byCashier, []);

  const spacesRes = await fetch(`${baseUrl}/api/spaces`, {
    headers: { Cookie: cashierCookie },
  });
  const spaces = await spacesRes.json();
  assert.equal(spacesRes.status, 200);
  assert(spaces.every((space: any) => !("client_rut" in space) && !("financial_status" in space)));

  const exportRes = await fetch(`${baseUrl}/api/dashboard/export/operations-daily.csv`, {
    headers: { Cookie: cashierCookie },
  });
  assert.equal(exportRes.status, 403);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/complete`, {
    method: "POST",
    headers: { Cookie: cashierCookie },
  });
  assert.equal(completeRes.status, 200);
});

test("exports daily operations and visitor cash reports", async () => {
  const adminCookie = await login();
  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Export visitor report space', 'parking', 'available', 1000)
  `).run();

  const createRes = await fetch(`${baseUrl}/api/visitors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ plate: "EXPORT-1", space_id: spaceResult.lastInsertRowid }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  db.prepare("UPDATE visitor_tickets SET entry_time = datetime('now', '-80 minutes') WHERE id = ?").run(created.ticket.ticketId);

  const quoteRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/quote`, {
    headers: { Cookie: adminCookie },
  });
  const quote = await quoteRes.json();
  assert.equal(quoteRes.status, 200);
  assert(quote.total > 0);

  const payRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ method: "card", amount: quote.total, quote_id: quote.id }),
  });
  assert.equal(payRes.status, 200);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${created.ticket.ticketId}/complete`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  assert.equal(completeRes.status, 200);

  const closeRes = await fetch(`${baseUrl}/api/visitors/cash/current/close`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      counted_cash: 0,
      counted_transfer: 0,
      counted_card: quote.total,
      notes: "Cierre para exportables",
    }),
  });
  assert.equal(closeRes.status, 200);

  const dailyRes = await fetch(`${baseUrl}/api/dashboard/operations-daily`, {
    headers: { Cookie: adminCookie },
  });
  const daily = await dailyRes.json();
  assert.equal(dailyRes.status, 200);
  assert(daily.visitorRevenue.total >= quote.total);
  assert(daily.byCashier.some((row: any) => row.tickets >= 1));

  const csvRes = await fetch(`${baseUrl}/api/dashboard/export/operations-daily.csv`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get("content-type") || "", /text\/csv/);
  assert.match(await csvRes.text(), /Ingresos/);

  const xlsxRes = await fetch(`${baseUrl}/api/dashboard/export/operations-daily.xlsx`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(xlsxRes.status, 200);
  const dailyWorkbook = await readXlsxWorkbook(xlsxRes);
  assert.equal(dailyWorkbook.worksheets[0].name, "Operacion diaria");

  const pdfRes = await fetch(`${baseUrl}/api/dashboard/export/operations-daily.pdf`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(pdfRes.status, 200);
  assert.match(pdfRes.headers.get("content-type") || "", /application\/pdf/);
  assert.equal(Buffer.from(await pdfRes.arrayBuffer()).subarray(0, 4).toString("latin1"), "%PDF");

  const paymentsCsvRes = await fetch(`${baseUrl}/api/visitors/payments/export.csv`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(paymentsCsvRes.status, 200);
  assert.match(await paymentsCsvRes.text(), /EXPORT-1/);

  const paymentsXlsxRes = await fetch(`${baseUrl}/api/visitors/payments/export.xlsx`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(paymentsXlsxRes.status, 200);
  const paymentsWorkbook = await readXlsxWorkbook(paymentsXlsxRes);
  assert.equal(paymentsWorkbook.worksheets[0].name, "Cobros visitas");

  const closuresCsvRes = await fetch(`${baseUrl}/api/visitors/cash/closures/export.csv`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(closuresCsvRes.status, 200);
  assert.match(await closuresCsvRes.text(), /Cierre para exportables/);

  const closuresXlsxRes = await fetch(`${baseUrl}/api/visitors/cash/closures/export.xlsx`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(closuresXlsxRes.status, 200);
  const closuresWorkbook = await readXlsxWorkbook(closuresXlsxRes);
  assert.equal(closuresWorkbook.worksheets[0].name, "Cierres caja");
});

test("manual visitor completion frees parking space and records exit", async () => {
  const adminCookie = await login();
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const plate = "DONE-2026";
  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Manual visitor completion space', 'parking', 'occupied', 1000)
  `).run();
  const ticketResult = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES (?, ?, 'active', datetime('now', '-30 minutes'))
  `).run(plate, spaceResult.lastInsertRowid);

  const payRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ method: "cash", amount: 3500 }),
  });
  assert.equal(payRes.status, 200);

  const completeRes = await fetch(`${baseUrl}/api/visitors/${ticketResult.lastInsertRowid}/complete`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  const complete = await completeRes.json();
  assert.equal(completeRes.status, 200);
  assert.equal(complete.released_space_id, Number(spaceResult.lastInsertRowid));

  const ticket = db.prepare("SELECT status, exit_time FROM visitor_tickets WHERE id = ?").get(ticketResult.lastInsertRowid) as any;
  const space = db.prepare("SELECT status FROM spaces WHERE id = ?").get(spaceResult.lastInsertRowid) as { status: string };
  const exitLog = db.prepare(`
    SELECT access_type, status, method, reason
    FROM access_logs
    WHERE visitor_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(ticketResult.lastInsertRowid) as any;

  assert.equal(ticket.status, "completed");
  assert(ticket.exit_time);
  assert.equal(space.status, "available");
  assert.equal(exitLog.access_type, "exit");
  assert.equal(exitLog.method, "manual");
  assert.equal(exitLog.reason, "Salida de visita finalizada manualmente");

  const summaryRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: adminCookie },
  });
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert(summary.totalCollected >= 3500);

  const collectionsRes = await fetch(`${baseUrl}/api/finance/reports/collections`, {
    headers: { Cookie: adminCookie },
  });
  const collections = await collectionsRes.json();
  assert.equal(collectionsRes.status, 200);
  assert(collections.byMethod.some((item: any) => item.method === "cash" && item.total >= 3500));
});

test("links denied access to manual override resolution", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const adminCookie = await login();
  const denied = db.prepare(`
    INSERT INTO access_logs (space_id, access_type, status, method, reason, plate)
    VALUES (1, 'entry', 'denied', 'qr', 'Patente sin autorizacion vigente', 'DEN-TRACE-1')
  `).run();

  const overrideRes = await fetch(`${baseUrl}/api/access/override`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      space_id: 1,
      denied_access_log_id: denied.lastInsertRowid,
      reason: "Supervisor autoriza apertura por validacion presencial",
    }),
  });
  const override = await overrideRes.json();
  assert.equal(overrideRes.status, 200);
  assert.equal(override.denied_access_log_id, denied.lastInsertRowid);

  const deniedAfter = db.prepare(`
    SELECT resolved_by_access_log_id, resolved_at, resolution_note
    FROM access_logs
    WHERE id = ?
  `).get(denied.lastInsertRowid) as any;
  assert.equal(deniedAfter.resolved_by_access_log_id, override.id);
  assert(deniedAfter.resolved_at);
  assert.equal(deniedAfter.resolution_note, "Supervisor autoriza apertura por validacion presencial");

  const guardAuditRes = await fetch(`${baseUrl}/api/access/audit?type=denied&user=DEN-TRACE-1`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(guardAuditRes.status, 403);

  const auditRes = await fetch(`${baseUrl}/api/access/audit?type=denied&user=DEN-TRACE-1`, {
    headers: { Cookie: adminCookie },
  });
  const auditRows = await auditRes.json();
  assert.equal(auditRes.status, 200);
  assert(auditRows.some((row: any) => row.id === denied.lastInsertRowid && row.resolved_by_access_log_id === override.id));

  const event = db.prepare(`
    SELECT *
    FROM audit_events
    WHERE action = 'access.denied_resolved_by_override'
      AND entity_type = 'access_log'
      AND entity_id = ?
  `).get(String(override.id)) as any;
  assert(event);
});

test("manual override of denied visitor exit completes ticket and frees space", async () => {
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const plate = "EXIT-OVR-1";
  const spaceResult = db.prepare(`
    INSERT INTO spaces (name, type, status, price)
    VALUES ('Override visitor exit space', 'parking', 'occupied', 1000)
  `).run();
  const ticketResult = db.prepare(`
    INSERT INTO visitor_tickets (plate, space_id, status, entry_time)
    VALUES (?, ?, 'active', datetime('now', '-6 hours'))
  `).run(plate, spaceResult.lastInsertRowid);
  db.prepare(`
    INSERT INTO access_logs (visitor_id, space_id, access_type, status, method, reason, plate)
    VALUES (?, ?, 'entry', 'authorized', 'qr', 'Visita temporal test', ?)
  `).run(ticketResult.lastInsertRowid, spaceResult.lastInsertRowid, plate);

  const scanRes = await fetch(`${baseUrl}/api/totems/scan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ plate }),
  });
  assert.equal(scanRes.status, 400);
  const denied = db.prepare(`
    SELECT *
    FROM access_logs
    WHERE visitor_id = ? AND access_type = 'exit' AND status = 'denied'
    ORDER BY id DESC
    LIMIT 1
  `).get(ticketResult.lastInsertRowid) as any;
  assert(denied);

  const overrideRes = await fetch(`${baseUrl}/api/access/override`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      space_id: spaceResult.lastInsertRowid,
      denied_access_log_id: denied.id,
      reason: "Supervisor autoriza salida y deriva cobro a administracion",
    }),
  });
  const override = await overrideRes.json();
  assert.equal(overrideRes.status, 200);
  assert.equal(override.access_type, "exit");
  assert.equal(override.manual_only, true);

  const authorizedExit = db.prepare(`
    SELECT access_type, status, method, visitor_id, space_id, plate
    FROM access_logs
    WHERE id = ?
  `).get(override.id) as any;
  assert.equal(authorizedExit.access_type, "exit");
  assert.equal(authorizedExit.status, "authorized");
  assert.equal(authorizedExit.method, "manual");
  assert.equal(authorizedExit.visitor_id, ticketResult.lastInsertRowid);
  assert.equal(authorizedExit.space_id, spaceResult.lastInsertRowid);

  const ticket = db.prepare("SELECT status, exit_time FROM visitor_tickets WHERE id = ?").get(ticketResult.lastInsertRowid) as any;
  const space = db.prepare("SELECT status FROM spaces WHERE id = ?").get(spaceResult.lastInsertRowid) as any;
  assert.equal(ticket.status, "completed");
  assert(ticket.exit_time);
  assert.equal(space.status, "available");

  const deniedAfter = db.prepare("SELECT resolved_by_access_log_id, resolved_at FROM access_logs WHERE id = ?").get(denied.id) as any;
  assert.equal(deniedAfter.resolved_by_access_log_id, override.id);
  assert(deniedAfter.resolved_at);
});

test("manages operational tasks", async () => {
  const cookie = await login();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const createRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Revisar cartola pendiente",
      description: "Validar movimientos sin match automático",
      category: "finance",
      priority: "high",
      assigned_staff_id: 1,
      due_date: "2026-05-30",
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(created.task.title, "Revisar cartola pendiente");
  assert.equal(created.task.assigned_staff_name, "Admin Parkia");

  const approvalSourceRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Aprobacion gasto con origen",
      category: "finance",
      priority: "high",
      source_type: "finance_expense_approval",
      source_id: "123",
    }),
  });
  const approvalSource = await approvalSourceRes.json();
  assert.equal(approvalSourceRes.status, 200);
  assert.equal(approvalSource.task.source_href, "/finance?tab=expenses&expenseId=123");
  assert.equal(approvalSource.task.source_label, "Aprobación gasto");

  const financeApprovalTasksRes = await fetch(`${baseUrl}/api/tasks?source=finance_approval&status=active`, {
    headers: { Cookie: cookie },
  });
  const financeApprovalTasks = await financeApprovalTasksRes.json();
  assert.equal(financeApprovalTasksRes.status, 200);
  assert(financeApprovalTasks.some((task: any) => task.id === approvalSource.task.id));

  const expenseApprovalTasksRes = await fetch(`${baseUrl}/api/tasks?source=finance_expense_approval&status=active`, {
    headers: { Cookie: cookie },
  });
  const expenseApprovalTasks = await expenseApprovalTasksRes.json();
  assert.equal(expenseApprovalTasksRes.status, 200);
  assert(expenseApprovalTasks.some((task: any) => task.id === approvalSource.task.id));

  const listRes = await fetch(`${baseUrl}/api/tasks?assigned=me&status=active`, {
    headers: { Cookie: cookie },
  });
  const tasks = await listRes.json();
  assert.equal(listRes.status, 200);
  assert(tasks.some((task: any) => task.id === created.task.id));

  const todayTaskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "UX tarea vence hoy",
      category: "general",
      priority: "medium",
      due_date: today,
    }),
  });
  const todayTask = await todayTaskRes.json();
  assert.equal(todayTaskRes.status, 200);

  const overdueTaskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "UX tarea atrasada",
      category: "general",
      priority: "low",
      due_date: yesterday,
    }),
  });
  const overdueTask = await overdueTaskRes.json();
  assert.equal(overdueTaskRes.status, 200);

  const dueTodayRes = await fetch(`${baseUrl}/api/tasks?status=active&due=today`, {
    headers: { Cookie: cookie },
  });
  const dueTodayTasks = await dueTodayRes.json();
  assert.equal(dueTodayRes.status, 200);
  assert(dueTodayTasks.some((task: any) => task.id === todayTask.task.id));
  assert(!dueTodayTasks.some((task: any) => task.id === overdueTask.task.id));
  assert(dueTodayTasks.every((task: any) => task.due_date === today));

  const overdueListRes = await fetch(`${baseUrl}/api/tasks?status=active&due=overdue`, {
    headers: { Cookie: cookie },
  });
  const overdueTasks = await overdueListRes.json();
  assert.equal(overdueListRes.status, 200);
  assert(overdueTasks.some((task: any) => task.id === overdueTask.task.id));
  assert(!overdueTasks.some((task: any) => task.id === todayTask.task.id));
  assert(overdueTasks.every((task: any) => task.due_date && task.due_date < today));

  const updateRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "in_progress", priority: "critical" }),
  });
  const updated = await updateRes.json();
  assert.equal(updateRes.status, 200);
  assert.equal(updated.task.status, "in_progress");
  assert.equal(updated.task.priority, "critical");

  const criticalListRes = await fetch(`${baseUrl}/api/tasks?status=active&priority=critical`, {
    headers: { Cookie: cookie },
  });
  const criticalTasks = await criticalListRes.json();
  assert.equal(criticalListRes.status, 200);
  assert(criticalTasks.some((task: any) => task.id === created.task.id));
  assert(criticalTasks.every((task: any) => task.priority === "critical"));

  const editRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Revisar cartola pendiente editada",
      description: "Detalle actualizado desde seguimiento",
      assigned_staff_id: null,
      due_date: null,
    }),
  });
  const edited = await editRes.json();
  assert.equal(editRes.status, 200);
  assert.equal(edited.task.title, "Revisar cartola pendiente editada");
  assert.equal(edited.task.assigned_staff_id, null);
  assert.equal(edited.task.due_date, null);

  const cancelCreateRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: "Anular tarea con respaldo",
      category: "general",
      priority: "medium",
    }),
  });
  const cancelCandidate = await cancelCreateRes.json();
  assert.equal(cancelCreateRes.status, 200);

  const cancelMissingNoteRes = await fetch(`${baseUrl}/api/tasks/${cancelCandidate.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "cancelled" }),
  });
  assert.equal(cancelMissingNoteRes.status, 400);

  const cancelRes = await fetch(`${baseUrl}/api/tasks/${cancelCandidate.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "cancelled", status_note: "Duplicada por revision operacional" }),
  });
  const cancelled = await cancelRes.json();
  assert.equal(cancelRes.status, 200);
  assert.equal(cancelled.task.status, "cancelled");

  const cancelEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'operational_task.updated' AND entity_type = 'operational_task' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(cancelCandidate.task.id)) as any;
  assert(cancelEvent);
  assert.equal(JSON.parse(cancelEvent.metadata).status_note, "Duplicada por revision operacional");

  const historyRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}/history`, {
    headers: { Cookie: cookie },
  });
  const history = await historyRes.json();
  assert.equal(historyRes.status, 200);
  assert(history.some((event: any) => event.action === "operational_task.updated"));

  const commentRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      note: "Se adjunta evidencia de gestion",
      attachment: {
        fileName: "evidencia.pdf",
        mimeType: "application/pdf",
        dataBase64: Buffer.from("%PDF-1.4 tarea").toString("base64"),
      },
    }),
  });
  const commentBody = await commentRes.json();
  assert.equal(commentRes.status, 200);
  assert.equal(typeof commentBody.id, "number");

  const commentsRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}/comments`, {
    headers: { Cookie: cookie },
  });
  const comments = await commentsRes.json();
  assert.equal(commentsRes.status, 200);
  const savedComment = comments.find((comment: any) => comment.id === commentBody.id);
  assert(savedComment);
  assert.equal(savedComment.note, "Se adjunta evidencia de gestion");
  assert.equal(savedComment.attachment_file_name, "evidencia.pdf");

  const attachmentRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}/attachments/${savedComment.attachment_id}/download`, {
    headers: { Cookie: cookie },
  });
  assert.equal(attachmentRes.status, 200);
  assert.equal(attachmentRes.headers.get("content-type"), "application/pdf");

  const summaryRes = await fetch(`${baseUrl}/api/tasks/summary`, {
    headers: { Cookie: cookie },
  });
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert(summary.criticalActive >= 1);

  const completeRes = await fetch(`${baseUrl}/api/tasks/${created.task.id}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ note: "Validado por administración" }),
  });
  const completed = await completeRes.json();
  assert.equal(completeRes.status, 200);
  assert.equal(completed.task.status, "done");
  assert.equal(completed.task.completed_note, "Validado por administración");
});

test("enforces category permissions for operational tasks", async () => {
  const adminCookie = await login();
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");
  const guardStaff = db.prepare("SELECT id FROM staff WHERE role = 'guard' AND status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number };
  const financeStaff = db.prepare("SELECT id FROM staff WHERE role = 'finance' AND status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number };

  const financeTaskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      title: "Validar pago sensible",
      category: "finance",
      priority: "high",
    }),
  });
  const financeTask = await financeTaskRes.json();
  assert.equal(financeTaskRes.status, 200);

  const invalidFinanceAssigneeRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      title: "Asignacion imposible a guardia",
      category: "finance",
      priority: "high",
      assigned_staff_id: guardStaff.id,
    }),
  });
  assert.equal(invalidFinanceAssigneeRes.status, 400);

  const guardFinanceListRes = await fetch(`${baseUrl}/api/tasks?category=finance&status=all`, {
    headers: { Cookie: guardCookie },
  });
  const guardFinanceList = await guardFinanceListRes.json();
  assert.equal(guardFinanceListRes.status, 200);
  assert.deepEqual(guardFinanceList, []);

  const guardFinanceHistoryRes = await fetch(`${baseUrl}/api/tasks/${financeTask.task.id}/history`, {
    headers: { Cookie: guardCookie },
  });
  assert.equal(guardFinanceHistoryRes.status, 403);

  const guardEditFinanceRes = await fetch(`${baseUrl}/api/tasks/${financeTask.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ status: "in_progress" }),
  });
  assert.equal(guardEditFinanceRes.status, 403);

  const guardCloseFinanceRes = await fetch(`${baseUrl}/api/tasks/${financeTask.task.id}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ note: "Intento guardia" }),
  });
  assert.equal(guardCloseFinanceRes.status, 403);

  const guardCreateFinanceRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      title: "Crear tarea financiera desde guardia",
      category: "finance",
      priority: "medium",
    }),
  });
  assert.equal(guardCreateFinanceRes.status, 403);

  const guardAccessTaskRes = await fetch(`${baseUrl}/api/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({
      title: "Revisar acceso nocturno",
      category: "access",
      priority: "medium",
    }),
  });
  const guardAccessTask = await guardAccessTaskRes.json();
  assert.equal(guardAccessTaskRes.status, 200);
  assert.equal(guardAccessTask.task.category, "access");

  const invalidAccessAssigneeRes = await fetch(`${baseUrl}/api/tasks/${guardAccessTask.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ assigned_staff_id: financeStaff.id }),
  });
  assert.equal(invalidAccessAssigneeRes.status, 400);

  const financeCookie = await login("finance@parkia.local", "Cambiar123!");
  const financeAccessListRes = await fetch(`${baseUrl}/api/tasks?category=access&status=all`, {
    headers: { Cookie: financeCookie },
  });
  const financeAccessList = await financeAccessListRes.json();
  assert.equal(financeAccessListRes.status, 200);
  assert.deepEqual(financeAccessList, []);

  const guardStartAccessRes = await fetch(`${baseUrl}/api/tasks/${guardAccessTask.task.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: guardCookie,
    },
    body: JSON.stringify({ status: "in_progress" }),
  });
  assert.equal(guardStartAccessRes.status, 200);
});

test("creating a contract marks the selected space as occupied", async () => {
  const cookie = await login();

  const availableRes = await fetch(`${baseUrl}/api/spaces/available`, {
    headers: { Cookie: cookie },
  });
  const availableSpaces = await availableRes.json();
  const space = availableSpaces.find((item: any) => item.type === "parking");
  assert(space);

  const res = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: space.id,
      start_date: "2026-05-12",
      monthly_fee: 50000,
      billing_day: 5,
      deposit_amount: 100000,
      billing_document_type: "factura_exenta",
      notes: "Entrega con control remoto",
    }),
  });
  const createdContract = await res.json();
  assert.equal(res.status, 200);
  assert.equal(createdContract.receivables.created, 12);
  assert.equal(createdContract.receivables.firstDueDate, "2026-06-05");

  const spacesRes = await fetch(`${baseUrl}/api/spaces`, {
    headers: { Cookie: cookie },
  });
  const spaces = await spacesRes.json();
  const updatedSpace = spaces.find((item: any) => item.id === space.id);
  assert.equal(updatedSpace.status, "occupied");

  const contract = db.prepare("SELECT * FROM contracts WHERE space_id = ? ORDER BY id DESC LIMIT 1").get(space.id) as any;
  assert.equal(contract.deposit_amount, 100000);
  assert.equal(contract.billing_document_type, "factura_exenta");
  assert.equal(contract.notes, "Entrega con control remoto");

  const generatedPayments = db.prepare("SELECT * FROM payments WHERE contract_id = ? ORDER BY due_date ASC").all(contract.id) as any[];
  assert.equal(generatedPayments.length, 12);
  assert.equal(generatedPayments[0].due_date, "2026-06-05");
  assert.equal(generatedPayments[0].amount, 50000);
  assert(generatedPayments.every(payment => payment.status === "pending"));

  const contractEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'contract.created' AND entity_type = 'contract'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(contractEvent);
  assert.equal(JSON.parse(contractEvent.metadata).space_id, space.id);
  assert.equal(JSON.parse(contractEvent.metadata).receivables.created, 12);

  const printRes = await fetch(`${baseUrl}/api/contracts/${contract.id}/print`, {
    headers: { Cookie: cookie },
  });
  const printHtml = await printRes.text();
  assert.equal(printRes.status, 200);
  assert.match(printRes.headers.get("content-type") || "", /text\/html/);
  assert.match(printHtml, /Contrato de Arriendo/);
  assert.match(printHtml, /Juan Perez/);

  const pdfRes = await fetch(`${baseUrl}/api/contracts/${contract.id}/pdf`, {
    headers: { Cookie: cookie },
  });
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  assert.equal(pdfRes.status, 200);
  assert.match(pdfRes.headers.get("content-type") || "", /application\/pdf/);
  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");

  const generatePdfRes = await fetch(`${baseUrl}/api/contracts/${contract.id}/generate-pdf`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const generatedPdf = await generatePdfRes.json();
  assert.equal(generatePdfRes.status, 200);
  assert.equal(typeof generatedPdf.id, "number");

  const generatedDocument = db.prepare("SELECT * FROM documents WHERE id = ?").get(generatedPdf.id) as any;
  assert.equal(generatedDocument.entity_type, "contract");
  assert.equal(generatedDocument.entity_id, contract.id);
  assert.equal(generatedDocument.mime_type, "application/pdf");

  const signedUploadRes = await fetch(`${baseUrl}/api/documents/contract/${contract.id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Contrato firmado",
      document_type: "contract",
      status: "approved",
      fileName: "contrato-firmado.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 signed contract").toString("base64"),
    }),
  });
  const signedUpload = await signedUploadRes.json();
  assert.equal(signedUploadRes.status, 200);

  const contractDocumentsRes = await fetch(`${baseUrl}/api/documents/contract/${contract.id}`, {
    headers: { Cookie: cookie },
  });
  const contractDocuments = await contractDocumentsRes.json();
  assert.equal(contractDocumentsRes.status, 200);
  assert(contractDocuments.some((document: any) => document.id === signedUpload.id && document.status === "approved"));
});

test("rejects contracts for occupied, missing, or invalid entities", async () => {
  const cookie = await login();

  const occupiedSpaceRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: 1,
      start_date: "2026-05-12",
      monthly_fee: 50000,
      billing_day: 5,
    }),
  });
  assert.equal(occupiedSpaceRes.status, 400);

  const missingClientRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 99999,
      space_id: 2,
      start_date: "2026-05-12",
      monthly_fee: 50000,
      billing_day: 5,
    }),
  });
  assert.equal(missingClientRes.status, 400);

  const missingSpaceRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: 99999,
      start_date: "2026-05-12",
      monthly_fee: 50000,
      billing_day: 5,
    }),
  });
  assert.equal(missingSpaceRes.status, 400);
});

test("updates contract lifecycle with audit and releases space on termination", async () => {
  const cookie = await login();

  const availableSpaces = await (await fetch(`${baseUrl}/api/spaces/available`, {
    headers: { Cookie: cookie },
  })).json();
  const space = availableSpaces.find((item: any) => item.type === "parking");
  assert(space);

  const createRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: space.id,
      start_date: "2026-05-12",
      monthly_fee: 75000,
      billing_day: 5,
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);

  const suspendRes = await fetch(`${baseUrl}/api/contracts/${created.id}/suspend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ reason: "Mora administrativa", effective_date: "2026-05-13" }),
  });
  assert.equal(suspendRes.status, 200);
  assert.equal((db.prepare("SELECT status FROM contracts WHERE id = ?").get(created.id) as any).status, "suspended");

  const reactivateRes = await fetch(`${baseUrl}/api/contracts/${created.id}/reactivate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ reason: "Regularización de deuda", effective_date: "2026-05-14" }),
  });
  assert.equal(reactivateRes.status, 200);
  assert.equal((db.prepare("SELECT status FROM contracts WHERE id = ?").get(created.id) as any).status, "active");

  const renewRes = await fetch(`${baseUrl}/api/contracts/${created.id}/renew`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ new_end_date: "2026-06-30" }),
  });
  assert.equal(renewRes.status, 200);
  assert.equal((db.prepare("SELECT end_date FROM contracts WHERE id = ?").get(created.id) as any).end_date, "2026-06-30");

  const invalidRenewRes = await fetch(`${baseUrl}/api/contracts/${created.id}/renew`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ new_end_date: "2026-06-01" }),
  });
  assert.equal(invalidRenewRes.status, 400);

  const terminateRes = await fetch(`${baseUrl}/api/contracts/${created.id}/terminate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ reason: "Término solicitado por cliente", effective_date: "2026-05-15" }),
  });
  assert.equal(terminateRes.status, 200);

  const contract = db.prepare("SELECT status, end_date FROM contracts WHERE id = ?").get(created.id) as any;
  assert.equal(contract.status, "terminated");
  assert.equal(contract.end_date, "2026-05-15");
  assert.equal((db.prepare("SELECT status FROM spaces WHERE id = ?").get(space.id) as any).status, "available");

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'contract.terminated' AND entity_type = 'contract' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(created.id)) as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).space_id, space.id);
  assert.equal(JSON.parse(auditEvent.metadata).receivables.cancelled, 1);
  const futurePayments = db.prepare("SELECT status FROM payments WHERE contract_id = ? AND due_date > ?").all(created.id, "2026-05-15") as any[];
  assert(futurePayments.length >= 1);
  assert(futurePayments.every(payment => payment.status === "cancelled"));
});

test("edits contract terms and recalculates future receivables safely", async () => {
  const cookie = await login();

  const availableSpaces = await (await fetch(`${baseUrl}/api/spaces/available`, {
    headers: { Cookie: cookie },
  })).json();
  const space = availableSpaces.find((item: any) => item.type === "parking");
  assert(space);

  const createRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: space.id,
      start_date: "2026-09-01",
      end_date: "2026-12-31",
      monthly_fee: 100000,
      billing_day: 10,
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(created.receivables.created, 4);

  const editRes = await fetch(`${baseUrl}/api/contracts/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      end_date: "2026-11-30",
      monthly_fee: 120000,
      billing_day: 15,
      deposit_amount: 250000,
      reason: "Ajuste de tarifa y vigencia acordado con cliente",
    }),
  });
  const editBody = await editRes.json();
  assert.equal(editRes.status, 200);
  assert.equal(editBody.receivables.created, 3);
  assert.equal(editBody.receivables.cancelled, 4);

  const contract = db.prepare("SELECT monthly_fee, billing_day, deposit_amount, end_date FROM contracts WHERE id = ?").get(created.id) as any;
  assert.equal(contract.monthly_fee, 120000);
  assert.equal(contract.billing_day, 15);
  assert.equal(contract.deposit_amount, 250000);
  assert.equal(contract.end_date, "2026-11-30");

  const activePayments = db.prepare(`
    SELECT due_date, amount, status
    FROM payments
    WHERE contract_id = ? AND status != 'cancelled'
    ORDER BY due_date ASC
  `).all(created.id) as any[];
  assert.deepEqual(activePayments.map(payment => payment.due_date), ["2026-09-15", "2026-10-15", "2026-11-15"]);
  assert(activePayments.every(payment => payment.amount === 120000 && payment.status === "pending"));

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'contract.updated' AND entity_type = 'contract' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(created.id)) as any;
  assert(auditEvent);
  const metadata = JSON.parse(auditEvent.metadata);
  assert.equal(metadata.reason, "Ajuste de tarifa y vigencia acordado con cliente");
  assert.equal(metadata.changes.monthly_fee.next, 120000);

  db.prepare("UPDATE payments SET status = 'paid', payment_date = '2026-09-14', method = 'transfer' WHERE contract_id = ? AND due_date = ?").run(created.id, "2026-09-15");
  const blockedEditRes = await fetch(`${baseUrl}/api/contracts/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      billing_day: 20,
      reason: "Intento de mover vencimientos ya pagados",
    }),
  });
  assert.equal(blockedEditRes.status, 400);

  const blockedSameDateRes = await fetch(`${baseUrl}/api/contracts/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      monthly_fee: 130000,
      reason: "Intento de cambiar tarifa con cuota futura pagada",
    }),
  });
  assert.equal(blockedSameDateRes.status, 400);
});

test("blocks contract edits and termination when future receivables are allocated or invoiced", async () => {
  const cookie = await login();

  const allocatedSpace = db.prepare("INSERT INTO spaces (name, type, status, price) VALUES (?, 'parking', 'available', ?)").run("Sprint 2 Bloqueo Abono", 88000);
  const invoicedSpace = db.prepare("INSERT INTO spaces (name, type, status, price) VALUES (?, 'parking', 'available', ?)").run("Sprint 2 Bloqueo Factura", 91000);

  const allocatedCreateRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: allocatedSpace.lastInsertRowid,
      start_date: "2026-10-01",
      end_date: "2026-12-31",
      monthly_fee: 88000,
      billing_day: 10,
    }),
  });
  const allocatedCreated = await allocatedCreateRes.json();
  assert.equal(allocatedCreateRes.status, 200);
  const allocatedPayment = db.prepare("SELECT id FROM payments WHERE contract_id = ? AND due_date = ?").get(allocatedCreated.id, "2026-10-10") as any;
  const movement = db.prepare("INSERT INTO bank_movements (date, description, rut, amount, status) VALUES (?, ?, ?, ?, ?)").run("2026-10-09", "ABONO BLOQUEADO", "12.345.678-9", 10000, "partial");
  db.prepare("INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note) VALUES (?, ?, ?, ?)").run(allocatedPayment.id, movement.lastInsertRowid, 10000, "Abono bloqueante");

  const allocatedEditRes = await fetch(`${baseUrl}/api/contracts/${allocatedCreated.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      monthly_fee: 99000,
      reason: "Intento de cambiar tarifa con abono conciliado",
    }),
  });
  assert.equal(allocatedEditRes.status, 400);

  const allocatedTerminateRes = await fetch(`${baseUrl}/api/contracts/${allocatedCreated.id}/terminate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      reason: "Intento de termino con abono conciliado",
      effective_date: "2026-09-30",
    }),
  });
  const allocatedTerminateBody = await allocatedTerminateRes.json();
  assert.equal(allocatedTerminateRes.status, 400);
  assert.match(allocatedTerminateBody.error, /cobros futuros/);

  const invoicedCreateRes = await fetch(`${baseUrl}/api/contracts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      client_id: 1,
      space_id: invoicedSpace.lastInsertRowid,
      start_date: "2026-11-01",
      end_date: "2026-12-31",
      monthly_fee: 91000,
      billing_day: 5,
    }),
  });
  const invoicedCreated = await invoicedCreateRes.json();
  assert.equal(invoicedCreateRes.status, 200);
  const invoicedPayment = db.prepare("SELECT id FROM payments WHERE contract_id = ? AND due_date = ?").get(invoicedCreated.id, "2026-11-05") as any;
  db.prepare(`
    INSERT INTO invoices (folio, type, client_id, contract_id, payment_id, amount, status_sii)
    VALUES (?, 'boleta', 1, ?, ?, 91000, 'pending')
  `).run(990001, invoicedCreated.id, invoicedPayment.id);

  const invoicedEditRes = await fetch(`${baseUrl}/api/contracts/${invoicedCreated.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      end_date: "2026-11-04",
      reason: "Intento de eliminar vencimiento facturado",
    }),
  });
  assert.equal(invoicedEditRes.status, 400);

  const invoicedTerminateRes = await fetch(`${baseUrl}/api/contracts/${invoicedCreated.id}/terminate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      reason: "Intento de termino con cobro facturado",
      effective_date: "2026-10-31",
    }),
  });
  const invoicedTerminateBody = await invoicedTerminateRes.json();
  assert.equal(invoicedTerminateRes.status, 400);
  assert.match(invoicedTerminateBody.error, /cobros futuros/);
});

test("registering a payment marks it paid and generates an invoice", async () => {
  const cookie = await login();

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const payments = await paymentsRes.json();
  const payment = payments.find((item: any) => item.contract_id === 1 && ["pending", "overdue"].includes(item.status) && item.due_date === "2026-03-05");
  assert(payment);

  const beforeInvoicesRes = await fetch(`${baseUrl}/api/finance/invoices`, {
    headers: { Cookie: cookie },
  });
  const beforeInvoices = await beforeInvoicesRes.json();

  const missingNoteRes = await fetch(`${baseUrl}/api/finance/payments/${payment.id}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      method: "transfer",
      payment_date: "2026-05-12",
      reference: "OP-12345",
    }),
  });
  assert.equal(missingNoteRes.status, 400);

  const registerRes = await fetch(`${baseUrl}/api/finance/payments/${payment.id}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      method: "transfer",
      payment_date: "2026-05-12",
      reference: "OP-12345",
      note: "Pago validado contra comprobante",
      receipt: {
        fileName: "comprobante.pdf",
        mimeType: "application/pdf",
        dataBase64: Buffer.from("%PDF-1.4 test").toString("base64"),
      },
    }),
  });
  const registerBody = await registerRes.json();
  assert.equal(registerRes.status, 200);
  assert.equal(typeof registerBody.folio, "number");

  const updatedPaymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const updatedPayments = await updatedPaymentsRes.json();
  const updatedPayment = updatedPayments.find((item: any) => item.id === payment.id);
  assert.equal(updatedPayment.status, "paid");
  assert.equal(updatedPayment.reference, "OP-12345");
  assert.equal(updatedPayment.receipt_file_name, "comprobante.pdf");
  assert.equal(updatedPayment.receipt_mime_type, "application/pdf");
  assert(updatedPayment.receipt_file_path);
  assert(existsSync(join(process.env.PARKIA_STORAGE_PATH!, updatedPayment.receipt_file_path)));

  const receiptRes = await fetch(`${baseUrl}/api/finance/payments/${payment.id}/receipt`, {
    headers: { Cookie: cookie },
  });
  assert.equal(receiptRes.status, 200);
  assert.match(receiptRes.headers.get("content-type") || "", /application\/pdf/);

  const afterInvoicesRes = await fetch(`${baseUrl}/api/finance/invoices`, {
    headers: { Cookie: cookie },
  });
  const afterInvoices = await afterInvoicesRes.json();
  assert.equal(afterInvoices.length, beforeInvoices.length + 1);
  const createdInvoice = afterInvoices.find((invoice: any) => invoice.folio === registerBody.folio);
  assert.equal(createdInvoice.status_sii, "pending");
  assert.equal(createdInvoice.type, "boleta");
  assert.equal(createdInvoice.payment_id, payment.id);

  const notReadyRes = await fetch(`${baseUrl}/api/finance/invoices/readiness`, {
    headers: { Cookie: cookie },
  });
  const notReady = await notReadyRes.json();
  assert.equal(notReadyRes.status, 200);
  assert.equal(notReady.ready, false);
  assert(notReady.checks.some((check: any) => check.key === "company_address" && check.ok === false));

  const configRes = await fetch(`${baseUrl}/api/config`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      company_address: "Av. Tributaria 123, Santiago",
      sii_mode: "mock",
      sii_provider: "local_mock",
      sii_environment: "demo",
    }),
  });
  assert.equal(configRes.status, 200);

  const issueRes = await fetch(`${baseUrl}/api/finance/invoices/${createdInvoice.id}/issue`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const issueBody = await issueRes.json();
  assert.equal(issueRes.status, 200);
  assert.equal(issueBody.status, "accepted");
  assert.match(issueBody.trackId, /^MOCK-/);

  const issuedInvoice = db.prepare("SELECT * FROM invoices WHERE id = ?").get(createdInvoice.id) as any;
  assert.equal(issuedInvoice.status_sii, "accepted");
  assert.equal(issuedInvoice.provider, "local_mock");
  const storedPdf = Buffer.from(issuedInvoice.pdf_content, "base64");
  assert.equal(storedPdf.subarray(0, 5).toString("latin1"), "%PDF-");
  assert(issuedInvoice.xml_content.includes("<dteMock>"));

  const pdfRes = await fetch(`${baseUrl}/api/finance/invoices/${createdInvoice.id}/pdf`, {
    headers: { Cookie: cookie },
  });
  assert.equal(pdfRes.status, 200);
  assert.match(pdfRes.headers.get("content-type") || "", /application\/pdf/);
  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  assert.equal(pdfBuffer.subarray(0, 5).toString("latin1"), "%PDF-");

  const duplicateRes = await fetch(`${baseUrl}/api/finance/payments/${payment.id}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ method: "cash", payment_date: "2026-05-12", note: "Intento duplicado" }),
  });
  assert.equal(duplicateRes.status, 400);
});

test("blocks issuing SII mock invoices in production", async () => {
  const cookie = await login();
  const previousNodeEnv = process.env.NODE_ENV;
  const originalConfig = db.prepare("SELECT company_address, sii_mode, sii_provider FROM system_config WHERE id = 1").get() as any;

  try {
    const paymentInsert = db.prepare(`
      INSERT INTO payments (contract_id, amount, due_date, status)
      VALUES (?, ?, ?, ?)
    `).run(1, 51000, "2026-06-20", "pending");

    const registerRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        method: "transfer",
        payment_date: "2026-06-20",
        reference: "PROD-MOCK",
        note: "Pago validado para prueba de bloqueo mock",
      }),
    });
    const registerBody = await registerRes.json();
    assert.equal(registerRes.status, 200);

    const invoice = db.prepare("SELECT * FROM invoices WHERE folio = ?").get(registerBody.folio) as any;
    assert(invoice);

    process.env.NODE_ENV = "production";
    db.prepare(`
      UPDATE system_config
      SET company_address = ?, sii_mode = 'mock', sii_provider = 'local_mock'
      WHERE id = 1
    `).run("Av. Tributaria 123, Santiago");

    const issueRes = await fetch(`${baseUrl}/api/finance/invoices/${invoice.id}/issue`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const issueBody = await issueRes.json();

    assert.equal(issueRes.status, 400);
    assert.match(issueBody.error, /mock/);
  } finally {
    restoreEnv("NODE_ENV", previousNodeEnv);
    db.prepare("UPDATE system_config SET company_address = ?, sii_mode = ?, sii_provider = ? WHERE id = 1")
      .run(originalConfig.company_address, originalConfig.sii_mode, originalConfig.sii_provider);
  }
});

test("blocks SII real provider mode until an external provider is implemented", async () => {
  const cookie = await login();
  const originalConfig = db.prepare(`
    SELECT company_name, company_rut, company_address, sii_mode, sii_provider, sii_environment
    FROM system_config
    WHERE id = 1
  `).get() as any;

  try {
    db.prepare(`
      UPDATE system_config
      SET company_name = ?,
          company_rut = ?,
          company_address = ?,
          sii_mode = 'real',
          sii_provider = 'external_provider',
          sii_environment = 'production'
      WHERE id = 1
    `).run("Parkia SpA", "76.123.456-7", "Av. Tributaria 123, Santiago");

    const invoiceInsert = db.prepare(`
      INSERT INTO invoices (folio, type, client_id, amount, status_sii)
      VALUES (?, 'boleta', 1, 52000, 'pending')
    `).run(990101);

    const readinessRes = await fetch(`${baseUrl}/api/finance/invoices/readiness`, {
      headers: { Cookie: cookie },
    });
    const readiness = await readinessRes.json();
    assert.equal(readinessRes.status, 200);
    assert.equal(readiness.mode, "real");
    assert.equal(readiness.provider, "external_provider");
    assert.equal(readiness.ready, false);
    assert(readiness.checks.some((check: any) => check.key === "sii_real_provider_implemented" && check.ok === false));

    const issueRes = await fetch(`${baseUrl}/api/finance/invoices/${invoiceInsert.lastInsertRowid}/issue`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const issueBody = await issueRes.json();
    assert.equal(issueRes.status, 400);
    assert.match(issueBody.error, /Proveedor SII real no implementado/);

    const syncRes = await fetch(`${baseUrl}/api/finance/invoices/${invoiceInsert.lastInsertRowid}/sync`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    const syncBody = await syncRes.json();
    assert.equal(syncRes.status, 400);
    assert.match(syncBody.error, /Proveedor SII real no implementado/);

    const invoice = db.prepare("SELECT status_sii, track_id, provider FROM invoices WHERE id = ?").get(invoiceInsert.lastInsertRowid) as any;
    assert.equal(invoice.status_sii, "pending");
    assert.equal(invoice.track_id, null);
  } finally {
    db.prepare(`
      UPDATE system_config
      SET company_name = ?,
          company_rut = ?,
          company_address = ?,
          sii_mode = ?,
          sii_provider = ?,
          sii_environment = ?
      WHERE id = 1
    `).run(
      originalConfig.company_name,
      originalConfig.company_rut,
      originalConfig.company_address,
      originalConfig.sii_mode,
      originalConfig.sii_provider,
      originalConfig.sii_environment
    );
  }
});

test("serves receivable detail and records financial adjustments with reasons", async () => {
  const cookie = await login();
  const financeCookie = await login("finance@parkia.local", "Cambiar123!");
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 80000, "2026-06-15", "pending");

  const missingReasonRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ type: "discount", amount: 5000 }),
  });
  assert.equal(missingReasonRes.status, 400);

  const financeAdjustmentRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: financeCookie,
    },
    body: JSON.stringify({
      type: "discount",
      amount: 5000,
      reason: "Solicitud desde finanzas sin autorizacion admin",
    }),
  });
  assert.equal(financeAdjustmentRes.status, 403);

  const adjustmentRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      type: "discount",
      amount: 5000,
      reason: "Descuento autorizado por ajuste comercial documentado",
    }),
  });
  const adjustment = await adjustmentRes.json();
  assert.equal(adjustmentRes.status, 200);
  assert.equal(adjustment.adjustment.previousAmount, 80000);
  assert.equal(adjustment.adjustment.newAmount, 75000);

  const feeRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/adjustments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      type: "fee",
      amount: 2500,
      reason: "Multa por atraso segun contrato",
    }),
  });
  assert.equal(feeRes.status, 200);

  const detailRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/detail`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.payment.amount, 77500);
  assert.equal(detail.adjustments.length, 2);
  assert.equal(detail.meta.formulas.remaining_amount, "0 si status paid/cancelled; si no, MAX(payment.amount - allocated_amount, 0)");
  assert.equal(typeof detail.meta.cutOffDate, "string");

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'payment.adjusted' AND entity_type = 'payment' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(paymentInsert.lastInsertRowid)) as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).reason, "Multa por atraso segun contrato");
});

test("manually reconciles a bank movement with a pending payment", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 12345, "2026-06-05", "pending");
  const movementInsert = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status)
    VALUES (?, ?, ?, ?, ?)
  `).run("2026-06-04", "TRANSFERENCIA MANUAL", "12.345.678-9", 12345, "pending");

  const missingNoteRes = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/reconcile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
    }),
  });
  assert.equal(missingNoteRes.status, 400);

  const res = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/reconcile`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      note: "Prueba conciliación",
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(typeof body.folio, "number");

  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentInsert.lastInsertRowid) as any;
  assert.equal(payment.status, "paid");
  assert.equal(payment.method, "transfer");
  assert.equal(payment.payment_date, "2026-06-04");
  assert.match(payment.reference, /Cartola bancaria/);

  const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementInsert.lastInsertRowid) as any;
  assert.equal(movement.status, "reconciled");

  const allocation = db.prepare(`
    SELECT * FROM payment_allocations
    WHERE payment_id = ? AND bank_movement_id = ?
  `).get(paymentInsert.lastInsertRowid, movementInsert.lastInsertRowid) as any;
  assert(allocation);
  assert.equal(allocation.amount, 12345);

  const invoice = db.prepare("SELECT * FROM invoices WHERE folio = ?").get(body.folio) as any;
  assert(invoice);
  assert.equal(invoice.amount, 12345);
  assert.equal(invoice.status_sii, "pending");

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movement.reconciled' AND entity_type = 'bank_movement' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(movementInsert.lastInsertRowid)) as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).payment_id, Number(paymentInsert.lastInsertRowid));
});

test("imports bank movements from CSV and skips duplicates", async () => {
  const cookie = await login();
  const csv = [
    "Fecha,Glosa,RUT,Monto,Estado,Notas",
    "05/06/2026,TRANSFERENCIA CSV,12.345.678-9,12.345,Pendiente,Exportado y reimportado",
    "2026-06-06,ABONO CSV,76.543.210-K,85000,Pendiente,Exportado y reimportado",
    "sin-fecha,FILA INVALIDA,99.999.999-9,1000,Pendiente,Sin fecha",
  ].join("\n");

  const importBody = {
    fileName: "cartola.csv",
    dataBase64: Buffer.from(csv, "utf8").toString("base64"),
  };

  const importRes = await fetch(`${baseUrl}/api/finance/bank-movements/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(importBody),
  });
  const importResult = await importRes.json();
  assert.equal(importRes.status, 200);
  assert.equal(importResult.imported, 2);
  assert.equal(importResult.duplicated, 0);
  assert.equal(importResult.skipped, 1);

  const duplicateRes = await fetch(`${baseUrl}/api/finance/bank-movements/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(importBody),
  });
  const duplicateResult = await duplicateRes.json();
  assert.equal(duplicateRes.status, 200);
  assert.equal(duplicateResult.imported, 0);
  assert.equal(duplicateResult.duplicated, 2);
  assert.equal(duplicateResult.skipped, 1);

  const movement = db.prepare(`
    SELECT * FROM bank_movements
    WHERE date = '2026-06-05' AND description = 'TRANSFERENCIA CSV'
  `).get() as any;
  assert(movement);
  assert.equal(movement.amount, 12345);

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movements.imported' AND entity_type = 'bank_movement'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).file_name, "cartola.csv");
});

test("keeps unmatched bank movements editable after automatic sync", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 22222, "2026-06-10", "pending");
  const matchedMovement = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status)
    VALUES (?, ?, ?, ?, ?)
  `).run("2026-06-10", "MATCH AUTOMATICO", "12.345.678-9", 22222, "pending");
  const unmatchedMovement = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status)
    VALUES (?, ?, ?, ?, ?)
  `).run("2026-06-11", "SIN MATCH AUTOMATICO", "99.999.999-9", 33333, "pending");

  const syncRes = await fetch(`${baseUrl}/api/finance/sync-bank`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const syncBody = await syncRes.json();
  assert.equal(syncRes.status, 200);
  assert.equal(syncBody.mode, "imported_movements_only");
  assert.equal(syncBody.provider_connected, false);
  assert.match(syncBody.message, /movimientos importados/);
  assert(syncBody.count >= 1);
  assert(syncBody.unmatched >= 1);

  const paidPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentInsert.lastInsertRowid) as any;
  assert.equal(paidPayment.status, "paid");

  const reconciled = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(matchedMovement.lastInsertRowid) as any;
  assert.equal(reconciled.status, "reconciled");

  const pending = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(unmatchedMovement.lastInsertRowid) as any;
  assert.equal(pending.status, "pending");
  assert.equal(pending.notes, "Sin coincidencia automática. Revisar manualmente.");

  const updateRes = await fetch(`${baseUrl}/api/finance/bank-movements/${unmatchedMovement.lastInsertRowid}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      date: "2026-06-12",
      description: "SIN MATCH EDITADO",
      rut: "11.111.111-1",
      amount: 44444,
      notes: "Revisar con administración",
    }),
  });
  assert.equal(updateRes.status, 200);

  const edited = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(unmatchedMovement.lastInsertRowid) as any;
  assert.equal(edited.date, "2026-06-12");
  assert.equal(edited.description, "SIN MATCH EDITADO");
  assert.equal(edited.rut, "11.111.111-1");
  assert.equal(edited.amount, 44444);
  assert.equal(edited.notes, "Revisar con administración");

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movement.updated' AND entity_type = 'bank_movement' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(unmatchedMovement.lastInsertRowid)) as any;
  assert(auditEvent);

  const autoReconcileEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movements.imported_auto_reconciled'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(autoReconcileEvent);
  assert.equal(JSON.parse(autoReconcileEvent.metadata).provider_connected, false);
});

test("suggests candidate payments for pending bank movements", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 99999, "2026-06-25", "pending");
  const movementInsert = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-06-25", "TRANSFERENCIA JUAN PEREZ", "12.345.678-9", 99999, "pending", "Revisar sugerencia");

  const res = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/suggestions`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.movement_id, Number(movementInsert.lastInsertRowid));
  assert(body.suggestions.length > 0);
  assert.equal(body.suggestions[0].payment_id, Number(paymentInsert.lastInsertRowid));
  assert(body.suggestions[0].score >= 90);
  assert(body.suggestions[0].reasons.includes("Monto exacto"));
  assert(body.suggestions[0].reasons.includes("RUT coincidente"));
});

test("exports bank movement reconciliation queue as CSV", async () => {
  const cookie = await login();
  db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-06-30", "PENDIENTE EXPORT CSV", "66.666.666-6", 55555, "pending", "Revisar con finanzas");

  const csvRes = await fetch(`${baseUrl}/api/finance/export/bank-movements.csv?status=pending`, {
    headers: { Cookie: cookie },
  });
  const csv = await csvRes.text();
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get("content-type") || "", /text\/csv/);
  assert(csv.startsWith("ID,Fecha,Glosa,RUT,Monto,Estado,Notas"));
  assert.match(csv, /PENDIENTE EXPORT CSV/);
  assert.match(csv, /Revisar con finanzas/);

  const xlsxRes = await fetch(`${baseUrl}/api/finance/export/bank-movements.xlsx?status=pending`, {
    headers: { Cookie: cookie },
  });
  assert.equal(xlsxRes.status, 200);
  assert.match(xlsxRes.headers.get("content-type") || "", /spreadsheetml/);
  const workbook = await readXlsxWorkbook(xlsxRes);
  const sheet = workbook.getWorksheet("Cartola bancaria");
  assert(sheet);
  assert.deepEqual((sheet.getRow(1).values as any[]).slice(1, 8), ["ID", "Fecha", "Glosa", "RUT", "Monto", "Estado", "Notas"]);
  const exportedRow = sheet.getRows(2, sheet.rowCount - 1)?.find(row => row.getCell(3).value === "PENDIENTE EXPORT CSV");
  assert(exportedRow);
  assert.equal(exportedRow.getCell(6).value, "Pendiente");

  const invalidRes = await fetch(`${baseUrl}/api/finance/export/bank-movements.csv?status=bad`, {
    headers: { Cookie: cookie },
  });
  assert.equal(invalidRes.status, 400);
});

test("marks unmatched bank movements as partial with audit trail", async () => {
  const cookie = await login();
  const movementInsert = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-07-01", "PAGO PARCIAL", "77.777.777-7", 12000, "pending", "Sin match");

  const res = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/mark-partial`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ note: "Pago parcial informado por administración" }),
  });
  assert.equal(res.status, 200);

  const movement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementInsert.lastInsertRowid) as any;
  assert.equal(movement.status, "partial");
  assert.equal(movement.notes, "Pago parcial informado por administración");

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movement.marked_partial' AND entity_type = 'bank_movement' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(movementInsert.lastInsertRowid)) as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).note, "Pago parcial informado por administración");
});

test("allocates bank movement amounts to partially pay receivables", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 50000, "2026-07-05", "pending");
  const firstMovement = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-07-05", "ABONO PARCIAL 1", "12.345.678-9", 20000, "pending", "Primer abono");
  const secondMovement = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-07-06", "ABONO PARCIAL 2", "12.345.678-9", 30000, "pending", "Segundo abono");

  const missingNoteRes = await fetch(`${baseUrl}/api/finance/bank-movements/${firstMovement.lastInsertRowid}/allocate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      amount: 20000,
    }),
  });
  assert.equal(missingNoteRes.status, 400);

  const firstRes = await fetch(`${baseUrl}/api/finance/bank-movements/${firstMovement.lastInsertRowid}/allocate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      amount: 20000,
      note: "Primer abono validado",
    }),
  });
  const firstBody = await firstRes.json();
  assert.equal(firstRes.status, 200);
  assert.equal(firstBody.paymentFullyPaid, false);
  assert.equal(firstBody.paymentRemaining, 30000);

  const partialPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentInsert.lastInsertRowid) as any;
  assert.equal(partialPayment.status, "pending");

  const secondRes = await fetch(`${baseUrl}/api/finance/bank-movements/${secondMovement.lastInsertRowid}/allocate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      amount: 30000,
      note: "Segundo abono completa pago",
    }),
  });
  const secondBody = await secondRes.json();
  assert.equal(secondRes.status, 200);
  assert.equal(secondBody.paymentFullyPaid, true);
  assert.equal(typeof secondBody.folio, "number");

  const paidPayment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentInsert.lastInsertRowid) as any;
  assert.equal(paidPayment.status, "paid");
  assert.equal(paidPayment.method, "transfer");

  const allocations = db.prepare("SELECT SUM(amount) as total FROM payment_allocations WHERE payment_id = ?").get(paymentInsert.lastInsertRowid) as any;
  assert.equal(allocations.total, 50000);

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const payments = await paymentsRes.json();
  const listedPayment = payments.find((item: any) => item.id === Number(paymentInsert.lastInsertRowid));
  assert.equal(listedPayment.allocated_amount, 50000);
  assert.equal(listedPayment.remaining_amount, 0);

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'bank_movement.allocated' AND entity_type = 'bank_movement'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(auditEvent);
  assert.equal(JSON.parse(auditEvent.metadata).paymentFullyPaid, true);
});

test("manual payment after partial allocations clears remaining balance", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 60000, "2026-07-08", "pending");
  const movementInsert = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-07-08", "ABONO PARCIAL ANTES DE CAJA", "12.345.678-9", 25000, "pending", "Abono parcial");

  const allocateRes = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/allocate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      amount: 25000,
      note: "Abono parcial validado",
    }),
  });
  assert.equal(allocateRes.status, 200);

  const registerRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      method: "cash",
      payment_date: "2026-07-09",
      reference: "Caja saldo restante",
      note: "Saldo restante pagado manualmente",
    }),
  });
  const registerBody = await registerRes.json();
  assert.equal(registerRes.status, 200);
  assert.equal(registerBody.paidAmount, 35000);
  assert.equal(registerBody.allocatedAmount, 25000);

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const payments = await paymentsRes.json();
  const listedPayment = payments.find((item: any) => item.id === Number(paymentInsert.lastInsertRowid));
  assert.equal(listedPayment.status, "paid");
  assert.equal(listedPayment.allocated_amount, 25000);
  assert.equal(listedPayment.remaining_amount, 0);

  const detailRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/detail`, {
    headers: { Cookie: cookie },
  });
  const detail = await detailRes.json();
  assert.equal(detailRes.status, 200);
  assert.equal(detail.payment.remaining_amount, 0);
});

test("serves payment allocation history by payment and bank movement", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 42000, "2026-07-10", "pending");
  const movementInsert = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-07-10", "TRANSFERENCIA HISTORIAL", "12.345.678-9", 42000, "pending", "Abono para trazabilidad");

  const allocateRes = await fetch(`${baseUrl}/api/finance/bank-movements/${movementInsert.lastInsertRowid}/allocate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_id: paymentInsert.lastInsertRowid,
      amount: 42000,
      note: "Abono visible en historial",
    }),
  });
  assert.equal(allocateRes.status, 200);

  const byPaymentRes = await fetch(`${baseUrl}/api/finance/payment-allocations?payment_id=${paymentInsert.lastInsertRowid}`, {
    headers: { Cookie: cookie },
  });
  const byPayment = await byPaymentRes.json();
  assert.equal(byPaymentRes.status, 200);
  assert.equal(byPayment.length, 1);
  assert.equal(byPayment[0].amount, 42000);
  assert.equal(byPayment[0].note, "Abono visible en historial");
  assert.equal(byPayment[0].bank_movement_id, Number(movementInsert.lastInsertRowid));
  assert.equal(byPayment[0].movement_description, "TRANSFERENCIA HISTORIAL");
  assert.equal(byPayment[0].client_name, "Juan Perez");

  const byMovementRes = await fetch(`${baseUrl}/api/finance/payment-allocations?bank_movement_id=${movementInsert.lastInsertRowid}`, {
    headers: { Cookie: cookie },
  });
  const byMovement = await byMovementRes.json();
  assert.equal(byMovementRes.status, 200);
  assert.equal(byMovement.length, 1);
  assert.equal(byMovement[0].payment_id, Number(paymentInsert.lastInsertRowid));

  const reverseRes = await fetch(`${baseUrl}/api/finance/payment-allocations/${byPayment[0].id}/reverse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ note: "Conciliación aplicada por error" }),
  });
  const reverseBody = await reverseRes.json();
  assert.equal(reverseRes.status, 200);
  assert.equal(reverseBody.payment.status, "pending");
  assert.equal(reverseBody.movement.status, "pending");

  const reversedHistoryRes = await fetch(`${baseUrl}/api/finance/payment-allocations?payment_id=${paymentInsert.lastInsertRowid}`, {
    headers: { Cookie: cookie },
  });
  const reversedHistory = await reversedHistoryRes.json();
  assert.equal(reversedHistory.length, 1);
  assert(reversedHistory[0].reversed_at);
  assert.equal(reversedHistory[0].reversed_note, "Conciliación aplicada por error");

  const listedPaymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const listedPayments = await listedPaymentsRes.json();
  const listedPayment = listedPayments.find((item: any) => item.id === Number(paymentInsert.lastInsertRowid));
  assert.equal(listedPayment.status, "pending");
  assert.equal(listedPayment.allocated_amount, 0);
  assert.equal(listedPayment.remaining_amount, 42000);
});

test("tracks collection actions for pending receivables", async () => {
  const cookie = await login();
  const paymentInsert = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 61000, "2026-07-15", "pending");

  const createRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/collection-actions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      channel: "whatsapp",
      note: "Cliente confirma pago para el viernes",
      next_action_at: "2026-07-17",
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(typeof created.id, "number");

  const listRes = await fetch(`${baseUrl}/api/finance/payments/${paymentInsert.lastInsertRowid}/collection-actions`, {
    headers: { Cookie: cookie },
  });
  const actions = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].channel, "whatsapp");
  assert.equal(actions[0].status, "open");
  assert.equal(actions[0].next_action_at, "2026-07-17");
  assert.equal(actions[0].staff_name, "Admin Parkia");

  const paymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  const payments = await paymentsRes.json();
  const listedPayment = payments.find((item: any) => item.id === Number(paymentInsert.lastInsertRowid));
  assert.equal(listedPayment.open_collection_actions_count, 1);
  assert.equal(listedPayment.next_collection_action_at, "2026-07-17");
  assert.equal(listedPayment.latest_collection_note, "Cliente confirma pago para el viernes");

  const queueRes = await fetch(`${baseUrl}/api/finance/collection-actions?status=open&due=upcoming`, {
    headers: { Cookie: cookie },
  });
  const queue = await queueRes.json();
  assert.equal(queueRes.status, 200);
  assert(queue.some((item: any) => item.id === created.id));
  const queueItem = queue.find((item: any) => item.id === created.id);
  assert.equal(queueItem.client_name, "Juan Perez");
  assert.equal(queueItem.payment_remaining_amount, 61000);

  const completeRes = await fetch(`${baseUrl}/api/finance/collection-actions/${created.id}/complete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ note: "Cliente pagó por transferencia" }),
  });
  assert.equal(completeRes.status, 200);

  const completed = db.prepare("SELECT * FROM collection_actions WHERE id = ?").get(created.id) as any;
  assert.equal(completed.status, "done");
  assert.equal(completed.completed_note, "Cliente pagó por transferencia");
});

test("serves finance reports and payment CSV exports", async () => {
  const cookie = await login();

  const budgetRes = await fetch(`${baseUrl}/api/finance/budgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      month: "2026-05",
      category: "maintenance",
      planned_amount: 150000,
      notes: "Mantenciones programadas",
    }),
  });
  assert.equal(budgetRes.status, 200);
  const configRes = await fetch(`${baseUrl}/api/config`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ overdue_recovery_rate: 50 }),
  });
  assert.equal(configRes.status, 200);

  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-05-18", "maintenance", "Proveedor Presupuesto", "MantenciÃ³n presupuestada", 50000, "pending");

  db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, description, amount_total, payment_status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("2026-05-20", "maintenance", "Proveedor Flujo", "Salida proyectada", 40000, "pending", "2026-05-25");
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 70000, "2026-05-24", "pending");
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 100000, "2026-05-10", "overdue");
  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status, method, payment_date, reference)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(1, 33000, "2026-05-18", "paid", "cash", "2026-05-18", "Caja sin respaldo");
  db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-05-22", "CIERRE PENDIENTE", "11.111.111-1", 1234, "pending", "Pendiente cierre");

  const collectionsRes = await fetch(`${baseUrl}/api/finance/reports/collections`, {
    headers: { Cookie: cookie },
  });
  const collections = await collectionsRes.json();
  assert.equal(collectionsRes.status, 200);
  assert.equal(typeof collections.totalCollected, "number");
  assert(Array.isArray(collections.byMethod));

  const delinquencyRes = await fetch(`${baseUrl}/api/finance/reports/delinquency`, {
    headers: { Cookie: cookie },
  });
  const delinquency = await delinquencyRes.json();
  assert.equal(delinquencyRes.status, 200);
  assert.equal(typeof delinquency.totalOverdue, "number");
  assert(Array.isArray(delinquency.rows));

  const budgetReportRes = await fetch(`${baseUrl}/api/finance/reports/budget?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const budgetReport = await budgetReportRes.json();
  assert.equal(budgetReportRes.status, 200);
  assert.equal(budgetReport.plannedTotal, 150000);
  assert(budgetReport.actualTotal >= 50000);
  assert.equal(typeof budgetReport.meta.formulas.varianceTotal, "string");
  assert(budgetReport.rows.some((row: any) => row.category === "maintenance" && row.plannedAmount === 150000));

  const cashFlowRes = await fetch(`${baseUrl}/api/finance/reports/cash-flow?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const cashFlow = await cashFlowRes.json();
  assert.equal(cashFlowRes.status, 200);
  assert.equal(cashFlow.month, "2026-05");
  assert.equal(cashFlow.overdueRecoveryRate, 50);
  assert.equal(typeof cashFlow.meta.formulas.projectedClosingBalance, "string");
  assert(Array.isArray(cashFlow.buckets));
  assert(cashFlow.expectedInflowTotal >= 85000);
  assert(cashFlow.overdueNominalInflowTotal >= 100000);
  assert(cashFlow.overdueRecoverableInflowTotal >= 50000);
  assert(cashFlow.scheduledOutflowTotal >= 40000);
  assert.equal(typeof cashFlow.projectedClosingBalance, "number");

  const csvRes = await fetch(`${baseUrl}/api/finance/export/payments.csv?status=overdue`, {
    headers: { Cookie: cookie },
  });
  const csv = await csvRes.text();
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get("content-type") || "", /text\/csv/);
  assert(csv.startsWith("ID,Cliente,Contrato,Monto,Fecha de vencimiento,Fecha de pago,Estado,Método,Referencia"));

  const xlsxRes = await fetch(`${baseUrl}/api/finance/export/payments.xlsx?status=overdue`, {
    headers: { Cookie: cookie },
  });
  assert.equal(xlsxRes.status, 200);
  assert.match(xlsxRes.headers.get("content-type") || "", /spreadsheetml/);
  const workbook = await readXlsxWorkbook(xlsxRes);
  const sheet = workbook.getWorksheet("Cuentas por cobrar");
  assert(sheet);
  assert.deepEqual((sheet.getRow(1).values as any[]).slice(1, 10), ["ID", "Cliente", "Contrato", "Monto", "Fecha de vencimiento", "Fecha de pago", "Estado", "M\u00e9todo", "Referencia"]);
  assert((sheet.getColumn(7).values as any[]).includes("Atrasado"));

  const closeRes = await fetch(`${baseUrl}/api/finance/reports/monthly-close?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const close = await closeRes.json();
  assert.equal(closeRes.status, 200);
  assert.equal(close.month, "2026-05");
  assert.equal(typeof close.cashMargin, "number");
  assert.equal(close.meta.cutOffDate, "2026-05-31");
  assert(Array.isArray(close.collectionsByMethod));
  assert(Array.isArray(close.expensesByCategory));
  assert(Array.isArray(close.receivablesAging.buckets));
  assert(Array.isArray(close.payablesAging.buckets));
  assert(Array.isArray(close.budgetByCategory));
  assert(Array.isArray(close.cashFlowProjection.buckets));
  assert.equal(close.budgetPlannedTotal, 150000);

  const operationalCloseRes = await fetch(`${baseUrl}/api/finance/reports/operational-close?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const operationalClose = await operationalCloseRes.json();
  assert.equal(operationalCloseRes.status, 200);
  assert.equal(operationalClose.month, "2026-05");
  assert.equal(operationalClose.status, "critical");
  assert(Array.isArray(operationalClose.checks));
  assert(operationalClose.checks.some((check: any) => check.id === "bank-pending" && check.count >= 1));
  assert(operationalClose.checks.some((check: any) => check.id === "manual-payments-without-receipt" && check.count >= 1));
  assert.equal(typeof operationalClose.summary.pendingAmount, "number");

  const closeCsvRes = await fetch(`${baseUrl}/api/finance/export/monthly-close.csv?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const closeCsv = await closeCsvRes.text();
  assert.equal(closeCsvRes.status, 200);
  assert(closeCsv.startsWith("Métrica,Valor"));
  assert(closeCsv.includes("Fecha de corte,2026-05-31"));
  assert(closeCsv.includes("Total cuentas por cobrar vencidas"));
  assert(closeCsv.includes("Presupuesto planificado"));
  assert(closeCsv.includes("Saldo final proyectado"));
  assert(closeCsv.includes("Tasa de recuperación de morosidad (%)"));

  const operationalCloseCsvRes = await fetch(`${baseUrl}/api/finance/export/operational-close.csv?month=2026-05`, {
    headers: { Cookie: cookie },
  });
  const operationalCloseCsv = await operationalCloseCsvRes.text();
  assert.equal(operationalCloseCsvRes.status, 200);
  assert.match(operationalCloseCsvRes.headers.get("content-type") || "", /text\/csv/);
  assert(operationalCloseCsv.startsWith("Ítem,Estado,Cantidad,Monto,Mensaje"));
  assert(operationalCloseCsv.includes("Fecha de corte"));
  assert(operationalCloseCsv.includes("Cartola bancaria pendiente"));
  assert(operationalCloseCsv.includes("Pagos manuales sin comprobante"));
});

test("closes finance months with snapshots and soft locks closed periods", async () => {
  const adminCookie = await login();
  await createStaff(adminCookie, "finance", "close.finance@parkia.local", "88.888.888-8");
  const financeCookie = await login("close.finance@parkia.local", "Cambiar123!");

  const deniedCloseRes = await fetch(`${baseUrl}/api/finance/monthly-closures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: financeCookie,
    },
    body: JSON.stringify({
      month: "2026-08",
      accepted_pending_note: "Revisión solicitada por administración",
    }),
  });
  assert.equal(deniedCloseRes.status, 403);

  const closeRes = await fetch(`${baseUrl}/api/finance/monthly-closures`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      month: "2026-08",
      accepted_pending_note: "Pendientes aceptados para prueba de cierre",
    }),
  });
  const closed = await closeRes.json();
  assert.equal(closeRes.status, 200);
  assert.equal(closed.closure.month, "2026-08");
  assert.equal(closed.closure.status, "closed");
  assert.equal(closed.closure.monthly_snapshot.month, "2026-08");
  assert.equal(closed.closure.operational_snapshot.month, "2026-08");

  const lockedExpenseRes = await fetch(`${baseUrl}/api/finance/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      date: "2026-08-15",
      category: "admin",
      supplier_name: "Proveedor Cerrado",
      description: "Gasto en mes cerrado",
      amount_total: 10000,
      payment_status: "pending",
      due_date: "2026-08-20",
    }),
  });
  const lockedExpense = await lockedExpenseRes.json();
  assert.equal(lockedExpenseRes.status, 400);
  assert.match(lockedExpense.error, /2026-08.*cerrado/);

  const lockedBudgetRes = await fetch(`${baseUrl}/api/finance/budgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      month: "2026-08",
      category: "admin",
      planned_amount: 90000,
      notes: "No debe guardar cerrado",
    }),
  });
  assert.equal(lockedBudgetRes.status, 400);

  const reopenRes = await fetch(`${baseUrl}/api/finance/monthly-closures/2026-08/reopen`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({ reason: "Corrección posterior al cierre" }),
  });
  const reopened = await reopenRes.json();
  assert.equal(reopenRes.status, 200);
  assert.equal(reopened.closure.status, "reopened");
  assert.equal(typeof reopened.notificationTaskId, "number");

  const reopenedBudgetRes = await fetch(`${baseUrl}/api/finance/budgets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: adminCookie,
    },
    body: JSON.stringify({
      month: "2026-08",
      category: "admin",
      planned_amount: 90000,
      notes: "Presupuesto tras reapertura",
    }),
  });
  assert.equal(reopenedBudgetRes.status, 200);

  const closeEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'finance_month.closed' AND entity_id = '2026-08'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(closeEvent);
  assert.equal(JSON.parse(closeEvent.metadata).month, "2026-08");
});

test("manages expenses with receipts and profitability reporting", async () => {
  const cookie = await login();
  const createPaidRes = await fetch(`${baseUrl}/api/finance/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      date: "2026-07-19",
      category: "maintenance",
      supplier_name: "Proveedor Sin Aprobacion",
      description: "Intento de gasto pagado sin aprobacion",
      amount_total: 25000,
      document_type: "invoice",
      payment_status: "paid",
      paid_at: "2026-07-19",
      payment_method: "transfer",
    }),
  });
  assert.equal(createPaidRes.status, 400);

  const createRes = await fetch(`${baseUrl}/api/finance/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      date: "2026-07-20",
      category: "maintenance",
      cost_center: "maintenance",
      supplier_name: "Proveedor Mantención",
      supplier_rut: "76.111.222-3",
      description: "Mantención portón principal",
      amount_net: 100000,
      tax_amount: 19000,
      amount_total: 119000,
      document_type: "invoice",
      document_number: "F-123",
      payment_status: "pending",
      due_date: "2026-07-30",
      payment_method: "transfer",
      receipt: {
        fileName: "factura.pdf",
        mimeType: "application/pdf",
        dataBase64: Buffer.from("%PDF gasto test").toString("base64"),
      },
    }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 200);
  assert.equal(typeof created.id, "number");

  const listRes = await fetch(`${baseUrl}/api/finance/expenses?status=pending&category=maintenance`, {
    headers: { Cookie: cookie },
  });
  const expenses = await listRes.json();
  assert.equal(listRes.status, 200);
  const expense = expenses.find((item: any) => item.id === created.id);
  assert(expense);
  assert.equal(expense.amount_total, 119000);
  assert.equal(expense.cost_center, "maintenance");
  assert.equal(expense.approval_status, "pending");
  assert.equal(expense.receipt_file_name, "factura.pdf");

  const directPaidPatchRes = await fetch(`${baseUrl}/api/finance/expenses/${created.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      date: "2026-07-20",
      category: "maintenance",
      cost_center: "maintenance",
      supplier_name: "Proveedor Mantencion",
      supplier_rut: "76.111.222-3",
      description: "Mantencion porton principal",
      amount_net: 100000,
      tax_amount: 19000,
      amount_total: 119000,
      document_type: "invoice",
      document_number: "F-123",
      payment_status: "paid",
      paid_at: "2026-07-21",
      payment_method: "transfer",
      due_date: "2026-07-30",
      notes: "Intento de pago directo sin aprobacion",
    }),
  });
  assert.equal(directPaidPatchRes.status, 400);

  const receiptRes = await fetch(`${baseUrl}/api/finance/expenses/${created.id}/receipt`, {
    headers: { Cookie: cookie },
  });
  assert.equal(receiptRes.status, 200);
  assert.match(receiptRes.headers.get("content-type") || "", /application\/pdf/);

  const missingStatusNoteRes = await fetch(`${baseUrl}/api/finance/expenses/${created.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_status: "paid",
      paid_at: "2026-07-21",
      payment_method: "transfer",
    }),
  });
  assert.equal(missingStatusNoteRes.status, 400);

  const approvalRes = await fetch(`${baseUrl}/api/finance/expenses/${created.id}/approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      approval_status: "approved",
      note: "Gasto validado para pago por administracion",
    }),
  });
  assert.equal(approvalRes.status, 200);

  const statusRes = await fetch(`${baseUrl}/api/finance/expenses/${created.id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      payment_status: "paid",
      paid_at: "2026-07-21",
      payment_method: "transfer",
      notes: "Pagado por administración",
    }),
  });
  assert.equal(statusRes.status, 200);

  const reportRes = await fetch(`${baseUrl}/api/finance/reports/profitability`, {
    headers: { Cookie: cookie },
  });
  const report = await reportRes.json();
  assert.equal(reportRes.status, 200);
  assert(report.totalPaidExpenses >= 119000);
  assert.equal(typeof report.meta.formulas.netMargin, "string");
  assert(report.byCategory.some((item: any) => item.category === "maintenance"));

  const csvRes = await fetch(`${baseUrl}/api/finance/export/expenses.csv`, {
    headers: { Cookie: cookie },
  });
  const csv = await csvRes.text();
  assert.equal(csvRes.status, 200);
  assert(csv.startsWith("ID,Fecha,Categoría,Proveedor"));

  const xlsxRes = await fetch(`${baseUrl}/api/finance/export/expenses.xlsx`, {
    headers: { Cookie: cookie },
  });
  assert.equal(xlsxRes.status, 200);
  assert.match(xlsxRes.headers.get("content-type") || "", /spreadsheetml/);
  const workbook = await readXlsxWorkbook(xlsxRes);
  const sheet = workbook.getWorksheet("Gastos");
  assert(sheet);
  assert.deepEqual((sheet.getRow(1).values as any[]).slice(1, 5), ["ID", "Fecha", "Categor\u00eda", "Proveedor"]);
  assert((sheet.getColumn(3).values as any[]).includes("Mantenci\u00f3n"));

  const overdueRes = await fetch(`${baseUrl}/api/finance/expenses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      date: "2000-01-01",
      category: "utilities",
      supplier_name: "Proveedor Vencido",
      description: "Cuenta vencida",
      amount_total: 5000,
      document_type: "receipt",
      payment_status: "pending",
      due_date: "2000-01-02",
    }),
  });
  assert.equal(overdueRes.status, 200);

  const overdueListRes = await fetch(`${baseUrl}/api/finance/expenses?status=overdue&due=overdue`, {
    headers: { Cookie: cookie },
  });
  const overdueList = await overdueListRes.json();
  assert.equal(overdueListRes.status, 200);
  assert(overdueList.some((item: any) => item.supplier_name === "Proveedor Vencido"));

  const summaryRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: cookie },
  });
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert(summary.overdueExpenses >= 5000);
  assert.equal(typeof summary.projectedCashBalance, "number");

  const stalePayment = db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 4321, "2000-01-03", "pending");
  const refreshedSummaryRes = await fetch(`${baseUrl}/api/finance/summary`, {
    headers: { Cookie: cookie },
  });
  const refreshedSummary = await refreshedSummaryRes.json();
  const refreshedPayment = db.prepare("SELECT status FROM payments WHERE id = ?").get(stalePayment.lastInsertRowid) as { status: string };
  assert.equal(refreshedSummaryRes.status, 200);
  assert.equal(refreshedPayment.status, "overdue");
  assert(refreshedSummary.totalOverdue >= 4321);

  const oldContract = db.prepare(`
    INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(1, 1, "2024-01-01", 12345, 5);
  db.prepare("DELETE FROM payments WHERE contract_id = ?").run(oldContract.lastInsertRowid);
  const futurePaymentsRes = await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  });
  assert.equal(futurePaymentsRes.status, 200);
  const generatedFuture = db.prepare(`
    SELECT due_date, status
    FROM payments
    WHERE contract_id = ?
      AND due_date >= date('now')
      AND status != 'cancelled'
    ORDER BY due_date ASC
  `).all(oldContract.lastInsertRowid) as any[];
  assert(generatedFuture.length >= 12);
  assert(generatedFuture.every(payment => payment.status === "pending"));

  const expenseForReconcile = db.prepare(`
    INSERT INTO expenses (date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total, document_type, payment_status, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run("2026-08-01", "maintenance", "Proveedor Cartola", "76.111.222-3", "Servicio conciliable", 42000, 0, 42000, "invoice", "pending", "2026-08-10");
  const movementForExpense = db.prepare(`
    INSERT INTO bank_movements (date, description, rut, amount, status, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("2026-08-02", "PAGO PROVEEDOR CARTOLA", "76.111.222-3", 42000, "pending", "Cargo proveedor");

  const suggestionsRes = await fetch(`${baseUrl}/api/finance/expenses/${expenseForReconcile.lastInsertRowid}/bank-suggestions`, {
    headers: { Cookie: cookie },
  });
  const suggestions = await suggestionsRes.json();
  assert.equal(suggestionsRes.status, 200);
  assert(suggestions.suggestions.some((item: any) => item.bank_movement_id === Number(movementForExpense.lastInsertRowid)));

  const missingReconcileNoteRes = await fetch(`${baseUrl}/api/finance/expenses/${expenseForReconcile.lastInsertRowid}/reconcile-bank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      bank_movement_id: movementForExpense.lastInsertRowid,
    }),
  });
  assert.equal(missingReconcileNoteRes.status, 400);

  const reconcileApprovalRes = await fetch(`${baseUrl}/api/finance/expenses/${expenseForReconcile.lastInsertRowid}/approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      approval_status: "approved",
      note: "Aprobado para conciliacion bancaria",
    }),
  });
  assert.equal(reconcileApprovalRes.status, 200);

  const reconcileRes = await fetch(`${baseUrl}/api/finance/expenses/${expenseForReconcile.lastInsertRowid}/reconcile-bank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      bank_movement_id: movementForExpense.lastInsertRowid,
      note: "Gasto pagado en cartola",
    }),
  });
  assert.equal(reconcileRes.status, 200);

  const reconciledExpense = db.prepare("SELECT * FROM expenses WHERE id = ?").get(expenseForReconcile.lastInsertRowid) as any;
  assert.equal(reconciledExpense.payment_status, "paid");
  assert.equal(reconciledExpense.bank_movement_id, Number(movementForExpense.lastInsertRowid));

  const reconciledMovement = db.prepare("SELECT * FROM bank_movements WHERE id = ?").get(movementForExpense.lastInsertRowid) as any;
  assert.equal(reconciledMovement.status, "reconciled");
});

test("rejects missing payments and missing spaces in critical actions", async () => {
  const cookie = await login();

  const missingPaymentRes = await fetch(`${baseUrl}/api/finance/payments/99999/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ method: "cash", payment_date: "2026-05-12", note: "Prueba pago inexistente" }),
  });
  assert.equal(missingPaymentRes.status, 400);

  const openMissingSpaceRes = await fetch(`${baseUrl}/api/spaces/99999/open-barrier`, {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(openMissingSpaceRes.status, 404);

  const updateMissingSpaceRes = await fetch(`${baseUrl}/api/spaces/99999/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "maintenance" }),
  });
  assert.equal(updateMissingSpaceRes.status, 404);
});

test("records audit events for sensitive actions", async () => {
  const cookie = await login();
  await createStaff(cookie, "finance", "audit.finance@parkia.local", "55.555.555-5");

  const staffEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'staff.created' AND entity_type = 'staff'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;

  assert(staffEvent);
  assert.equal(staffEvent.staff_id, 1);
  assert.equal(JSON.parse(staffEvent.metadata).email, "audit.finance@parkia.local");

  db.prepare(`
    INSERT INTO payments (contract_id, amount, due_date, status)
    VALUES (?, ?, ?, ?)
  `).run(1, 77777, "2026-06-20", "pending");

  const payments = await (await fetch(`${baseUrl}/api/finance/payments`, {
    headers: { Cookie: cookie },
  })).json();
  const payment = payments.find((item: any) => item.status === "pending" || item.status === "overdue");
  assert(payment);

  const registerRes = await fetch(`${baseUrl}/api/finance/payments/${payment.id}/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ method: "cash", payment_date: "2026-05-12", note: "Pago recibido en caja" }),
  });
  assert.equal(registerRes.status, 200);

  const paymentEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'payment.registered' AND entity_type = 'payment' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(payment.id)) as any;

  assert(paymentEvent);
  assert.equal(paymentEvent.staff_id, 1);
  assert.equal(JSON.parse(paymentEvent.metadata).method, "cash");

  const auditListRes = await fetch(`${baseUrl}/api/audit-events?limit=5`, {
    headers: { Cookie: cookie },
  });
  const auditList = await auditListRes.json();
  assert.equal(auditListRes.status, 200);
  assert(auditList.some((event: any) => event.action === "payment.registered"));

  const filteredAuditRes = await fetch(`${baseUrl}/api/audit-events?action=payment.registered&entity_type=payment&limit=20`, {
    headers: { Cookie: cookie },
  });
  const filteredAudit = await filteredAuditRes.json();
  assert.equal(filteredAuditRes.status, 200);
  assert(filteredAudit.length >= 1);
  assert(filteredAudit.every((event: any) => event.action === "payment.registered" && event.entity_type === "payment"));

  const summaryRes = await fetch(`${baseUrl}/api/audit-events/summary?action=payment.registered`, {
    headers: { Cookie: cookie },
  });
  const summary = await summaryRes.json();
  assert.equal(summaryRes.status, 200);
  assert(summary.total >= 1);
  assert(summary.byAction.some((item: any) => item.action === "payment.registered"));

  const exportRes = await fetch(`${baseUrl}/api/audit-events/export.csv?action=payment.registered`, {
    headers: { Cookie: cookie },
  });
  const exportCsv = await exportRes.text();
  assert.equal(exportRes.status, 200);
  assert(exportCsv.startsWith("ID,Fecha,Usuario,Correo usuario,Acción,Tipo entidad,ID entidad,Detalle técnico,IP"));
  assert(exportCsv.includes("Pago registrado"));
});

test("creates database backups for admins only", async () => {
  const adminCookie = await login();
  const guardCookie = await login("guardia@parkia.local", "Cambiar123!");

  const deniedRes = await fetch(`${baseUrl}/api/backups/database`, {
    method: "POST",
    headers: { Cookie: guardCookie },
  });
  assert.equal(deniedRes.status, 403);

  const backupRes = await fetch(`${baseUrl}/api/backups/database`, {
    method: "POST",
    headers: { Cookie: adminCookie },
  });
  const backup = await backupRes.json();
  assert.equal(backupRes.status, 200);
  assert.equal(backup.success, true);
  assert.match(backup.backup.fileName, /^parkia-.+\.sqlite$/);
  assert.equal(typeof backup.backup.sizeBytes, "number");
  assert(backup.backup.sizeBytes > 0);

  const listRes = await fetch(`${baseUrl}/api/backups/database`, {
    headers: { Cookie: adminCookie },
  });
  const listBody = await listRes.json();
  assert.equal(listRes.status, 200);
  assert(listBody.backups.some((item: any) => item.fileName === backup.backup.fileName));

  const downloadRes = await fetch(`${baseUrl}/api/backups/database/${encodeURIComponent(backup.backup.fileName)}`, {
    headers: { Cookie: adminCookie },
  });
  const downloadBytes = await downloadRes.arrayBuffer();
  assert.equal(downloadRes.status, 200);
  assert(downloadBytes.byteLength > 0);

  const unsafeDownloadRes = await fetch(`${baseUrl}/api/backups/database/..%2Ftest.db`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(unsafeDownloadRes.status, 400);

  const backupEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'database.backup_created'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(backupEvent);
  assert.equal(backupEvent.entity_type, "database_backup");
});

test("uploads and downloads client documents from local storage", async () => {
  const cookie = await login();
  const soonDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const uploadRes = await fetch(`${baseUrl}/api/documents/client/1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Cédula representante",
      document_type: "identity",
      status: "pending",
      expires_at: "2026-12-31",
      notes: "Pendiente de revisión",
      fileName: "cedula.png",
      mimeType: "image/png",
      dataBase64: Buffer.from("png test").toString("base64"),
    }),
  });
  const uploadBody = await uploadRes.json();
  assert.equal(uploadRes.status, 200);
  assert.equal(typeof uploadBody.id, "number");

  const documentsRes = await fetch(`${baseUrl}/api/documents/client/1`, {
    headers: { Cookie: cookie },
  });
  const documents = await documentsRes.json();
  assert.equal(documentsRes.status, 200);
  const document = documents.find((item: any) => item.id === uploadBody.id);
  assert(document);
  assert.equal(document.label, "Cédula representante");
  assert.equal(document.document_type, "identity");
  assert.equal(document.status, "pending");
  assert.equal(document.expires_at, "2026-12-31");
  assert.equal(document.notes, "Pendiente de revisión");

  const expiringUploadRes = await fetch(`${baseUrl}/api/documents/client/1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      label: "Mandato por vencer",
      document_type: "mandate",
      status: "received",
      expires_at: soonDate,
      notes: "Solicitar renovación antes del vencimiento",
      fileName: "mandato.pdf",
      mimeType: "application/pdf",
      dataBase64: Buffer.from("%PDF-1.4 mandato").toString("base64"),
    }),
  });
  const expiringUploadBody = await expiringUploadRes.json();
  assert.equal(expiringUploadRes.status, 200);

  const reviewRes = await fetch(`${baseUrl}/api/documents/review`, {
    headers: { Cookie: cookie },
  });
  const reviewBody = await reviewRes.json();
  assert.equal(reviewRes.status, 200);
  assert(reviewBody.documents.some((item: any) => item.id === uploadBody.id));
  assert(reviewBody.documents.some((item: any) => item.id === expiringUploadBody.id));
  assert(reviewBody.summary.pending >= 1);
  assert(reviewBody.summary.expiringSoon >= 1);

  const missingRejectReasonRes = await fetch(`${baseUrl}/api/documents/${expiringUploadBody.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "rejected" }),
  });
  assert.equal(missingRejectReasonRes.status, 400);

  const rejectRes = await fetch(`${baseUrl}/api/documents/${expiringUploadBody.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      status: "rejected",
      rejection_reason: "Firma no coincide con cedula",
      assigned_staff_id: 1,
      next_action_at: "2026-12-15",
    }),
  });
  assert.equal(rejectRes.status, 200);

  const rejectedDocument = db.prepare("SELECT status, rejection_reason, assigned_staff_id, next_action_at FROM documents WHERE id = ?").get(expiringUploadBody.id) as any;
  assert.equal(rejectedDocument.status, "rejected");
  assert.equal(rejectedDocument.rejection_reason, "Firma no coincide con cedula");
  assert.equal(rejectedDocument.assigned_staff_id, 1);
  assert.equal(rejectedDocument.next_action_at, "2026-12-15");

  const documentTask = db.prepare(`
    SELECT * FROM operational_tasks
    WHERE source_type = 'document' AND source_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(expiringUploadBody.id)) as any;
  assert(documentTask);
  assert.equal(documentTask.category, "documents");
  assert.equal(documentTask.assigned_staff_id, 1);

  const financeStaff = db.prepare("SELECT id FROM staff WHERE role = 'finance' AND status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number };
  const rescheduleRes = await fetch(`${baseUrl}/api/documents/${expiringUploadBody.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      notes: "Reasignar seguimiento documental",
      assigned_staff_id: financeStaff.id,
      next_action_at: "2026-12-20",
    }),
  });
  assert.equal(rescheduleRes.status, 200);

  const syncedDocumentTask = db.prepare(`
    SELECT * FROM operational_tasks
    WHERE source_type = 'document' AND source_id = ? AND status IN ('open', 'in_progress')
    ORDER BY id DESC
    LIMIT 1
  `).get(String(expiringUploadBody.id)) as any;
  assert.equal(syncedDocumentTask.id, documentTask.id);
  assert.equal(syncedDocumentTask.assigned_staff_id, financeStaff.id);
  assert.equal(syncedDocumentTask.due_date, "2026-12-20");
  assert.match(syncedDocumentTask.description, /Reasignar seguimiento documental/);

  const syncEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'document.follow_up_task_synced' AND entity_type = 'operational_task' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(documentTask.id)) as any;
  assert(syncEvent);

  const documentTasksRes = await fetch(`${baseUrl}/api/tasks?source=document&status=active`, {
    headers: { Cookie: cookie },
  });
  const documentTasks = await documentTasksRes.json();
  assert.equal(documentTasksRes.status, 200);
  assert(documentTasks.some((task: any) => task.id === documentTask.id && task.source_href.includes("/documents")));

  const updateRes = await fetch(`${baseUrl}/api/documents/${uploadBody.id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ status: "approved", notes: "Documento validado" }),
  });
  assert.equal(updateRes.status, 200);

  const updatedDocument = db.prepare("SELECT status, notes FROM documents WHERE id = ?").get(uploadBody.id) as any;
  assert.equal(updatedDocument.status, "approved");
  assert.equal(updatedDocument.notes, "Documento validado");

  const libraryRes = await fetch(`${baseUrl}/api/documents/review?scope=all&search=${encodeURIComponent("representante")}&page=1&pageSize=10`, {
    headers: { Cookie: cookie },
  });
  const libraryBody = await libraryRes.json();
  assert.equal(libraryRes.status, 200);
  assert(libraryBody.total >= 1);
  assert(libraryBody.documents.some((item: any) => item.id === uploadBody.id && item.status === "approved"));

  const criticalSearchRes = await fetch(`${baseUrl}/api/documents/review?search=${encodeURIComponent("representante")}&page=1&pageSize=10`, {
    headers: { Cookie: cookie },
  });
  const criticalSearchBody = await criticalSearchRes.json();
  assert.equal(criticalSearchRes.status, 200);
  assert(!criticalSearchBody.documents.some((item: any) => item.id === uploadBody.id));

  const closedDocumentTask = db.prepare(`
    SELECT status, completed_note
    FROM operational_tasks
    WHERE source_type = 'document' AND source_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(uploadBody.id)) as any;
  assert.equal(closedDocumentTask.status, "done");

  const downloadRes = await fetch(`${baseUrl}/api/documents/${uploadBody.id}/download`, {
    headers: { Cookie: cookie },
  });
  assert.equal(downloadRes.status, 200);
  assert.match(downloadRes.headers.get("content-type") || "", /image\/png/);

  const auditEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'document.uploaded' AND entity_type = 'client' AND entity_id = '1'
    ORDER BY id DESC
    LIMIT 1
  `).get() as any;
  assert(auditEvent);

  const updateEvent = db.prepare(`
    SELECT * FROM audit_events
    WHERE action = 'document.updated' AND entity_type = 'document' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(String(uploadBody.id)) as any;
  assert(updateEvent);
});
