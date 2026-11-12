import type { Db } from "./engine/types";
import { hashPassword } from "../auth/password";

export async function seedDatabase(db: Db) {
  await seedDemoData(db);
  await seedBaseData(db);
}

export async function seedBaseData(db: Db) {
  await seedAccessRates(db);
  await seedStaff(db);
  await seedConfig(db);
  await seedTotems(db);
  await ensureDefaultTenantMemberships(db);
}

async function seedDemoData(db: Db) {
  const clientCount = await db.prepare("SELECT COUNT(*) as count FROM clients").get() as { count: number };
  if (clientCount.count !== 0) return;
  const branchId = await getDefaultBranchId(db);

  await db.prepare("INSERT INTO clients (name, email, phone, rut, type, financial_status, business_activity) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("Juan Perez", "juan@example.com", "+56912345678", "12.345.678-9", "natural", "up-to-date", "Abonado mensual");
  await db.prepare("INSERT INTO clients (name, email, phone, rut, type, financial_status, business_activity) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("Logistica Centro SpA", "contacto@logisticacentro.cl", "+56998765432", "76.543.210-K", "company", "up-to-date", "Flota corporativa");

  await db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, ?, ?, ?, ?)").run("Estacionamiento A1", "parking", "occupied", 50000, branchId);
  await db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, ?, ?, ?, ?)").run("Estacionamiento A2", "parking", "available", 50000, branchId);
  await db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, ?, ?, ?, ?)").run("Estacionamiento B1", "parking", "available", 65000, branchId);
  await db.prepare("INSERT INTO spaces (name, type, status, price, branch_id) VALUES (?, ?, ?, ?, ?)").run("Estacionamiento B2", "parking", "occupied", 65000, branchId);

  await db.prepare("INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id) VALUES (?, ?, ?, ?, ?, ?)").run(1, 1, "2024-01-01", 50000, 5, branchId);
  await db.prepare("INSERT INTO contracts (client_id, space_id, start_date, monthly_fee, billing_day, branch_id) VALUES (?, ?, ?, ?, ?, ?)").run(2, 4, "2024-02-15", 65000, 10, branchId);

  await db.prepare("INSERT INTO vehicles (client_id, plate, brand, model) VALUES (?, ?, ?, ?)").run(1, "ABCD-12", "Toyota", "Yaris");
  await db.prepare("INSERT INTO vehicles (client_id, plate, brand, model) VALUES (?, ?, ?, ?)").run(1, "XYZ-99", "Chevrolet", "Spark");
  await db.prepare("INSERT INTO vehicles (client_id, plate, brand, model) VALUES (?, ?, ?, ?)").run(2, "QWER-55", "Ford", "Ranger");

  await db.prepare("INSERT INTO payments (contract_id, amount, due_date, status, payment_date, method, branch_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(1, 50000, "2026-02-05", "paid", "2026-02-04", "transfer", branchId);
  await db.prepare("INSERT INTO payments (contract_id, amount, due_date, status, branch_id) VALUES (?, ?, ?, ?, ?)").run(1, 50000, "2026-03-05", "pending", branchId);
  await db.prepare("INSERT INTO payments (contract_id, amount, due_date, status, branch_id) VALUES (?, ?, ?, ?, ?)").run(2, 65000, "2026-02-10", "overdue", branchId);

  await db.prepare("INSERT INTO bank_movements (date, description, rut, amount, status) VALUES (?, ?, ?, ?, ?)").run("2026-02-24", "TRANSFERENCIA RECIBIDA - JUAN PEREZ", "12.345.678-9", 50000, "pending");
  await db.prepare("INSERT INTO bank_movements (date, description, rut, amount, status) VALUES (?, ?, ?, ?, ?)").run("2026-02-24", "DEPOSITO EFECTIVO CAJA", "76.543.210-K", 65000, "pending");
  await db.prepare("INSERT INTO bank_movements (date, description, rut, amount, status) VALUES (?, ?, ?, ?, ?)").run("2026-02-24", "TRANSFERENCIA RECIBIDA - DESCONOCIDO", "99.999.999-9", 50000, "pending");

  await db.prepare("INSERT INTO invoices (folio, type, client_id, amount, status_sii) VALUES (?, ?, ?, ?, ?)").run(449, "boleta", 1, 50000, "accepted");

  await db.prepare("INSERT INTO visitor_tickets (plate, entry_time, branch_id) VALUES (?, datetime('now', '-2 hours'), ?)").run("ABCD-12", branchId);
  await db.prepare("INSERT INTO visitor_tickets (plate, entry_time, branch_id) VALUES (?, datetime('now', '-45 minutes'), ?)").run("XY-9876", branchId);
}

async function getDefaultBranchId(db: Db) {
  const branch = await db.prepare("SELECT id FROM branches WHERE status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (branch) return branch.id;
  const result = await db.prepare("INSERT INTO branches (name, code, status) VALUES ('Sucursal Principal', 'MAIN', 'active')").run();
  return Number(result.lastInsertRowid);
}

async function seedAccessRates(db: Db) {
  const rateCount = await db.prepare("SELECT COUNT(*) as count FROM access_rates").get() as { count: number };
  if (rateCount.count !== 0) return;

  await db.prepare("INSERT INTO access_rates (type, rate_per_hour, rate_per_minute, grace_period_mins, billing_mode) VALUES (?, ?, ?, ?, 'per_minute')").run("Proveedor", 0, 0, 120);
  await db.prepare("INSERT INTO access_rates (type, rate_per_hour, rate_per_minute, grace_period_mins, billing_mode) VALUES (?, ?, ?, ?, 'per_minute')").run("Visita Cliente", 1500, 25, 15);
  await db.prepare("INSERT INTO access_rates (type, rate_per_hour, rate_per_minute, grace_period_mins, billing_mode) VALUES (?, ?, ?, ?, 'per_minute')").run("Publico General", 3000, 50, 15);
}

async function seedStaff(db: Db) {
  const defaultAdminHash = hashPassword("admin123");
  const defaultUserHash = hashPassword("Cambiar123!");
  const ensureStaff = async (input: { name: string, rut: string, email: string, role: "admin" | "finance" | "guard" | "cashier", passwordHash: string }) => {
    const existing = await db.prepare("SELECT id, password_hash FROM staff WHERE email = ?").get(input.email) as { id: number, password_hash: string | null } | undefined;
    if (existing) {
      if (!existing.password_hash) {
        await db.prepare("UPDATE staff SET password_hash = ? WHERE id = ?").run(input.passwordHash, existing.id);
      }
      return;
    }

    await db.prepare("INSERT INTO staff (name, rut, email, role, password_hash) VALUES (?, ?, ?, ?, ?)")
      .run(input.name, input.rut, input.email, input.role, input.passwordHash);
  };

  const staffCount = await db.prepare("SELECT COUNT(*) as count FROM staff").get() as { count: number };
  if (staffCount.count !== 0) {
    await db.prepare("UPDATE staff SET password_hash = ? WHERE email = ? AND password_hash IS NULL").run(defaultAdminHash, "admin@parkia.local");
    await db.prepare("UPDATE staff SET password_hash = ? WHERE password_hash IS NULL").run(defaultUserHash);
    await ensureStaff({ name: "Admin Parkia", rut: "11.111.111-1", email: "admin@parkia.local", role: "admin", passwordHash: defaultAdminHash });
    await ensureStaff({ name: "Finanzas Parkia", rut: "33.333.333-3", email: "finance@parkia.local", role: "finance", passwordHash: defaultUserHash });
    await ensureStaff({ name: "Guardia Parkia", rut: "22.222.222-2", email: "guardia@parkia.local", role: "guard", passwordHash: defaultUserHash });
    await ensureStaff({ name: "Caja Parkia", rut: "44.444.444-4", email: "caja@parkia.local", role: "cashier", passwordHash: defaultUserHash });
    return;
  }

  await ensureStaff({ name: "Admin Parkia", rut: "11.111.111-1", email: "admin@parkia.local", role: "admin", passwordHash: defaultAdminHash });
  await ensureStaff({ name: "Finanzas Parkia", rut: "33.333.333-3", email: "finance@parkia.local", role: "finance", passwordHash: defaultUserHash });
  await ensureStaff({ name: "Guardia Parkia", rut: "22.222.222-2", email: "guardia@parkia.local", role: "guard", passwordHash: defaultUserHash });
  await ensureStaff({ name: "Caja Parkia", rut: "44.444.444-4", email: "caja@parkia.local", role: "cashier", passwordHash: defaultUserHash });
}

async function seedConfig(db: Db) {
  // En PostgreSQL no existe la tabla heredada system_config: la configuracion vive en tenant_settings.
  if (db.dialect === "postgres") return;
  const configCount = await db.prepare("SELECT COUNT(*) as count FROM system_config").get() as { count: number };
  if (configCount.count !== 0) return;

  await db.prepare("INSERT INTO system_config (id, grace_days, late_interest, overdue_recovery_rate, company_name, company_rut) VALUES (1, 5, 1.5, 60, 'Parkia SpA', '76.000.000-1')").run();
}

async function seedTotems(db: Db) {
  const totemCount = await db.prepare("SELECT COUNT(*) as count FROM totems").get() as { count: number };
  if (totemCount.count !== 0) return;
  const branchId = await getDefaultBranchId(db);

  await db.prepare("INSERT INTO totems (name, status, branch_id) VALUES (?, ?, ?)").run("Totem Entrada Principal", "online", branchId);
  await db.prepare("INSERT INTO totems (name, status, branch_id) VALUES (?, ?, ?)").run("Totem Salida 1", "online", branchId);
}

async function tableExists(db: Db, tableName: string) {
  const sql = db.dialect === "postgres"
    ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?"
    : "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?";
  return Boolean(await db.prepare(sql).get(tableName));
}

async function columnExists(db: Db, tableName: string, columnName: string) {
  if (db.dialect === "postgres") {
    return Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?").get(tableName, columnName));
  }
  return (await db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>).some(column => column.name === columnName);
}

async function ensureDefaultTenantMemberships(db: Db) {
  if (!await tableExists(db, "tenants") || !await tableExists(db, "tenant_memberships")) return;
  const tenant = await db.prepare("SELECT id FROM tenants WHERE status = 'active' ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (!tenant) return;

  await db.prepare(`
    INSERT OR IGNORE INTO tenant_memberships (tenant_id, staff_id, role, status)
    SELECT ?, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, 'active'
    FROM staff
  `).run(tenant.id);

  if (await tableExists(db, "vehicles") && await columnExists(db, "vehicles", "tenant_id")) {
    await db.prepare(`
      UPDATE vehicles
      SET tenant_id = COALESCE(
        tenant_id,
        (SELECT tenant_id FROM clients WHERE clients.id = vehicles.client_id),
        ?
      )
    `).run(tenant.id);
  }
}
