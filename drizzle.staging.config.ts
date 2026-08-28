import type { Config } from "drizzle-kit";
import { assertStagingDatabaseUrl } from "./scripts/db/staging-environment";

const databaseUrl = assertStagingDatabaseUrl(process.env.RIVALHUB_STAGING_DATABASE_URL);

export default {
  schema: "./src/db/schema",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
    ssl: true,
  },
} satisfies Config;
