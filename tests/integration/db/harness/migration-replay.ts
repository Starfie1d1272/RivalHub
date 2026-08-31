import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { localDatabaseUrl } from "./database";

export function localReplayDatabaseUrl(prefix: string): { maintenanceUrl: string; databaseUrl: string; databaseName: string } {
  const configured = localDatabaseUrl();
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
