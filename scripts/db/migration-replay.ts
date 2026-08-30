import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export function localReplayDatabaseUrl(prefix: string): { maintenanceUrl: string; databaseUrl: string; databaseName: string } {
  const configured = process.env.RIVALHUB_LOCAL_DATABASE_URL;
  if (!configured) throw new Error("RIVALHUB_LOCAL_DATABASE_URL 未设置。");
  const local = new URL(configured);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(local.hostname)) {
    throw new Error("迁移回放只允许 Local Supabase loopback 数据库。");
  }
  const databaseName = `${prefix}_${randomUUID().replaceAll("-", "")}`;
  const maintenance = new URL(configured);
  maintenance.pathname = "/postgres";
  const database = new URL(configured);
  database.pathname = `/${databaseName}`;
  return { maintenanceUrl: maintenance.toString(), databaseUrl: database.toString(), databaseName };
}

export async function withScratchDatabase<T>(prefix: string, work: (client: Client) => Promise<T>): Promise<T> {
  const urls = localReplayDatabaseUrl(prefix);
  const admin = new Client({ connectionString: urls.maintenanceUrl, ssl: false });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${urls.databaseName}"`);
    const client = new Client({ connectionString: urls.databaseUrl, ssl: false });
    await client.connect();
    try {
      return await work(client);
    } finally {
      await client.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${urls.databaseName}"`);
    await admin.end();
  }
}

export async function replayMigration(client: Client, migrationName: string): Promise<void> {
  const source = readFileSync(join(process.cwd(), "drizzle/migrations", migrationName), "utf8");
  await client.query("BEGIN");
  try {
    await client.query(source);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`${migrationName} 回放失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

export function migrationFiles(matcher: (name: string) => boolean): string[] {
  return readdirSync(join(process.cwd(), "drizzle/migrations")).filter(matcher).sort();
}
