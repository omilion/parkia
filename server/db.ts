import Database from "better-sqlite3";
import { getParkiaEnv, getParkiaSeedDemoSetting } from "./env";
import { initializeSchema } from "./db/schema";
import { seedBaseData, seedDatabase } from "./db/seed";

export const db = new Database(getParkiaEnv("PARKIA_DB_PATH", "TIOLUCHIN_DB_PATH", "parkia.db"));

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

initializeSchema(db);

const seedDemoSetting = getParkiaSeedDemoSetting();
const shouldSeedDemoData =
  seedDemoSetting === "true" ||
  (process.env.NODE_ENV !== "production" && seedDemoSetting !== "false");

if (shouldSeedDemoData) {
  seedDatabase(db);
} else {
  seedBaseData(db);
}
