import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Pool, type PoolClient } from "pg";
import { createClient } from "@supabase/supabase-js";
import { assertActiveChainPrefix, readExpectedMigrations, type Migration } from "../production-preflight";
import { resolveProductionSourceIdentity } from "../recovery/source";
import { assertReviewedColumns, exportQuery, PREVIEW_COLUMNS } from "./policy";
import { sourceDatabaseUrl } from "./environment";
import { type PersonaCandidates } from "./personas";

export type MirrorAsset = {
  bucket: "team-logos" | "season-public-assets";
  path: string;
  contentType: string;
  sha256: string;
  data: string;
};

export interface MirrorSnapshot {
  format: 2;
  sourceCommit: string;
  sourceTag: string;
  refreshedAt: string;
  migrations: Migration[];
  personaCandidates: PersonaCandidates;
  assets: MirrorAsset[];
  tables: Record<string, Record<string, unknown>[]>;
}

const MAX_ASSET_BYTES = 1024 * 1024;
const MAX_ASSET_TOTAL_BYTES = 32 * 1024 * 1024;
const PUBLIC_BUCKETS = new Set<MirrorAsset["bucket"]>(["team-logos", "season-public-assets"]);

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
    const education = new Set(tables.education_verifications.map((row) => row.id));
    for (const row of tables.event_roster_members) if (row.education_verification_id && !education.has(row.education_verification_id)) row.education_verification_id = null;
    const allowedSeasonAssets = new Set((process.env.RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST ?? "")
      .split(",").map((value) => value.trim()).filter(Boolean));
    for (const row of tables.community_groups) {
      const path = typeof row.qr_image_path === "string" ? row.qr_image_path : null;
      if (path && allowedSeasonAssets.has(path)) continue;
      row.qr_image_path = null;
      if (row.status === "active" && !row.group_number && !row.join_url) row.status = "closed";
    }
    const personaCandidates = await selectPersonaCandidates(client, tables);
    const assets = await exportPublicAssets(tables, allowedSeasonAssets);
    rewriteTeamLogoUrls(tables);
    await client.query("ROLLBACK");
    return { format: 2, sourceCommit: identity.deployedCommit, sourceTag: identity.deployedReleaseTag,
      refreshedAt: new Date().toISOString(), migrations, personaCandidates, assets, tables };
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
    await pool.end();
  }
}

function rewriteTeamLogoUrls(tables: MirrorSnapshot["tables"]): void {
  for (const row of [...tables.teams, ...tables.competition_entries]) {
    if (typeof row.logo_url !== "string") continue;
    const ref = parsePublicStorageUrl(row.logo_url);
    if (ref?.bucket !== "team-logos") continue;
    const encoded = ref.path.split("/").map(encodeURIComponent).join("/");
    row.logo_url = `https://cueazphyskstwdhnzsxx.supabase.co/storage/v1/object/public/team-logos/${encoded}`;
  }
}

async function selectPersonaCandidates(client: PoolClient, tables: MirrorSnapshot["tables"]): Promise<PersonaCandidates> {
  const current = [...tables.seasons].sort((a, b) => {
    const rank = (status: unknown) => ({ playing: 0, drafting: 1, voting: 2, registration: 3 } as Record<string, number>)[String(status)] ?? 9;
    return rank(a.status) - rank(b.status) || String(b.registration_opened_at ?? b.updated_at ?? "").localeCompare(String(a.registration_opened_at ?? a.updated_at ?? "")) || String(a.id).localeCompare(String(b.id));
  })[0];
  const seasonId = current ? String(current.id) : null;
  const active = tables.users.filter((user) => user.status === "active").map((user) => String(user.id)).sort();
  const currentEntries = new Set(tables.competition_entries.filter((entry) => !seasonId || String(entry.competition_id ?? "") === seasonId).map((entry) => String(entry.id)));
  const participant = tables.competition_entry_participants.filter((row) => currentEntries.has(String(row.entry_id)) && row.status === "confirmed").map((row) => String(row.user_id)).sort()[0] ?? null;
  const invited = tables.competition_entry_participants.filter((row) => currentEntries.has(String(row.entry_id)) && row.status === "invited").map((row) => String(row.user_id)).sort()[0] ?? null;
  const captain = tables.teams.filter((team) => team.status !== "disbanded" && active.includes(String(team.captain_user_id)) && currentEntries.size > 0).map((team) => String(team.captain_user_id)).sort()[0]
    ?? tables.teams.filter((team) => active.includes(String(team.captain_user_id))).map((team) => String(team.captain_user_id)).sort()[0] ?? null;
  const seasonAdmin = active.find((id) => tables.users.some((user) => String(user.id) === id && user.role === "super_admin")) ?? null;
  const superAdmin = seasonAdmin;
  return { currentSeasonId: seasonId, playerUserId: participant, invitedUserId: invited, captainUserId: captain, seasonAdminUserId: seasonAdmin, superAdminUserId: superAdmin };
}

async function exportPublicAssets(tables: MirrorSnapshot["tables"], allowlistedSeasonAssets: Set<string>): Promise<MirrorAsset[]> {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) return [];
  const supabaseUrl = process.env.RIVALHUB_PRODUCTION_SUPABASE_URL ?? "https://sucokfotkypwqkckfynp.supabase.co";
  const client = createClient(supabaseUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const refs = new Map<string, MirrorAsset["bucket"]>();
  for (const row of [...tables.teams, ...tables.competition_entries]) {
    if (typeof row.logo_url !== "string") continue;
    const ref = parsePublicStorageUrl(row.logo_url);
    if (ref?.bucket === "team-logos") refs.set(`${ref.bucket}/${ref.path}`, ref.bucket);
  }
  for (const path of allowlistedSeasonAssets) refs.set(`season-public-assets/${path}`, "season-public-assets");
  const assets: MirrorAsset[] = [];
  let total = 0;
  for (const key of [...refs.keys()].sort()) {
    const [bucket, ...pathParts] = key.split("/");
    if (!PUBLIC_BUCKETS.has(bucket as MirrorAsset["bucket"])) continue;
    const path = pathParts.join("/");
    const result = await client.storage.from(bucket).download(path);
    if (result.error) throw new Error("Public mirror asset export failed.");
    const bytes = Buffer.from(await result.data.arrayBuffer());
    if (bytes.length > MAX_ASSET_BYTES || total + bytes.length > MAX_ASSET_TOTAL_BYTES) throw new Error("Preview public asset mirror exceeds bounded size.");
    const contentType = result.data.type || "application/octet-stream";
    if (!/^(image\/(?:png|jpe?g|webp)|application\/pdf)$/i.test(contentType)) throw new Error("Preview mirror rejected non-public asset type.");
    assets.push({ bucket: bucket as MirrorAsset["bucket"], path, contentType, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") });
    total += bytes.length;
  }
  return assets;
}

function parsePublicStorageUrl(value: string): { bucket: MirrorAsset["bucket"]; path: string } | null {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/\/storage\/v1\/object\/public\/(team-logos|season-public-assets)\/(.+)$/);
    if (!match) return null;
    return { bucket: match[1] as MirrorAsset["bucket"], path: decodeURIComponent(match[2]) };
  } catch { return null; }
}

export function readSnapshot(path: string): MirrorSnapshot {
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as MirrorSnapshot;
  if (snapshot.format !== 2 || !/^[a-f0-9]{40}$/.test(snapshot.sourceCommit)
    || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(snapshot.sourceTag)
    || !Number.isFinite(Date.parse(snapshot.refreshedAt))) throw new Error("Invalid mirror manifest.");
  assertActiveChainPrefix(snapshot.migrations, readExpectedMigrations());
  if (!snapshot.migrations.length || JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(Object.keys(PREVIEW_COLUMNS).sort())) throw new Error("Invalid mirror table inventory.");
  if (!Array.isArray(snapshot.assets) || !snapshot.personaCandidates) throw new Error("Invalid mirror identity metadata.");
  for (const asset of snapshot.assets) {
    if (!PUBLIC_BUCKETS.has(asset.bucket) || !asset.path || asset.path.includes("..") || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid public mirror asset.");
    const bytes = Buffer.from(asset.data, "base64");
    if (bytes.length > MAX_ASSET_BYTES || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Corrupt public mirror asset.");
  }
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const allowed = new Set(PREVIEW_COLUMNS[table].split(" "));
    if (table === "users") ["email", "role", "auth_id", "email_verified_at", "email_verification_source"].forEach((key) => allowed.add(key));
    if (table === "season_registrations") allowed.add("screenshot_urls");
    if (["post_event_adjudications", "tournament_honors"].includes(table)) allowed.add("client_request_id");
    if (table === "post_event_adjudications") allowed.add("reason");
    if (!Array.isArray(rows)) throw new Error("Invalid mirror rows.");
    for (const row of rows) {
      if (!row || Object.keys(row).some((key) => !allowed.has(key))) throw new Error(`Unexpected mirror field: ${table}`);
      if (table === "users" && (row.email !== `${row.id}@preview.invalid` || row.role !== "user" || row.auth_id || row.email_verified_at)) throw new Error("Unsanitized mirror identity.");
      if (table === "season_registrations" && JSON.stringify(row.screenshot_urls) !== "[]") throw new Error("Private screenshot in mirror.");
      if (table === "community_groups" && row.qr_image_path && !String(row.qr_image_path).startsWith("public/")) throw new Error("Private group QR leaked into mirror.");
    }
  }
  return snapshot;
}

if (process.argv[1]?.endsWith("preview/snapshot.ts")) {
  exportMirror().then((snapshot) => {
    mkdirSync(dirname(process.argv[2]), { recursive: true });
    writeFileSync(process.argv[2], JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
    console.log(`Mirror export verified: source=${snapshot.sourceTag} commit=${snapshot.sourceCommit} tables=${Object.keys(snapshot.tables).length} assets=${snapshot.assets.length}`);
  }).catch(() => { console.error("Mirror export failed; no raw source data or provider error is logged."); process.exitCode = 1; });
}
