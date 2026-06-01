process.env.PARKIA_SEED_DEMO = process.env.PARKIA_SEED_DEMO || "false";

const { db } = await import("../server/db");
const { purgeDeepDemoData } = await import("../server/db/deepSeed");

purgeDeepDemoData(db);

const remaining = {
  clients: db.prepare("SELECT COUNT(*) AS count FROM clients WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  spaces: db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  contracts: db.prepare("SELECT COUNT(*) AS count FROM contracts WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  payments: db.prepare("SELECT COUNT(*) AS count FROM payments WHERE reference LIKE 'DEMO-%'").get().count,
  guardShifts: db.prepare("SELECT COUNT(*) AS count FROM guard_shift_logs WHERE opening_notes LIKE '%[DEMO-DEEP]%'").get().count,
  tasks: db.prepare("SELECT COUNT(*) AS count FROM operational_tasks WHERE source_type = 'demo_deep'").get().count,
};

console.log(JSON.stringify({ ok: true, purged: "demo-deep", remaining }, null, 2));
