import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import { assertLocalDatabaseUrl } from "../../../../scripts/db/local-environment";

export function localDatabaseUrl(): string {
  return assertLocalDatabaseUrl(
    process.env.RIVALHUB_LOCAL_DATABASE_URL,
    "RIVALHUB_LOCAL_DATABASE_URL",
  );
}

export function testSteam64(seed: string): string {
  const suffix = BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 15)}`) % BigInt("10000000000000000");
  return (BigInt("76561198000000000") + suffix).toString();
}

export function createLocalPool(options: PoolConfig = {}): Pool {
  return new Pool({ connectionString: localDatabaseUrl(), ssl: false, ...options });
}

export async function measureMaxConcurrentClientQueries(
  client: PoolClient,
  operation: () => Promise<unknown>,
): Promise<number> {
  let inFlight = 0;
  let maxInFlight = 0;
  const originalQuery = client.query;
  const wrappedQuery = (...args: unknown[]) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const result = Reflect.apply(originalQuery, client, args);
    return Promise.resolve(result).finally(() => {
      inFlight -= 1;
    });
  };
  client.query = wrappedQuery as typeof client.query;
  try {
    await operation();
    return maxInFlight;
  } finally {
    client.query = originalQuery;
  }
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
