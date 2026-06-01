process.env.PARKIA_SEED_DEMO = process.env.PARKIA_SEED_DEMO || "false";

const { db } = await import("../server/db");
const { seedBaseData } = await import("../server/db/seed");
const { seedDeepDemoData } = await import("../server/db/deepSeed");

seedBaseData(db);
seedDeepDemoData(db);

const counts = {
  clients: db.prepare("SELECT COUNT(*) AS count FROM clients WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  spaces: db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  contracts: db.prepare("SELECT COUNT(*) AS count FROM contracts WHERE notes LIKE '%[DEMO-DEEP]%'").get().count,
  payments: db.prepare("SELECT COUNT(*) AS count FROM payments WHERE reference LIKE 'DEMO-%'").get().count,
  guardShifts: db.prepare("SELECT COUNT(*) AS count FROM guard_shift_logs WHERE opening_notes LIKE '%[DEMO-DEEP]%'").get().count,
  tasks: db.prepare("SELECT COUNT(*) AS count FROM operational_tasks WHERE source_type = 'demo_deep'").get().count,
};

console.log(JSON.stringify({ ok: true, seed: "demo-deep", counts }, null, 2));
