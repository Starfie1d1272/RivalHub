import { postgresConnection } from "./src/db/postgres-connection";
import type { Config } from "drizzle-kit";
import { assertProductionDatabaseUrl } from "./scripts/db/production-environment";

const databaseUrl = assertProductionDatabaseUrl(process.env.RIVALHUB_PRODUCTION_DATABASE_URL);

export default {
  schema: "./src/db/schema",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: postgresConnection(databaseUrl).connectionString,
    ssl: postgresConnection(databaseUrl).ssl,
  },
} satisfies Config;
