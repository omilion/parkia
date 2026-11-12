import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./server/db/schema/index.ts",
  out: "./server/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.PARKIA_PG_ADMIN_URL ||
      process.env.DATABASE_URL ||
      "postgresql://parkia_admin:parkia_admin_dev@127.0.0.1:5432/parkia",
  },
});

