import { assertLocalDatabaseUrl } from "../../scripts/db/local-environment";

const configured = process.env.RIVALHUB_INTEGRATION_DATABASES;
const databaseUrls = configured
  ? parseDatabaseUrls(configured)
  : [assertLocalDatabaseUrl(process.env.RIVALHUB_LOCAL_DATABASE_URL, "RIVALHUB_LOCAL_DATABASE_URL")];
// Pool slots are stable and unique among concurrent workers; WORKER_ID grows per file.
const poolId = Number(process.env.VITEST_POOL_ID);
if (configured && (!Number.isInteger(poolId) || poolId < 1 || poolId > databaseUrls.length)) {
  throw new Error("Vitest pool slot 没有对应的 isolated PostgreSQL database；拒绝共享 fallback。");
}
const selected = configured ? databaseUrls[poolId - 1] : databaseUrls[0];

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
