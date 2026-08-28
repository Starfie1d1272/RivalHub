import type { Config } from "drizzle-kit";
import { assertLocalDatabaseUrl } from "./scripts/db/local-environment";

const databaseUrl = assertLocalDatabaseUrl(
  process.env.RIVALHUB_LOCAL_DATABASE_URL,
  "RIVALHUB_LOCAL_DATABASE_URL",
);

export default {
  schema: "./src/db/schema",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: false,
  },
} satisfies Config;
