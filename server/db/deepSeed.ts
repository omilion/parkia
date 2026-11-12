import type { Db } from "./engine/types";
import { existsSync, readdirSync, rmSync } from "fs";
import path from "path";
import { hashPassword } from "../auth/password";
import { getStorageRoot, storeDocumentBuffer } from "../storage";

const DEMO_TAG = "[DEMO-DEEP]";
const DEMO_FOLDER = "demo-deep";
const MAP_FOLDER = "space-maps";

type DemoIds = {
  tenantId: number;
  staff: Record<string, number>;
  branches: Record<string, number>;
  clients: Record<string, number>;
  spaces: Record<string, number>;
  contracts: Record<string, number>;
  payments: Record<string, number>;
  bankMovements: Record<string, number>;
  tickets: Record<string, number>;
  tasks: Record<string, number>;
  shifts: Record<string, number>;
  cashSessions: Record<string, number>;
};

type BranchSeed = {
  key: string;
  name: string;
  code: string;
  address: string;
  commune: string;
  city: string;
  phone: string;
};

type SpaceSeed = {
  key: string;
  branchKey: string;
  name: string;
  status: "available" | "occupied" | "maintenance";
  price: number;
  location: string;
  level: string;
  features: string;
  notes: string;
};

const branches: BranchSeed[] = [
  {
    key: "centro",
    name: "Sucursal Centro Alameda",
    code: "ALAMEDA",
    address: "Av. Libertador Bernardo O'Higgins 1245",
    commune: "Santiago",
    city: "Santiago",
    phone: "+56223450001",
  },
  {
    key: "providencia",
    name: "Sucursal Providencia Los Leones",
    code: "LEONES",
    address: "Av. Providencia 2250",
    commune: "Providencia",
    city: "Santiago",
    phone: "+56223450002",
  },
  {
    key: "kennedy",
    name: "Sucursal Las Condes Kennedy",
    code: "KENNEDY",
    address: "Av. Presidente Kennedy 5600",
    commune: "Las Condes",
    city: "Santiago",
    phone: "+56223450003",
  },
];

const spaces: SpaceSeed[] = [
  { key: "AL-01", branchKey: "centro", name: "AL-01 Preferente Norte", status: "occupied", price: 72000, location: "Patio principal", level: "Superficie", features: "CCTV, iluminacion nocturna, acceso rapido", notes: "Contrato mensual empresa centro." },
  { key: "AL-02", branchKey: "centro", name: "AL-02 Preferente Norte", status: "occupied", price: 72000, location: "Patio principal", level: "Superficie", features: "CCTV, cercano a oficina", notes: "Contrato mensual cliente natural." },
  { key: "AL-03", branchKey: "centro", name: "AL-03 Disponible", status: "available", price: 68000, location: "Patio principal", level: "Superficie", features: "Exterior, demarcacion nueva", notes: "Disponible para arriendo mensual o visita." },
  { key: "AL-04", branchKey: "centro", name: "AL-04 Visita activa", status: "occupied", price: 68000, location: "Patio principal", level: "Superficie", features: "Cerca de acceso peatonal", notes: "Ocupado por ticket momentaneo activo." },
  { key: "AL-05", branchKey: "centro", name: "AL-05 Mantencion", status: "maintenance", price: 65000, location: "Patio principal", level: "Superficie", features: "Requiere pintura de linea", notes: "Bloqueado por mantencion correctiva." },
  { key: "AL-06", branchKey: "centro", name: "AL-06 Disponible", status: "available", price: 65000, location: "Patio principal", level: "Superficie", features: "Exterior", notes: "Libre para operacion diaria." },
  { key: "AL-07", branchKey: "centro", name: "AL-07 Empresa", status: "occupied", price: 76000, location: "Patio principal", level: "Superficie", features: "CCTV, cupo ancho", notes: "Asignado a flota mensual." },
  { key: "AL-08", branchKey: "centro", name: "AL-08 Disponible", status: "available", price: 64000, location: "Patio principal", level: "Superficie", features: "Exterior", notes: "Libre." },
  { key: "AL-09", branchKey: "centro", name: "AL-09 Ticket pagado", status: "occupied", price: 64000, location: "Patio principal", level: "Superficie", features: "Exterior", notes: "Visita pagada aun dentro del recinto." },
  { key: "AL-10", branchKey: "centro", name: "AL-10 Disponible sur", status: "available", price: 62000, location: "Patio sur", level: "Superficie", features: "Exterior", notes: "Libre." },

  { key: "PR-01", branchKey: "providencia", name: "PR-01 Techado", status: "occupied", price: 88000, location: "Nivel -1", level: "Subterraneo", features: "Techado, CCTV, ascensor", notes: "Contrato mensual premium." },
  { key: "PR-02", branchKey: "providencia", name: "PR-02 Techado", status: "available", price: 84000, location: "Nivel -1", level: "Subterraneo", features: "Techado", notes: "Disponible." },
  { key: "PR-03", branchKey: "providencia", name: "PR-03 Visita", status: "occupied", price: 84000, location: "Nivel -1", level: "Subterraneo", features: "Techado", notes: "Ticket visitante activo." },
  { key: "PR-04", branchKey: "providencia", name: "PR-04 Mantencion", status: "maintenance", price: 82000, location: "Nivel -1", level: "Subterraneo", features: "Sensor de humo", notes: "Sensor pendiente de revision." },
  { key: "PR-05", branchKey: "providencia", name: "PR-05 Empresa", status: "occupied", price: 90000, location: "Nivel -1", level: "Subterraneo", features: "Techado, cupo ancho", notes: "Contrato mensual empresa." },
  { key: "PR-06", branchKey: "providencia", name: "PR-06 Disponible", status: "available", price: 82000, location: "Nivel -1", level: "Subterraneo", features: "Techado", notes: "Libre." },
  { key: "PR-07", branchKey: "providencia", name: "PR-07 Disponible", status: "available", price: 80000, location: "Nivel -1", level: "Subterraneo", features: "Techado", notes: "Libre." },
  { key: "PR-08", branchKey: "providencia", name: "PR-08 Mensual mora", status: "occupied", price: 86000, location: "Nivel -1", level: "Subterraneo", features: "Techado", notes: "Contrato activo con cobranza." },

  { key: "KE-01", branchKey: "kennedy", name: "KE-01 Preferente", status: "occupied", price: 110000, location: "Sector norte", level: "Superficie", features: "CCTV, acceso controlado", notes: "Contrato mensual corporativo." },
  { key: "KE-02", branchKey: "kennedy", name: "KE-02 Preferente", status: "occupied", price: 110000, location: "Sector norte", level: "Superficie", features: "CCTV, acceso controlado", notes: "Contrato mensual corporativo." },
  { key: "KE-03", branchKey: "kennedy", name: "KE-03 Disponible", status: "available", price: 98000, location: "Sector norte", level: "Superficie", features: "Exterior", notes: "Libre." },
  { key: "KE-04", branchKey: "kennedy", name: "KE-04 Visita activa", status: "occupied", price: 98000, location: "Sector norte", level: "Superficie", features: "Exterior", notes: "Ticket visita activo." },
  { key: "KE-05", branchKey: "kennedy", name: "KE-05 Mantencion", status: "maintenance", price: 96000, location: "Sector norte", level: "Superficie", features: "Requiere barrera auxiliar", notes: "Mantencion por topes sueltos." },
  { key: "KE-06", branchKey: "kennedy", name: "KE-06 Disponible", status: "available", price: 96000, location: "Sector norte", level: "Superficie", features: "Exterior", notes: "Libre." },
  { key: "KE-07", branchKey: "kennedy", name: "KE-07 Empresa", status: "occupied", price: 105000, location: "Sector sur", level: "Superficie", features: "Cupo ancho", notes: "Contrato mensual activo." },
  { key: "KE-08", branchKey: "kennedy", name: "KE-08 Ticket pagado", status: "occupied", price: 95000, location: "Sector sur", level: "Superficie", features: "Exterior", notes: "Visita pagada dentro del recinto." },
  { key: "KE-09", branchKey: "kennedy", name: "KE-09 Disponible", status: "available", price: 94000, location: "Sector sur", level: "Superficie", features: "Exterior", notes: "Libre." },
  { key: "KE-10", branchKey: "kennedy", name: "KE-10 Disponible", status: "available", price: 94000, location: "Sector sur", level: "Superficie", features: "Exterior", notes: "Libre." },
  { key: "KE-11", branchKey: "kennedy", name: "KE-11 Mensual", status: "occupied", price: 104000, location: "Sector sur", level: "Superficie", features: "CCTV", notes: "Contrato mensual activo." },
  { key: "KE-12", branchKey: "kennedy", name: "KE-12 Disponible", status: "available", price: 92000, location: "Sector sur", level: "Superficie", features: "Exterior", notes: "Libre." },
];

async function tableExists(db: Db, tableName: string) {
  const sql = db.dialect === "postgres"
    ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?"
    : "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?";
  return Boolean(await db.prepare(sql).get(tableName));
}

/** Desactiva o reactiva las llaves foraneas durante la limpieza de datos demo. */
async function setForeignKeys(db: Db, enabled: boolean) {
  await db.exec(db.dialect === "postgres"
    ? `SET session_replication_role = ${enabled ? "origin" : "replica"}`
    : `PRAGMA foreign_keys = ${enabled ? "ON" : "OFF"}`);
}

async function getId(db: Db, sql: string, ...params: any[]) {
  const row = await db.prepare(sql).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`No se pudo resolver ID demo: ${sql}`);
  return Number(row.id);
}

async function insert(db: Db, sql: string, ...params: any[]) {
  return Number((await db.prepare(sql).run(...params)).lastInsertRowid);
}

function assertNonProductionReset() {
  if (process.env.NODE_ENV === "production" && process.env.PARKIA_ALLOW_DEMO_RESET !== "true") {
    throw new Error("Reset demo bloqueado en produccion. Define PARKIA_ALLOW_DEMO_RESET=true solo si sabes lo que haces.");
  }
}

async function ensureTenant(db: Db) {
  let tenant = await db.prepare("SELECT id FROM tenants ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (!tenant) {
    const result = await db.prepare("INSERT INTO tenants (name, rut, status) VALUES (?, ?, 'active')")
      .run("Parkia Demo Operativo SpA", "76.500.100-9");
    tenant = { id: Number(result.lastInsertRowid) };
  }

  await db.prepare("UPDATE tenants SET name = ?, rut = ?, status = 'active', updated_at = datetime('now') WHERE id = ?")
    .run("Parkia Demo Operativo SpA", "76.500.100-9", tenant.id);

  const proPlan = await db.prepare("SELECT id FROM plans WHERE code = 'pro'").get() as { id: number } | undefined;
  if (proPlan) {
    const subscription = await db.prepare("SELECT id FROM subscriptions WHERE tenant_id = ? LIMIT 1").get(tenant.id) as { id: number } | undefined;
    if (subscription) {
      await db.prepare(`
        UPDATE subscriptions
        SET plan_id = ?, status = 'active', current_period_start = '2026-06-01',
            current_period_end = '2027-06-01', notes = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(proPlan.id, `${DEMO_TAG} Tenant demo con 3 sucursales dentro del plan Pro.`, subscription.id);
    } else {
      await db.prepare(`
        INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, notes)
        VALUES (?, ?, 'active', '2026-06-01', '2027-06-01', ?)
      `).run(tenant.id, proPlan.id, `${DEMO_TAG} Tenant demo con 3 sucursales dentro del plan Pro.`);
    }
  }

  await db.prepare(`
    UPDATE system_config
    SET company_name = 'Parkia Demo Operativo SpA',
        company_rut = '76.500.100-9',
        company_address = 'Av. Providencia 2250, Providencia, Santiago',
        sii_mode = 'mock',
        sii_provider = 'local_mock'
    WHERE id = 1
  `).run();

  return tenant.id;
}

async function ensureStaff(db: Db, ids: DemoIds) {
  const password = hashPassword("Cambiar123!");
  const adminPassword = hashPassword("admin123");
  const staff = [
    ["Admin Parkia", "11.111.111-1", "admin@parkia.local", "+56911111111", "admin", adminPassword],
    ["Finanzas Parkia", "33.333.333-3", "finance@parkia.local", "+56933333333", "finance", password],
    ["Guardia Parkia", "22.222.222-2", "guardia@parkia.local", "+56922222222", "guard", password],
    ["Caja Parkia", "44.444.444-4", "caja@parkia.local", "+56944444444", "cashier", password],
    ["Nicolas Lagos", "15.101.101-1", "admin.ops@parkia.local", "+56951011011", "admin", password],
    ["Paula Rojas", "16.202.202-2", "finance.demo@parkia.local", "+56962022022", "finance", password],
    ["Diego Rivas", "17.303.303-3", "guard.demo@parkia.local", "+56973033033", "guard", password],
    ["Valentina Cruz", "18.404.404-4", "cashier.demo@parkia.local", "+56984044044", "cashier", password],
  ];

  for (const [name, rut, email, phone, role, passwordHash] of staff) {
    const existing = await db.prepare("SELECT id FROM staff WHERE email = ?").get(email) as { id: number } | undefined;
    if (existing) {
      await db.prepare(`
        UPDATE staff
        SET name = ?, rut = ?, phone = ?, role = ?, status = 'active',
            password_hash = ?, must_change_password = 0,
            password_changed_at = datetime('now', '-15 day'), updated_at = datetime('now')
        WHERE id = ?
      `).run(name, rut, phone, role, passwordHash, existing.id);
      ids.staff[String(email)] = existing.id;
    } else {
      ids.staff[String(email)] = await insert(db, `
        INSERT INTO staff (
          name, rut, email, phone, role, status, password_hash,
          must_change_password, password_changed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, 0, datetime('now', '-15 day'), datetime('now'))
      `, name, rut, email, phone, role, passwordHash);
    }
  }
}

async function ensureTenantMemberships(db: Db, tenantId: number) {
  await db.prepare("DELETE FROM tenant_memberships WHERE tenant_id = ?").run(tenantId);
  await db.prepare(`
    INSERT OR IGNORE INTO tenant_memberships (tenant_id, staff_id, role, status, updated_at)
    SELECT ?, id, CASE WHEN role = 'admin' THEN 'owner' ELSE 'member' END, 'active', datetime('now')
    FROM staff
    WHERE status = 'active'
  `).run(tenantId);
}

function purgeStorageFiles() {
  const storageRoot = path.resolve(getStorageRoot());
  const demoDir = path.resolve(storageRoot, DEMO_FOLDER);
  if (demoDir.startsWith(`${storageRoot}${path.sep}`) && existsSync(demoDir)) {
    rmSync(demoDir, { recursive: true, force: true });
  }

  const mapDir = path.resolve(storageRoot, MAP_FOLDER);
  if (mapDir.startsWith(`${storageRoot}${path.sep}`) && existsSync(mapDir)) {
    for (const fileName of readdirSync(mapDir)) {
      if (fileName.startsWith("demo-deep-")) {
        rmSync(path.join(mapDir, fileName), { force: true });
      }
    }
  }
}

export async function purgeDeepDemoData(db: Db) {
  assertNonProductionReset();

  const candidateTables = [
    "auth_sessions",
    "staff_access_events",
    "audit_events",
    "sii_events",
    "cash_session_closures",
    "cash_movements",
    "cash_sessions",
    "visitor_ticket_quotes",
    "visitor_tickets",
    "visitor_passes",
    "shift_log_entry_attachments",
    "guard_shift_log_entries",
    "guard_shift_logs",
    "task_attachments",
    "task_comments",
    "operational_tasks",
    "documents",
    "invoices",
    "payment_adjustments",
    "collection_actions",
    "payment_allocations",
    "payments",
    "bank_movements",
    "expenses",
    "financial_budgets",
    "monthly_finance_closures",
    "access_logs",
    "space_status_history",
    "space_map_regions",
    "space_maps",
    "contracts",
    "vehicles",
    "spaces",
    "clients",
    "totems",
    "branches",
  ];
  const tablesToClear: string[] = [];
  for (const tableName of candidateTables) if (await tableExists(db, tableName)) tablesToClear.push(tableName);

  await setForeignKeys(db, false);
  try {
    const run = db.transaction(async () => {
      for (const tableName of tablesToClear) {
        await db.prepare(`DELETE FROM ${tableName}`).run();
      }

      await db.prepare(`
        DELETE FROM staff
        WHERE email NOT IN (
          'admin@parkia.local',
          'finance@parkia.local',
          'guardia@parkia.local',
          'caja@parkia.local'
        )
      `).run();

      if (await tableExists(db, "tenant_memberships")) {
        await db.prepare("DELETE FROM tenant_memberships").run();
      }

      if (await tableExists(db, "sqlite_sequence") && tablesToClear.length > 0) {
        const placeholders = tablesToClear.map(() => "?").join(",");
        await db.prepare(`DELETE FROM sqlite_sequence WHERE name IN (${placeholders})`).run(...tablesToClear);
      }
    });
    await run();
  } finally {
    await setForeignKeys(db, true);
  }

  purgeStorageFiles();
  const tenantId = await ensureTenant(db);
  await ensureTenantMemberships(db, tenantId);
}

function demoPdf(label: string) {
  const safeLabel = label.replace(/[()\\]/g, "");
  const content = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 360 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>
endobj
4 0 obj
<< /Length 94 >>
stream
BT /F1 12 Tf 24 112 Td (${safeLabel}) Tj 0 -24 Td (Documento demo Parkia) Tj 0 -20 Td (${DEMO_TAG}) Tj ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000294 00000 n
0000000437 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
507
%%EOF`;
  return Buffer.from(content, "utf8");
}

function storeDemoDocument(label: string, fileName: string) {
  return storeDocumentBuffer({
    fileName,
    mimeType: "application/pdf",
    buffer: demoPdf(label),
    folder: DEMO_FOLDER,
  });
}

async function seedBranches(db: Db, ids: DemoIds) {
  for (const branch of branches) {
    ids.branches[branch.key] = await insert(db, `
      INSERT INTO branches (name, code, address, commune, city, phone, status, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `, branch.name, branch.code, branch.address, branch.commune, branch.city, branch.phone, ids.tenantId);
  }

  const totems = [
    ["centro", "Totem Alameda Entrada", "online"],
    ["centro", "Totem Alameda Salida", "online"],
    ["providencia", "Totem Los Leones Entrada", "online"],
    ["providencia", "Totem Los Leones Salida", "online"],
    ["kennedy", "Totem Kennedy Entrada Norte", "online"],
    ["kennedy", "Totem Kennedy Salida Sur", "online"],
  ];

  for (const [branchKey, name, status] of totems) {
    await db.prepare(`
      INSERT INTO totems (name, status, maintenance_mode, last_heartbeat, branch_id, tenant_id)
      VALUES (?, ?, 0, datetime('now', '-2 minutes'), ?, ?)
    `).run(name, status, ids.branches[String(branchKey)], ids.tenantId);
  }
}

async function seedClients(db: Db, ids: DemoIds) {
  const clients = [
    ["Logistica Alameda SpA", "76.120.450-1", "operaciones@logialameda.cl", "+56961110001", "company", "active", "Santa Rosa 410", "Santiago", "Santiago", "Distribucion urbana", "Marcela Pinto", "13.200.100-5", "Rosa Farias", "pagos@logialameda.cl", "+56961110002", "up-to-date", "Cliente flota centro con dos contratos activos."],
    ["Matias Fuentes", "15.510.220-8", "matias.fuentes@example.cl", "+56962220001", "natural", "active", "Portugal 340", "Santiago", "Santiago", "", "", "", "Matias Fuentes", "matias.fuentes@example.cl", "+56962220001", "overdue", "Cliente mensual con deuda vencida controlada."],
    ["Clinica Nueva Salud SpA", "76.303.404-5", "admin@nuevasalud.cl", "+56963330001", "company", "active", "Av. Providencia 2400", "Providencia", "Santiago", "Servicios medicos", "Felipe Barros", "12.330.220-1", "Teresa Rojas", "finanzas@nuevasalud.cl", "+56963330002", "up-to-date", "Cliente institucional Providencia."],
    ["Camila Herrera", "16.404.505-6", "camila.herrera@example.cl", "+56964440001", "natural", "active", "Suecia 122", "Providencia", "Santiago", "", "", "", "Camila Herrera", "camila.herrera@example.cl", "+56964440001", "overdue", "Cliente natural con cobranza proxima."],
    ["Inversiones Kennedy Ltda", "77.505.606-7", "operaciones@invkennedy.cl", "+56965550001", "company", "active", "Av. Kennedy 5600", "Las Condes", "Santiago", "Administracion de oficinas", "Sofia Larrain", "14.440.330-2", "Ignacio Mena", "pagos@invkennedy.cl", "+56965550002", "up-to-date", "Cliente corporativo Las Condes."],
    ["Agencia Norte Digital SpA", "76.707.808-9", "contacto@nortedigital.cl", "+56966660001", "company", "active", "Rosario Norte 615", "Las Condes", "Santiago", "Marketing digital", "Daniel Rivas", "15.550.330-3", "Paola Leiva", "finanzas@nortedigital.cl", "+56966660002", "up-to-date", "Cliente con cupos para equipo comercial."],
    ["Rafael Munoz", "17.808.909-0", "rafael.munoz@example.cl", "+56967770001", "natural", "archived", "San Diego 889", "Santiago", "Santiago", "", "", "", "Rafael Munoz", "rafael.munoz@example.cl", "+56967770001", "up-to-date", "Cliente archivado con contrato terminado para historial."],
  ];

  for (const client of clients) {
    const [name, rut, email, phone, type, status, address, commune, city, businessActivity, legalName, legalRut, billingName, billingEmail, billingPhone, financialStatus, note] = client;
    ids.clients[String(rut)] = await insert(db, `
      INSERT INTO clients (
        name, rut, email, phone, type, status, address, commune, city, business_activity,
        legal_representative_name, legal_representative_rut, billing_contact_name,
        billing_contact_email, billing_contact_phone, financial_status, notes, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, name, rut, email, phone, type, status, address, commune, city, businessActivity, legalName, legalRut, billingName, billingEmail, billingPhone, financialStatus, `${DEMO_TAG} ${note}`, ids.tenantId);
  }

  const vehicles = [
    ["76.120.450-1", "ALAD-10", "Hyundai", "Tucson", "Blanco"],
    ["76.120.450-1", "ALAD-11", "Toyota", "Hilux", "Gris"],
    ["15.510.220-8", "MF-2208", "Mazda", "CX-5", "Azul"],
    ["76.303.404-5", "NS-3040", "Nissan", "X-Trail", "Blanco"],
    ["16.404.505-6", "CH-4505", "Kia", "Sportage", "Rojo"],
    ["77.505.606-7", "IK-5600", "Volvo", "XC40", "Negro"],
    ["77.505.606-7", "IK-5601", "BMW", "X1", "Gris"],
    ["76.707.808-9", "ND-7808", "Subaru", "Forester", "Verde"],
    ["17.808.909-0", "RM-8909", "Kia", "Morning", "Rojo"],
  ];

  for (const [rut, plate, brand, model, color] of vehicles) {
    await db.prepare(`
      INSERT INTO vehicles (client_id, plate, brand, model, color, notes, status, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(ids.clients[String(rut)], plate, brand, model, color, `${DEMO_TAG} Vehiculo autorizado para demo.`, ids.tenantId);
  }
}

async function seedSpaces(db: Db, ids: DemoIds) {
  for (const space of spaces) {
    ids.spaces[space.key] = await insert(db, `
      INSERT INTO spaces (
        name, type, status, price, location, level, width_m, length_m, height_m,
        features, notes, updated_at, branch_id, tenant_id
      ) VALUES (?, 'parking', ?, ?, ?, ?, 2.5, 5.0, 2.2, ?, ?, datetime('now', '-1 hour'), ?, ?)
    `, space.name, space.status, space.price, space.location, space.level, space.features, `${DEMO_TAG} ${space.notes}`, ids.branches[space.branchKey], ids.tenantId);
  }
}

async function seedContractsAndPayments(db: Db, ids: DemoIds) {
  const contracts = [
    ["logistica-al-01", "76.120.450-1", "AL-01", "2025-10-01", null, 72000, 5, 72000, "factura_afecta", "active"],
    ["logistica-al-07", "76.120.450-1", "AL-07", "2025-11-01", null, 76000, 5, 76000, "factura_afecta", "active"],
    ["matias-al-02", "15.510.220-8", "AL-02", "2025-12-15", null, 72000, 10, 72000, "boleta", "active"],
    ["salud-pr-01", "76.303.404-5", "PR-01", "2025-09-01", null, 88000, 1, 88000, "factura_exenta", "active"],
    ["camila-pr-08", "16.404.505-6", "PR-08", "2026-01-01", null, 86000, 10, 86000, "boleta", "active"],
    ["kennedy-ke-01", "77.505.606-7", "KE-01", "2025-07-01", null, 110000, 1, 110000, "factura_afecta", "active"],
    ["kennedy-ke-02", "77.505.606-7", "KE-02", "2025-07-01", null, 110000, 1, 110000, "factura_afecta", "active"],
    ["norte-ke-07", "76.707.808-9", "KE-07", "2025-11-01", null, 105000, 5, 105000, "factura_afecta", "active"],
    ["norte-ke-11", "76.707.808-9", "KE-11", "2026-02-01", null, 104000, 5, 104000, "factura_afecta", "active"],
    ["rafael-terminated", "17.808.909-0", "AL-10", "2025-03-01", "2026-03-31", 62000, 5, 62000, "boleta", "terminated"],
  ];

  for (const [key, rut, spaceKey, startDate, endDate, fee, billingDay, deposit, docType, status] of contracts) {
    const branchId = await db.prepare("SELECT branch_id FROM spaces WHERE id = ?").get(ids.spaces[String(spaceKey)]) as { branch_id: number };
    ids.contracts[String(key)] = await insert(db, `
      INSERT INTO contracts (
        client_id, space_id, start_date, end_date, monthly_fee, billing_day,
        deposit_amount, billing_document_type, status, notes, branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ids.clients[String(rut)], ids.spaces[String(spaceKey)], startDate, endDate, fee, billingDay, deposit, docType, status, `${DEMO_TAG} Contrato demo ${key}.`, branchId.branch_id, ids.tenantId);
  }

  const paidRefs: Array<[string, string, number, string]> = [];
  for (const [key, , , , , fee, , , , status] of contracts) {
    const contractKey = String(key);
    const months = [
      ["2026-04", "paid", "2026-04-03 10:30:00", "transfer"],
      ["2026-05", contractKey.includes("matias") || contractKey.includes("camila") ? "overdue" : "paid", contractKey.includes("matias") || contractKey.includes("camila") ? null : "2026-05-04 12:10:00", contractKey.includes("matias") || contractKey.includes("camila") ? null : "transfer"],
      ["2026-06", status === "terminated" ? "cancelled" : "pending", null, null],
    ];

    for (const [month, paymentStatus, paymentDate, method] of months) {
      const dueDay = contractKey.includes("salud") || contractKey.includes("kennedy") ? "01" : contractKey.includes("matias") || contractKey.includes("camila") ? "10" : "05";
      const branchId = await db.prepare("SELECT branch_id FROM contracts WHERE id = ?").get(ids.contracts[contractKey]) as { branch_id: number };
      const reference = `DEMO-${contractKey.toUpperCase()}-${month}`;
      const paymentId = await insert(db, `
        INSERT INTO payments (
          contract_id, amount, due_date, status, payment_date, method, reference, branch_id, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, ids.contracts[contractKey], fee, `${month}-${dueDay}`, paymentStatus, paymentDate, method, reference, branchId.branch_id, ids.tenantId);
      ids.payments[`${contractKey}-${month}`] = paymentId;
      if (paymentStatus === "paid") paidRefs.push([reference, contractKey, Number(fee), String(paymentDate)]);
    }
  }

  for (const [reference, contractKey, amount, dateTime] of paidRefs.slice(0, 8)) {
    const contract = await db.prepare(`
      SELECT c.branch_id, cl.rut, cl.name
      FROM contracts c
      JOIN clients cl ON cl.id = c.client_id
      WHERE c.id = ?
    `).get(ids.contracts[contractKey]) as { branch_id: number; rut: string; name: string };
    const bankId = await insert(db, `
      INSERT INTO bank_movements (date, description, rut, amount, status, notes, tenant_id, branch_id)
      VALUES (?, ?, ?, ?, 'reconciled', ?, ?, ?)
    `, String(dateTime).slice(0, 10), `[DEMO] Transferencia ${contract.name}`, contract.rut, amount, `${DEMO_TAG} Movimiento conciliado automaticamente.`, ids.tenantId, contract.branch_id);
    ids.bankMovements[reference] = bankId;

    const paymentId = await getId(db, "SELECT id FROM payments WHERE reference = ?", reference);
    await db.prepare(`
      INSERT INTO payment_allocations (payment_id, bank_movement_id, amount, note, created_at, tenant_id)
      VALUES (?, ?, ?, ?, datetime('now', '-10 day'), ?)
    `).run(paymentId, bankId, amount, `${DEMO_TAG} Conciliacion exacta.`, ids.tenantId);

    await db.prepare(`
      INSERT INTO invoices (
        folio, type, client_id, amount, status_sii, payment_id, contract_id,
        provider, provider_mode, external_id, status_detail, issued_at, tenant_id
      )
      SELECT 910000 + ?, c.billing_document_type, c.client_id, ?, 'accepted', ?, c.id,
             'local_mock', 'mock', ?, ?, ?, ?
      FROM contracts c
      WHERE c.id = ?
    `).run(paymentId, amount, paymentId, `DEMO-SII-${paymentId}`, `${DEMO_TAG} Documento mock aceptado localmente.`, dateTime, ids.tenantId, ids.contracts[contractKey]);
  }

  const overduePayments = ["matias-al-02-2026-05", "camila-pr-08-2026-05"];
  for (const paymentKey of overduePayments) {
    await db.prepare(`
      INSERT INTO collection_actions (payment_id, staff_id, channel, note, next_action_at, status, created_at, tenant_id)
      VALUES (?, ?, 'whatsapp', ?, '2026-06-07', 'open', datetime('now', '-1 day'), ?)
    `).run(ids.payments[paymentKey], ids.staff["finance@parkia.local"], `${DEMO_TAG} Contactar cliente y confirmar fecha de pago.`, ids.tenantId);
    await db.prepare(`
      INSERT INTO payment_adjustments (payment_id, staff_id, type, amount, previous_amount, new_amount, reason, created_at, tenant_id)
      SELECT id, ?, 'fee', 2500, amount, amount + 2500, ?, datetime('now', '-1 day'), ?
      FROM payments
      WHERE id = ?
    `).run(ids.staff["finance@parkia.local"], `${DEMO_TAG} Cargo administrativo por atraso.`, ids.tenantId, ids.payments[paymentKey]);
  }
}

async function seedVisitorsAccessAndCash(db: Db, ids: DemoIds) {
  const sessions = [
    ["centro", ids.staff["caja@parkia.local"], "open", 35000, null],
    ["providencia", ids.staff["cashier.demo@parkia.local"], "closed", 40000, "2026-06-04 21:00:00"],
    ["kennedy", ids.staff["caja@parkia.local"], "open", 50000, null],
  ];

  for (const [branchKey, staffId, status, openingCash, closedAt] of sessions) {
    ids.cashSessions[String(branchKey)] = await insert(db, `
      INSERT INTO cash_sessions (
        staff_id, status, opening_cash, expected_cash, counted_cash, counted_transfer,
        counted_card, difference_cash, opened_at, closed_at, notes, branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      staffId,
      status,
      openingCash,
      Number(openingCash) + 18500,
      status === "closed" ? Number(openingCash) + 15000 : null,
      status === "closed" ? 3000 : null,
      status === "closed" ? 500 : null,
      status === "closed" ? 0 : null,
      "2026-06-05 08:00:00",
      closedAt,
      `${DEMO_TAG} Caja demo ${branchKey}.`,
      ids.branches[String(branchKey)],
      ids.tenantId
    );
  }

  const tickets = [
    ["ticket-al-04", "VIS-104", "AL-04", "active", null, 0, null, null, "2026-06-05 09:15:00", "manual"],
    ["ticket-al-09", "VIS-109", "AL-09", "paid", null, 4500, "card", "2026-06-05 10:30:00", "2026-06-05 09:55:00", "totem"],
    ["ticket-pr-03", "VIS-203", "PR-03", "active", null, 0, null, null, "2026-06-05 11:05:00", "totem"],
    ["ticket-ke-04", "VIS-304", "KE-04", "active", null, 0, null, null, "2026-06-05 08:40:00", "manual"],
    ["ticket-ke-08", "VIS-308", "KE-08", "paid", null, 6000, "cash", "2026-06-05 09:50:00", "2026-06-05 08:10:00", "totem"],
    ["ticket-pr-done", "DONE-21", "PR-06", "completed", "2026-06-04 12:30:00", 3500, "cash", "2026-06-04 12:25:00", "2026-06-04 10:15:00", "manual"],
  ];

  for (const [key, plate, spaceKey, status, exitTime, amount, method, paidAt, entryTime, entryMethod] of tickets) {
    const branchKey = spaces.find(space => space.key === spaceKey)?.branchKey || "centro";
    ids.tickets[String(key)] = await insert(db, `
      INSERT INTO visitor_tickets (
        plate, entry_time, exit_time, amount, status, payment_method, space_id,
        paid_at, cash_session_id, created_by_staff_id, entry_method, branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, plate, entryTime, exitTime, amount, status, method, ids.spaces[String(spaceKey)], paidAt, ids.cashSessions[branchKey], ids.staff["caja@parkia.local"], entryMethod, ids.branches[branchKey], ids.tenantId);

    if (Number(amount) > 0) {
      await db.prepare(`
        INSERT INTO cash_movements (
          cash_session_id, source_type, source_id, method, direction, amount,
          created_by_staff_id, note, created_at, tenant_id
        ) VALUES (?, 'visitor_ticket', ?, ?, 'in', ?, ?, ?, ?, ?)
      `).run(ids.cashSessions[branchKey], ids.tickets[String(key)], method || "cash", amount, ids.staff["caja@parkia.local"], `${DEMO_TAG} Pago ticket visitante.`, paidAt || entryTime, ids.tenantId);
    }
  }

  const accessLogs = [
    [ids.clients["76.120.450-1"], null, "AL-01", "entry", "authorized", "card", "Ingreso mensual autorizado", "ALAD-10", "2026-06-05 08:05:00"],
    [ids.clients["76.120.450-1"], null, "AL-07", "entry", "authorized", "card", "Ingreso flota autorizado", "ALAD-11", "2026-06-05 08:20:00"],
    [ids.clients["15.510.220-8"], null, "AL-02", "entry", "authorized", "manual", "Ingreso autorizado con deuda informada", "MF-2208", "2026-06-05 09:10:00"],
    [null, ids.tickets["ticket-al-04"], "AL-04", "entry", "authorized", "qr", "Ticket visitante activo", "VIS-104", "2026-06-05 09:15:00"],
    [null, ids.tickets["ticket-al-09"], "AL-09", "entry", "authorized", "qr", "Ticket visitante pagado dentro del recinto", "VIS-109", "2026-06-05 09:55:00"],
    [ids.clients["76.303.404-5"], null, "PR-01", "entry", "authorized", "card", "Ingreso mensual autorizado", "NS-3040", "2026-06-05 08:35:00"],
    [ids.clients["16.404.505-6"], null, "PR-08", "entry", "authorized", "manual", "Ingreso mensual con cobranza activa", "CH-4505", "2026-06-05 09:45:00"],
    [null, ids.tickets["ticket-pr-03"], "PR-03", "entry", "authorized", "qr", "Visita activa", "VIS-203", "2026-06-05 11:05:00"],
    [ids.clients["77.505.606-7"], null, "KE-01", "entry", "authorized", "card", "Ingreso mensual autorizado", "IK-5600", "2026-06-05 07:55:00"],
    [ids.clients["77.505.606-7"], null, "KE-02", "entry", "authorized", "card", "Ingreso mensual autorizado", "IK-5601", "2026-06-05 08:05:00"],
    [ids.clients["76.707.808-9"], null, "KE-07", "entry", "authorized", "card", "Ingreso mensual autorizado", "ND-7808", "2026-06-05 08:25:00"],
    [null, ids.tickets["ticket-ke-04"], "KE-04", "entry", "authorized", "qr", "Visita activa", "VIS-304", "2026-06-05 08:40:00"],
    [null, ids.tickets["ticket-ke-08"], "KE-08", "entry", "authorized", "qr", "Visita pagada dentro del recinto", "VIS-308", "2026-06-05 08:10:00"],
  ];

  for (const [clientId, ticketId, spaceKey, accessType, status, method, reason, plate, timestamp] of accessLogs) {
    const branchKey = spaces.find(space => space.key === spaceKey)?.branchKey || "centro";
    await db.prepare(`
      INSERT INTO access_logs (
        client_id, visitor_id, space_id, branch_id, access_type, status,
        method, reason, authorized_by, plate, timestamp, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clientId, ticketId, ids.spaces[String(spaceKey)], ids.branches[branchKey], accessType, status, method, `${DEMO_TAG} ${reason}`, "Demo Operacion", plate, timestamp, ids.tenantId);
  }

  await db.prepare(`
    INSERT INTO visitor_passes (
      name, rut, type, reason, associated_space_id, valid_from, valid_to,
      qr_token, status, plate, phone, company, authorized_by, branch_id, tenant_id
    ) VALUES (?, ?, 'provider', ?, ?, '2026-06-05 08:00:00', '2026-06-05 18:00:00',
      ?, 'inside', ?, ?, ?, ?, ?, ?)
  `).run("Mauricio Vega", "19.100.200-3", "Retiro de materiales oficina Kennedy", ids.spaces["KE-05"], "demo-deep-provider-kennedy", "MT-8822", "+56991919191", "Servicios Vega", "Diego Rivas", ids.branches.kennedy, ids.tenantId);

  for (const maintenanceKey of ["AL-05", "PR-04", "KE-05"]) {
    await db.prepare(`
      INSERT INTO space_status_history (space_id, staff_id, previous_status, status, reason, source, created_at, tenant_id)
      VALUES (?, ?, 'available', 'maintenance', ?, 'demo_deep', datetime('now', '-1 day'), ?)
    `).run(ids.spaces[maintenanceKey], ids.staff["guardia@parkia.local"], `${DEMO_TAG} Mantencion preventiva/correctiva registrada.`, ids.tenantId);
  }
}

async function seedFinanceOps(db: Db, ids: DemoIds) {
  const expenses = [
    ["centro", "2026-06-02", "maintenance", "Pinturas Centro SpA", "76.888.100-1", "Demarcacion cupos Alameda", 95000, 18050, 113050, "invoice", "DEMO-AL-889", "transfer", "paid", "2026-06-03", "2026-06-10", "maintenance", "approved"],
    ["providencia", "2026-06-03", "utilities", "Enel Distribucion", "96.800.570-7", "Cuenta electrica Providencia", 132000, 25080, 157080, "invoice", "DEMO-PR-120", "automatic", "pending", null, "2026-06-20", "utilities", "pending"],
    ["kennedy", "2026-06-04", "supplies", "Seguridad Total Ltda", "77.111.222-3", "Credenciales RFID Kennedy", 68000, 12920, 80920, "invoice", "DEMO-KE-450", "transfer", "overdue", null, "2026-06-04", "access", "pending"],
  ];

  for (const expense of expenses) {
    const [branchKey, ...values] = expense;
    await db.prepare(`
      INSERT INTO expenses (
        date, category, supplier_name, supplier_rut, description, amount_net, tax_amount, amount_total,
        document_type, document_number, payment_method, payment_status, paid_at, due_date, cost_center,
        approval_status, approved_by_staff_id, approved_at, notes, branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'approved' THEN datetime('now', '-2 day') ELSE NULL END, ?, ?, ?)
    `).run(...values, ids.staff["admin@parkia.local"], values[15], `${DEMO_TAG} Gasto operacional demo.`, ids.branches[String(branchKey)], ids.tenantId);
  }

  const budgets = [
    ["2026-06", "maintenance", 380000, "Mantencion preventiva, pintura y sensores."],
    ["2026-06", "utilities", 420000, "Servicios basicos de las tres sucursales."],
    ["2026-06", "supplies", 180000, "Credenciales, totems y controles de acceso."],
    ["2026-06", "admin", 250000, "Administracion central y soporte operativo."],
  ];

  for (const [month, category, amount, notes] of budgets) {
    await db.prepare(`
      INSERT INTO financial_budgets (month, category, planned_amount, notes, tenant_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(month, category, amount, `${DEMO_TAG} ${notes}`, ids.tenantId);
  }

  await db.prepare(`
    INSERT INTO monthly_finance_closures (
      month, status, closed_by_staff_id, closed_at, accepted_pending_note,
      monthly_snapshot_json, operational_snapshot_json, tenant_id
    ) VALUES ('2026-05', 'closed', ?, '2026-06-01 18:20:00', ?, ?, ?, ?)
  `).run(
    ids.staff["finance@parkia.local"],
    `${DEMO_TAG} Cierre demo mayo con cobranza controlada y caja conciliada.`,
    JSON.stringify({ tag: DEMO_TAG, income: 841000, expenses: 224000, overdue: 158000 }),
    JSON.stringify({ tag: DEMO_TAG, branches: 3, spaces: spaces.length, activeTickets: 5, maintenance: 3 }),
    ids.tenantId
  );
}

async function seedDocumentsTasksAndShifts(db: Db, ids: DemoIds) {
  const documents = [
    ["client", ids.clients["76.120.450-1"], "RUT empresa Logistica Alameda", "identity", "approved", "2027-06-01", null, "rut-logistica-alameda.pdf"],
    ["contract", ids.contracts["salud-pr-01"], "Contrato firmado Clinica Nueva Salud", "contract", "pending", null, "Falta firma de representante suplente.", "contrato-clinica-providencia.pdf"],
    ["payment", ids.payments["matias-al-02-2026-05"], "Comprobante parcial Matias Fuentes", "receipt", "rejected", null, "Imagen ilegible, solicitar respaldo bancario.", "comprobante-matias-rechazado.pdf"],
    ["client", ids.clients["77.505.606-7"], "Mandato PAC Inversiones Kennedy", "mandate", "approved", "2027-01-31", null, "mandato-kennedy.pdf"],
  ];

  for (const [entityType, entityId, label, documentType, status, expiresAt, notes, fileName] of documents) {
    const stored = storeDemoDocument(String(label), String(fileName));
    await db.prepare(`
      INSERT INTO documents (
        entity_type, entity_id, label, document_type, status, expires_at, notes,
        file_path, file_name, mime_type, size_bytes, assigned_staff_id, next_action_at,
        reviewed_by_staff_id, reviewed_at, rejection_reason, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entityType,
      entityId,
      label,
      documentType,
      status,
      expiresAt,
      notes ? `${DEMO_TAG} ${notes}` : `${DEMO_TAG} Documento demo.`,
      stored.filePath,
      stored.fileName,
      stored.mimeType,
      stored.sizeBytes,
      ids.staff["finance@parkia.local"],
      status === "pending" || status === "rejected" ? "2026-06-08" : null,
      status === "approved" ? ids.staff["admin@parkia.local"] : null,
      status === "approved" ? "2026-06-02 09:30:00" : null,
      status === "rejected" ? "No se distingue numero de operacion." : null,
      ids.tenantId
    );
  }

  const tasks = [
    ["centro", "cobranza-matias", "Cobranza Matias Fuentes", "Confirmar pago diferencia mayo y actualizar gestion.", "finance", "high", "open", ids.staff["finance@parkia.local"], "2026-06-07"],
    ["centro", "mantencion-al-05", "Pintar cupo AL-05", "Validar secado y liberar cupo cuando corresponda.", "maintenance", "medium", "in_progress", ids.staff["guardia@parkia.local"], "2026-06-06"],
    ["providencia", "documento-clinica", "Regularizar contrato Clinica Nueva Salud", "Solicitar segunda firma del representante.", "documents", "high", "open", ids.staff["finance.demo@parkia.local"], "2026-06-08"],
    ["kennedy", "auditoria-kennedy", "Auditar ticket Kennedy VIS-308", "Revisar pago caja y salida pendiente.", "access", "medium", "open", ids.staff["guard.demo@parkia.local"], "2026-06-06"],
    ["kennedy", "proveedor-kennedy", "Registrar salida proveedor Kennedy", "Cerrar pase de proveedor cuando abandone recinto.", "access", "medium", "open", ids.staff["guard.demo@parkia.local"], "2026-06-05"],
  ];

  for (const [branchKey, key, title, description, category, priority, status, assigneeId, dueDate] of tasks) {
    ids.tasks[String(key)] = await insert(db, `
      INSERT INTO operational_tasks (
        title, description, category, priority, status, assigned_staff_id, source_type,
        source_id, due_date, created_by_staff_id, completed_at, completed_note,
        branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, 'demo_deep', ?, ?, ?, NULL, NULL, ?, ?)
    `, `[DEMO] ${title}`, `${DEMO_TAG} ${description}`, category, priority, status, assigneeId, key, dueDate, ids.staff["admin@parkia.local"], ids.branches[String(branchKey)], ids.tenantId);

    await db.prepare(`
      INSERT INTO task_comments (task_id, staff_id, note, created_at, tenant_id)
      VALUES (?, ?, ?, datetime('now', '-6 hours'), ?)
    `).run(ids.tasks[String(key)], ids.staff["admin@parkia.local"], `${DEMO_TAG} Seguimiento demo con trazabilidad.`, ids.tenantId);
  }

  const shifts = [
    ["centro", "turno-centro", ids.staff["guardia@parkia.local"], "2026-06-05", "morning", "Turno manana Alameda con visitas activas.", "Pendiente AL-05 en mantencion.", "Caja inicial revisada.", "open", "2026-06-05 08:00:00", null],
    ["providencia", "turno-providencia", ids.staff["guard.demo@parkia.local"], "2026-06-04", "night", "Turno noche Providencia sin incidentes mayores.", "Se informa sensor PR-04 pendiente.", "Cierre caja cuadrado.", "closed", "2026-06-04 20:00:00", "2026-06-05 08:00:00"],
    ["kennedy", "turno-kennedy", ids.staff["guard.demo@parkia.local"], "2026-06-05", "morning", "Turno Kennedy con proveedor dentro del recinto.", "Validar salida proveedor.", "Caja inicial $50.000.", "open", "2026-06-05 08:00:00", null],
  ];

  for (const [branchKey, key, staffId, shiftDate, shiftName, opening, handover, cashNote, status, openedAt, closedAt] of shifts) {
    ids.shifts[String(key)] = await insert(db, `
      INSERT INTO guard_shift_logs (
        staff_id, shift_date, shift_name, opening_notes, handover_notes, cash_count_note,
        status, opened_at, closed_at, cash_session_id, branch_id, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, staffId, shiftDate, shiftName, `${DEMO_TAG} ${opening}`, handover, cashNote, status, openedAt, closedAt, ids.cashSessions[String(branchKey)] || null, ids.branches[String(branchKey)], ids.tenantId);

    await db.prepare("UPDATE cash_sessions SET shift_log_id = ? WHERE id = ? AND tenant_id = ?")
      .run(ids.shifts[String(key)], ids.cashSessions[String(branchKey)] || 0, ids.tenantId);
  }

  const entries = [
    ["turno-centro", "mantencion-al-05", "maintenance", "high", "Cupo AL-05 bloqueado por pintura", "Se mantiene fuera de servicio hasta secado.", "AL-05"],
    ["turno-providencia", "documento-clinica", "maintenance", "medium", "Sensor PR-04 pendiente", "Proveedor confirma visita para revision.", "PR-04"],
    ["turno-kennedy", "proveedor-kennedy", "visitor", "medium", "Proveedor en KE-05", "Registrar salida y cierre de pase.", "KE-05"],
  ];

  for (const [shiftKey, taskKey, category, priority, title, detail, spaceKey] of entries) {
    const entryId = await insert(db, `
      INSERT INTO guard_shift_log_entries (
        shift_log_id, staff_id, task_id, category, priority, title, detail,
        related_space_id, follow_up_required, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, ids.shifts[String(shiftKey)], ids.staff["guardia@parkia.local"], ids.tasks[String(taskKey)], category, priority, title, `${DEMO_TAG} ${detail}`, ids.spaces[String(spaceKey)], ids.tenantId);

    if (String(category) === "maintenance") {
      const stored = storeDemoDocument(`Bitacora ${spaceKey}`, `bitacora-${spaceKey}.pdf`);
      await db.prepare(`
        INSERT INTO shift_log_entry_attachments (
          shift_log_entry_id, staff_id, label, file_path, file_name,
          mime_type, size_bytes, tenant_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(entryId, ids.staff["guardia@parkia.local"], `Adjunto ${spaceKey}`, stored.filePath, stored.fileName, stored.mimeType, stored.sizeBytes, ids.tenantId);
    }
  }
}

async function seedAuditEvents(db: Db, ids: DemoIds) {
  const events = [
    [ids.staff["admin@parkia.local"], "demo.seed.created", "demo_seed", "deep", { branches: 3, spaces: spaces.length }],
    [ids.staff["finance@parkia.local"], "payment.collection_action_created", "payment", String(ids.payments["matias-al-02-2026-05"]), { client: "Matias Fuentes" }],
    [ids.staff["guardia@parkia.local"], "space.status_changed", "space", String(ids.spaces["AL-05"]), { status: "maintenance" }],
  ];

  for (const [staffId, action, entityType, entityId, metadata] of events) {
    await db.prepare(`
      INSERT INTO audit_events (staff_id, action, entity_type, entity_id, metadata, ip_address, created_at, tenant_id)
      VALUES (?, ?, ?, ?, ?, '127.0.0.1', datetime('now', '-1 hour'), ?)
    `).run(staffId, action, entityType, entityId, JSON.stringify({ tag: DEMO_TAG, ...(metadata as Record<string, unknown>) }), ids.tenantId);
  }
}

export async function seedDeepDemoData(db: Db) {
  await purgeDeepDemoData(db);

  const run = db.transaction(async () => {
    const ids: DemoIds = {
      tenantId: await ensureTenant(db),
      staff: {},
      branches: {},
      clients: {},
      spaces: {},
      contracts: {},
      payments: {},
      bankMovements: {},
      tickets: {},
      tasks: {},
      shifts: {},
      cashSessions: {},
    };

    await ensureStaff(db, ids);
    await ensureTenantMemberships(db, ids.tenantId);
    await seedBranches(db, ids);
    await seedClients(db, ids);
    await seedSpaces(db, ids);
    await seedContractsAndPayments(db, ids);
    await seedVisitorsAccessAndCash(db, ids);
    await seedFinanceOps(db, ids);
    await seedDocumentsTasksAndShifts(db, ids);
    await seedAuditEvents(db, ids);
  });

  await run();
}
