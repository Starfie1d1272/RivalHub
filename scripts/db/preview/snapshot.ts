import { readFileSync, writeFileSync } from "node:fs";
import { Pool } from "pg";
import { assertActiveChainPrefix, readExpectedMigrations, type Migration } from "../production-preflight";
import { resolveProductionSourceIdentity } from "../recovery/source";
import { assertReviewedColumns, exportQuery, PREVIEW_COLUMNS } from "./policy";
import { sourceDatabaseUrl } from "./environment";

export interface MirrorSnapshot {
  format: 1;
  sourceCommit: string;
  sourceTag: string;
  refreshedAt: string;
  migrations: Migration[];
  tables: Record<string, Record<string, unknown>[]>;
}

export async function exportMirror(): Promise<MirrorSnapshot> {
  const databaseUrl = sourceDatabaseUrl();
  const identity = await resolveProductionSourceIdentity();
  const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false }, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const ledger = await client.query("SELECT hash, created_at::text AS when FROM drizzle.__drizzle_migrations ORDER BY created_at");
    const migrations = ledger.rows.map((row) => ({ hash: String(row.hash), when: Number(row.when) }));
    assertActiveChainPrefix(migrations, readExpectedMigrations());
    if (!migrations.length) throw new Error("Source migration ledger is empty.");
    const catalog = await client.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position",
    );
    const inventory = new Map<string, string[]>();
    for (const row of catalog.rows) inventory.set(row.table_name, [...(inventory.get(row.table_name) ?? []), row.column_name]);
    for (const [table, columns] of inventory) assertReviewedColumns(table, columns);
    const tables: MirrorSnapshot["tables"] = {};
    for (const table of Object.keys(PREVIEW_COLUMNS)) {
      if (!inventory.has(table)) throw new Error(`Source mirror table missing: ${table}`);
      tables[table] = (await client.query(exportQuery(table))).rows;
    }
    // Filtered education evidence cannot leave dangling optional references.
    const education = new Set(tables.education_verifications.map((row) => row.id));
    for (const row of tables.event_roster_members) if (!education.has(row.education_verification_id)) row.education_verification_id = null;
    await client.query("ROLLBACK");
    return { format: 1, sourceCommit: identity.deployedCommit, sourceTag: identity.deployedReleaseTag,
      refreshedAt: new Date().toISOString(), migrations, tables };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}

export function readSnapshot(path: string): MirrorSnapshot {
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as MirrorSnapshot;
  if (snapshot.format !== 1 || !/^[a-f0-9]{40}$/.test(snapshot.sourceCommit)
    || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(snapshot.sourceTag)
    || !Number.isFinite(Date.parse(snapshot.refreshedAt))) throw new Error("Invalid mirror manifest.");
  assertActiveChainPrefix(snapshot.migrations, readExpectedMigrations());
  if (!snapshot.migrations.length || JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(Object.keys(PREVIEW_COLUMNS).sort())) {
    throw new Error("Invalid mirror table inventory.");
  }
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const allowed = new Set(PREVIEW_COLUMNS[table].split(" "));
    if (table === "users") ["email", "role"].forEach((key) => allowed.add(key));
    if (table === "season_registrations") allowed.add("screenshot_urls");
    if (["post_event_adjudications", "tournament_honors"].includes(table)) allowed.add("client_request_id");
    if (table === "post_event_adjudications") allowed.add("reason");
    if (!Array.isArray(rows)) throw new Error("Invalid mirror rows.");
    for (const row of rows) {
      if (!row || Object.keys(row).some((key) => !allowed.has(key))) throw new Error(`Unexpected mirror field: ${table}`);
      if (table === "users" && (row.email !== `${row.id}@preview.invalid` || row.role !== "user")) throw new Error("Unsanitized mirror identity.");
      if (table === "season_registrations" && JSON.stringify(row.screenshot_urls) !== "[]") throw new Error("Private screenshot in mirror.");
    }
  }
  return snapshot;
}

if (process.argv[1]?.endsWith("preview/snapshot.ts")) {
  exportMirror().then((snapshot) => {
    writeFileSync(process.argv[2], JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
    console.log(`Mirror export verified: source=${snapshot.sourceTag} commit=${snapshot.sourceCommit} tables=${Object.keys(snapshot.tables).length}`);
  }).catch(() => { console.error("Mirror export failed; no raw source data or provider error is logged."); process.exitCode = 1; });
}
