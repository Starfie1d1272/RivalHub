import { assertLocalDatabaseUrl } from "../../scripts/db/local-environment";

const configured = process.env.RIVALHUB_INTEGRATION_DATABASES;
const databaseUrls = configured
  ? parseDatabaseUrls(configured)
  : [assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL, "RIVALHUB_LOCAL_DATABASE_URL")];
const workerId = Number(process.env.VITEST_WORKER_ID ?? "1");
const selected = databaseUrls[(Number.isInteger(workerId) && workerId > 0 ? workerId - 1 : 0) % databaseUrls.length];

if (!selected) {
  throw new Error("未找到当前 Vitest worker 的 isolated PostgreSQL database。");
}

process.env.DATABASE_URL = selected;
process.env.RIVALHUB_LOCAL_DATABASE_URL = selected;
process.env.RIVALHUB_DB_TARGET = "local";

function parseDatabaseUrls(raw: string): string[] {
  let values: unknown;
  try {
    values = JSON.parse(raw);
  } catch {
    throw new Error("RIVALHUB_INTEGRATION_DATABASES 不是有效 JSON。");
  }
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("RIVALHUB_INTEGRATION_DATABASES 必须是非空 URL 数组。");
  }
  return values.map((value, index) =>
    assertLocalDatabaseUrl(
      typeof value === "string" ? value : undefined,
      `RIVALHUB_INTEGRATION_DATABASES[${index}]`,
    ),
  );
}
