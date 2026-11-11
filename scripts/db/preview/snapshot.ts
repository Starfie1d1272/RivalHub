import { parseOwnedPublicAssetUrl, parsePublicAssetReference } from "../../../src/lib/assets-reference";
import { OFFICIAL_PREVIEW, OFFICIAL_PRODUCTION } from "../../../src/lib/runtime/official-deployment-profile.mjs";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { assertActiveChainPrefix, readExpectedMigrations, type Migration } from "../production-preflight";
import { resolveProductionSourceIdentity } from "../recovery/source";
import {
  assertReviewedColumns,
  previewPolicyFor,
  sanitizedRequiredFields,
} from "./policy";
import { githubRunId, measureExportRows, reportOfflineConsumer, type OfflineConsumerSummary } from "../recovery/accounting";
import { assertProductionSupabaseUrl, PRODUCTION_PROJECT_REF } from "../recovery/environment";
import { assertRefreshRunner } from "./environment";
import { type PersonaCandidates } from "./personas";
import {
  PreviewMirrorError,
  previewProviderFailure,
  reportPreviewFailure,
  type PreviewExportPhase,
  wrapPreviewPhase,
} from "./diagnostics";

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

export async function runPreviewExportPhase<T>(phase: PreviewExportPhase, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw wrapPreviewPhase(phase, error);
  }
}

interface SourceProjection {
  format: number;
  sourceTag: string;
  sourceCommit: string;
  migrations: Migration[];
  columns: { table_name: string; column_name: string }[];
  tables: string[];
}

async function readSourceProjection(path: string, identity: Awaited<ReturnType<typeof resolveProductionSourceIdentity>>) {
  const file = createReadStream(path);
  const lines = createInterface({ input: file, crlfDelay: Infinity });
  const reader = lines[Symbol.asyncIterator]();
  try {
    const header = await runPreviewExportPhase("source identity", async () => {
      const { done, value } = await reader.next();
      if (done) throw new Error("Preview source projection is empty.");
      const projection: SourceProjection = JSON.parse(value);
      if (projection.format !== 1 || projection.sourceCommit !== identity.deployedCommit ||
          projection.sourceTag !== identity.deployedReleaseTag) {
        throw new Error("Preview source projection differs from the canonical deployment.");
      }
      return projection;
    });
    const migrations = await runPreviewExportPhase("migration ledger", async () => {
      if (!header.migrations.length) throw new Error("Preview source migration ledger is empty.");
      try {
        assertActiveChainPrefix(header.migrations, readExpectedMigrations());
      } catch (error) {
        throw new PreviewMirrorError("PREVIEW_MIGRATION_LEDGER_FAILED", "Preview source migration ledger is not an active chain prefix.", {
          cause: error, context: { phase: "migration ledger" },
        });
      }
      return header.migrations;
    });
    const names = await runPreviewExportPhase("schema inventory-policy", async () => {
      const policy = previewPolicyFor(migrations);
      const inventory = new Map<string, string[]>();
      for (const { table_name, column_name } of header.columns) {
        const columns = inventory.get(table_name);
        if (columns) columns.push(column_name);
        else inventory.set(table_name, [column_name]);
      }
      for (const [table, columns] of inventory) assertReviewedColumns(table, columns, policy);
      const expected = Object.keys(policy.tables).sort();
      if (header.tables.length !== expected.length || expected.some((name, index) => name !== header.tables[index] || !inventory.has(name))) {
        throw new PreviewMirrorError("MISSING_MIRROR_TABLE", "Preview source projection does not match the policy tables.", {
          context: { phase: "schema inventory-policy" },
        });
      }
      return expected;
    });
    const tables = await runPreviewExportPhase("table export", async () => {
      const result: MirrorSnapshot["tables"] = Object.fromEntries(names.map((name) => [name, []]));
      for (let line = await reader.next(); !line.done; line = await reader.next()) {
        const [table, row]: [string, Record<string, unknown>] = JSON.parse(line.value);
        if (!Object.hasOwn(result, table) || !row || typeof row !== "object" || Array.isArray(row)) {
          throw new Error("Unsupported Preview projection row.");
        }
        result[table].push(row);
      }
      return result;
    });
    return { migrations, tables };
  } finally {
    lines.close();
    file.destroy();
  }
}

async function exportMirror(sourcePath: string, accounting?: Pick<OfflineConsumerSummary, "tables" | "storage_download_bytes">): Promise<MirrorSnapshot> {
  assertRefreshRunner();
  const identity = await runPreviewExportPhase("source identity", () => resolveProductionSourceIdentity());
  const { migrations, tables } = await readSourceProjection(sourcePath, identity);
  if (accounting?.tables) {
    for (const [table, rows] of Object.entries(tables)) accounting.tables[table] = measureExportRows(rows);
  }
  const allowedSeasonAssets = new Set((process.env.RIVALHUB_PREVIEW_PUBLIC_ASSET_ALLOWLIST ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean));
  for (const row of tables.community_groups) {
    const path = typeof row.qr_image_path === "string" ? row.qr_image_path : null;
    if (path && allowedSeasonAssets.has(path)) continue;
    row.qr_image_path = null;
    if (row.status === "active" && !row.group_number && !row.join_url) row.status = "closed";
  }
  const personaCandidates = await runPreviewExportPhase("persona selection", async () => {
    try {
      return selectPersonaCandidates(tables);
    } catch (error) {
      throw new PreviewMirrorError("PREVIEW_PERSONA_SELECTION_FAILED", "Preview persona selection failed.", {
        cause: error,
        context: { phase: "persona selection" },
      });
    }
  });
  const assets = await runPreviewExportPhase("public asset export", async () => {
    try {
      return await exportPublicAssets(tables, allowedSeasonAssets, accounting);
    } catch (error) {
      if (error instanceof PreviewMirrorError) throw error;
      throw new PreviewMirrorError("PREVIEW_ASSET_EXPORT_FAILED", "Preview public asset export failed.", {
        cause: error,
        context: { phase: "public asset export" },
      });
    }
  });
  rewriteTeamLogoUrls(tables);
  return { format: 2, sourceCommit: identity.deployedCommit, sourceTag: identity.deployedReleaseTag,
    refreshedAt: new Date().toISOString(), migrations, personaCandidates, assets, tables };
}

function rewriteTeamLogoUrls(tables: MirrorSnapshot["tables"]): void {
  for (const row of [...tables.teams, ...tables.competition_entries]) {
    if (typeof row.logo_url !== "string") continue;
    const ref = parsePublicStorageUrl(row.logo_url);
    if (ref?.bucket !== "team-logos") continue;
    const encoded = ref.path.split("/").map(encodeURIComponent).join("/");
    row.logo_url = `${OFFICIAL_PREVIEW.supabaseUrl}/storage/v1/object/public/team-logos/${encoded}`;
  }
}

function selectPersonaCandidates(tables: MirrorSnapshot["tables"]): PersonaCandidates {
  const current = [...tables.seasons].sort((a, b) => {
    const rank = (status: unknown) => ({ playing: 0, drafting: 1, voting: 2, registration: 3 } as Record<string, number>)[String(status)] ?? 9;
    return rank(a.status) - rank(b.status) || String(b.registration_opened_at ?? b.updated_at ?? "").localeCompare(String(a.registration_opened_at ?? a.updated_at ?? "")) || String(a.id).localeCompare(String(b.id));
  })[0];
  const seasonId = current ? String(current.id) : null;
  const active = tables.users.filter((user) => user.status === "active").map((user) => String(user.id)).sort();
  const currentEntries = new Set(tables.competition_entries.filter((entry) => !seasonId || String(entry.competition_id ?? "") === seasonId).map((entry) => String(entry.id)));
  const participant = tables.competition_entry_participants.filter((row) => currentEntries.has(String(row.entry_id)) && row.status === "confirmed").map((row) => String(row.user_id)).sort()[0] ?? null;
  const invited = tables.competition_entry_participants.filter((row) => currentEntries.has(String(row.entry_id)) && row.status === "invited").map((row) => String(row.user_id)).sort()[0] ?? null;
  const currentTeamIds = new Set(tables.competition_entries
    .filter((entry) => seasonId && String(entry.competition_id) === seasonId && entry.team_id)
    .map((entry) => String(entry.team_id)));
  const captain = tables.teams.filter((team) => currentTeamIds.has(String(team.id)) && team.status !== "disbanded" && active.includes(String(team.captain_user_id))).map((team) => String(team.captain_user_id)).sort()[0]
    ?? tables.teams.filter((team) => active.includes(String(team.captain_user_id))).map((team) => String(team.captain_user_id)).sort()[0] ?? null;
  return {
    currentSeasonId: seasonId,
    playerUserId: participant,
    invitedUserId: invited,
    captainUserId: captain,
    seasonAdminUserId: null,
    superAdminUserId: null,
  };
}

async function exportPublicAssets(tables: MirrorSnapshot["tables"], allowlistedSeasonAssets: Set<string>, accounting?: Pick<OfflineConsumerSummary, "storage_download_bytes">): Promise<MirrorAsset[]> {
  if (accounting) accounting.storage_download_bytes = 0;
  const supabaseUrl = assertProductionSupabaseUrl(process.env.RIVALHUB_PRODUCTION_SUPABASE_URL ?? OFFICIAL_PRODUCTION.supabaseUrl);
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
    if (pathParts.some((part) => !part || part === "." || part === "..")) throw new Error("Invalid public asset path.");
    const assetUrl = new URL(`/storage/v1/object/public/${bucket}/${pathParts.map(encodeURIComponent).join("/")}`, supabaseUrl);
    let response: Response;
    try {
      response = await fetch(assetUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      throw previewProviderFailure("public asset export", error, { count: assets.length });
    }
    if (!response.ok) throw previewProviderFailure("public asset export", { status: response.status }, { count: assets.length });
    const bytes = await readPublicAsset(response, Math.min(MAX_ASSET_BYTES, MAX_ASSET_TOTAL_BYTES - total));
    const contentType = response.headers.get("content-type")?.split(";", 1)[0] ?? "application/octet-stream";
    if (!/^(image\/(?:png|jpe?g|webp)|application\/pdf)$/i.test(contentType)) throw new Error("Preview mirror rejected non-public asset type.");
    assets.push({ bucket: bucket as MirrorAsset["bucket"], path, contentType, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes.toString("base64") });
    total += bytes.length;
    if (accounting) accounting.storage_download_bytes = total;
  }
  return assets;
}

async function readPublicAsset(response: Response, limit: number): Promise<Buffer> {
  if (!response.body || Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new Error("Preview public asset exceeds bounded size.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new Error("Preview public asset exceeds bounded size.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

function parsePublicStorageUrl(value: string): { bucket: MirrorAsset["bucket"]; path: string } | null {
  try {
    const ref = parsePublicAssetReference(value) ?? parseOwnedPublicAssetUrl(value);
    return ref ? { bucket: ref.bucket as MirrorAsset["bucket"], path: ref.path } : null;
  } catch { return null; }
}

function assertSanitizedTeamMembership(row: Record<string, unknown>): void {
  if (!Object.hasOwn(row, "status") || !Object.hasOwn(row, "ended_at") || !Object.hasOwn(row, "ended_reason")) throwInvalidMembership();
  const ended = row.ended_at !== null;
  const endedReason = row.ended_reason;
  if (endedReason !== null && endedReason !== "left") throwInvalidMembership();
  const activeStatus = row.status === "active" || row.status === "benched";
  if ((ended && (row.status !== "left" || endedReason !== "left"))
    || (!ended && (!activeStatus || endedReason !== null))) throwInvalidMembership();
}

function throwInvalidMembership(): never {
  throw new PreviewMirrorError("PREVIEW_SNAPSHOT_INVALID", "Preview mirror membership row failed sanitization.", {
    context: { phase: "snapshot read", table: "team_memberships", column: "ended_reason" },
  });
}

export function readSnapshot(path: string): MirrorSnapshot {
  try {
    return readSnapshotUnsafe(path);
  } catch (error) {
    if (error instanceof PreviewMirrorError) throw error;
    throw new PreviewMirrorError("PREVIEW_SNAPSHOT_INVALID", "Preview mirror snapshot is invalid.", {
      cause: error,
      context: { phase: "snapshot read" },
    });
  }
}

function readSnapshotUnsafe(path: string): MirrorSnapshot {
  const snapshot = JSON.parse(readFileSync(path, "utf8")) as MirrorSnapshot;
  if (snapshot.format !== 2 || !/^[a-f0-9]{40}$/.test(snapshot.sourceCommit)
    || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(snapshot.sourceTag)
    || !Number.isFinite(Date.parse(snapshot.refreshedAt))) throw new Error("Invalid mirror manifest.");
  const policy = previewPolicyFor(snapshot.migrations);
  if (!snapshot.migrations.length || JSON.stringify(Object.keys(snapshot.tables).sort()) !== JSON.stringify(Object.keys(policy.tables).sort())) throw new Error("Invalid mirror table inventory.");
  if (!Array.isArray(snapshot.assets) || !snapshot.personaCandidates) throw new Error("Invalid mirror identity metadata.");
  for (const asset of snapshot.assets) {
    if (!PUBLIC_BUCKETS.has(asset.bucket) || !asset.path || asset.path.includes("..") || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid public mirror asset.");
    const bytes = Buffer.from(asset.data, "base64");
    if (bytes.length > MAX_ASSET_BYTES || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Corrupt public mirror asset.");
  }
  const publicRecipientAwardIds = new Set(snapshot.tables.community_awards
    .filter((award) => award.status === "awarded").map((award) => award.id));
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    const tablePolicy = policy.tables[table];
    if (!tablePolicy) throw new Error("Snapshot contains a table outside the source policy.");
    const allowed = new Set([...tablePolicy.exportedColumns, ...Object.keys(sanitizedRequiredFields(table, {}))]);
    if (table === "users") ["email", "role", "auth_id", "email_verified_at", "email_verification_source"].forEach((key) => allowed.add(key));
    if (table === "season_registrations") allowed.add("screenshot_urls");
    if (table === "team_memberships") allowed.add("ended_reason");
    if (["post_event_adjudications", "tournament_honors"].includes(table)) allowed.add("client_request_id");
    if (!Array.isArray(rows)) throw new Error("Invalid mirror rows.");
    for (const row of rows) {
      if (!row || Object.keys(row).some((key) => !allowed.has(key))) throw new Error(`Unexpected mirror field: ${table}`);
      for (const [column, expected] of Object.entries(sanitizedRequiredFields(table, row))) {
        if (row[column] !== expected || (table === "competition_qualification_runs" && !Object.hasOwn(row, "started_at"))) {
          throw new PreviewMirrorError("PREVIEW_SNAPSHOT_INVALID", "Preview mirror required field failed sanitization.", {
            context: { phase: "snapshot read", table, column },
          });
        }
      }
      if (table === "community_award_recipients" && !publicRecipientAwardIds.has(row.award_id)) {
        throw new PreviewMirrorError("PREVIEW_SNAPSHOT_INVALID", "Award recipient is outside a public awarded outcome.", {
          context: { phase: "snapshot read", table },
        });
      }
      if (table === "disciplinary_cases" && (!["active", "expired", "revoked"].includes(String(row.status))
        || !Number.isFinite(Date.parse(String(row.effective_from)))
        || Date.parse(String(row.effective_from)) > Date.parse(snapshot.refreshedAt)
        || !snapshot.tables.seasons.some((season) => season.id === row.season_id && season.status !== "draft"))) {
        throw new PreviewMirrorError("PREVIEW_SNAPSHOT_INVALID", "Discipline record is outside a public effective outcome.", {
          context: { phase: "snapshot read", table },
        });
      }
      if (table === "seasons" && row.status === "draft") throw new Error("Draft event in mirror.");
      if (table === "users" && (row.email !== `${row.id}@preview.invalid` || row.role !== "user" || row.auth_id || row.email_verified_at)) throw new Error("Unsanitized mirror identity.");
      if (table === "education_verifications"
        || (table === "event_roster_members" && row.education_verification_id != null)) throw new Error("Education verification in mirror.");
      if (table === "dak_pairing_intents" && (row.status !== "expired" || row.poll_token_hash !== `preview:${row.id}`
        || row.authorized_by_user_id !== null || row.authorized_at !== null || row.delivered_at !== null)) {
        throw new Error("Unsanitized DAK pairing intent in mirror.");
      }
      if (table === "dak_pairings" && (row.status !== "revoked" || row.token_hash !== `preview:${row.id}`
        || !row.revoked_at || row.revoked_at !== row.created_at || row.last_used_at !== null
        || JSON.stringify(row.scopes) !== "[]" || JSON.stringify(row.season_ids) !== "[]")) {
        throw new Error("Unsanitized DAK pairing in mirror.");
      }
      if (table === "season_registrations" && JSON.stringify(row.screenshot_urls) !== "[]") throw new Error("Private screenshot in mirror.");
      if (table === "team_memberships") assertSanitizedTeamMembership(row);
      if (table === "community_groups" && row.qr_image_path && !String(row.qr_image_path).startsWith("public/")) throw new Error("Private group QR leaked into mirror.");
    }
  }
  return snapshot;
}

export function writeMirrorSnapshot(path: string, snapshot: MirrorSnapshot): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(snapshot), { mode: 0o600, flag: "wx" });
  } catch (error) {
    throw new PreviewMirrorError("PREVIEW_SNAPSHOT_WRITE_FAILED", "Preview mirror snapshot write failed.", {
      cause: error,
      context: { phase: "snapshot write" },
    });
  }
}

if (process.argv[1]?.endsWith("preview/snapshot.ts")) {
  const startedAt = new Date().toISOString();
  const accounting: Pick<OfflineConsumerSummary, "tables" | "storage_download_bytes"> = { tables: {}, storage_download_bytes: null };
  exportMirror(process.argv[3], accounting).then((snapshot) => {
    return runPreviewExportPhase("snapshot write", async () => writeMirrorSnapshot(process.argv[2], snapshot)).then(() => {
      const tables = accounting.tables!;
      reportOfflineConsumer({
        format: 1, consumer: "preview", run_id: githubRunId(), github_run_id: githubRunId(),
        release: snapshot.sourceTag, source_project: PRODUCTION_PROJECT_REF,
        started_at: startedAt, ended_at: new Date().toISOString(), status: "exported",
        rows: Object.values(tables).reduce((sum, table) => sum + table.rows, 0),
        logical_payload_bytes: Object.values(tables).reduce((sum, table) => sum + table.logical_payload_bytes, 0),
        dump_file_bytes: null, snapshot_file_bytes: statSync(process.argv[2]).size,
        compressed_artifact_bytes: null, storage_download_bytes: accounting.storage_download_bytes,
        storage_objects: accounting.storage_download_bytes === null ? null : snapshot.assets.length, tables,
      });
      console.log(`Mirror export verified: source=${snapshot.sourceTag} commit=${snapshot.sourceCommit} tables=${Object.keys(snapshot.tables).length} assets=${snapshot.assets.length}`);
    });
  }).catch((error: unknown) => {
    reportPreviewFailure("preview.mirror.export_failed", error, { operation: "export" });
    process.exitCode = 1;
  });
}
