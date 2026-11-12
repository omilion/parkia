process.env.PARKIA_SEED_DEMO = process.env.PARKIA_SEED_DEMO || "false";

const { db } = await import("../server/db");
const { seedBaseData } = await import("../server/db/seed");
const { seedDeepDemoData } = await import("../server/db/deepSeed");

await seedBaseData(db);
await seedDeepDemoData(db);

const counts = {
  clients: (await db.prepare("SELECT COUNT(*) AS count FROM clients WHERE notes LIKE '%[DEMO-DEEP]%'").get()).count,
  spaces: (await db.prepare("SELECT COUNT(*) AS count FROM spaces WHERE notes LIKE '%[DEMO-DEEP]%'").get()).count,
  contracts: (await db.prepare("SELECT COUNT(*) AS count FROM contracts WHERE notes LIKE '%[DEMO-DEEP]%'").get()).count,
  payments: (await db.prepare("SELECT COUNT(*) AS count FROM payments WHERE reference LIKE 'DEMO-%'").get()).count,
  guardShifts: (await db.prepare("SELECT COUNT(*) AS count FROM guard_shift_logs WHERE opening_notes LIKE '%[DEMO-DEEP]%'").get()).count,
  tasks: (await db.prepare("SELECT COUNT(*) AS count FROM operational_tasks WHERE source_type = 'demo_deep'").get()).count,
};

console.log(JSON.stringify({ ok: true, seed: "demo-deep", counts }, null, 2));
