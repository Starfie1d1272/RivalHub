import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { assertLocalDatabaseUrl } from "../../../../scripts/db/local-environment";

export function localDatabaseUrl(): string {
  return assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
}

export function createLocalPool(options: PoolConfig = {}): Pool {
  return new Pool({ connectionString: localDatabaseUrl(), ssl: false, ...options });
}

type QueryClient = Pick<PoolClient, "query">;

export async function capturePostgresError(
  client: QueryClient,
  work: () => Promise<unknown>,
): Promise<unknown> {
  const savepoint = `expected_error_${randomUUID().replaceAll("-", "")}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await work();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return error;
  }
  await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  return undefined;
}
