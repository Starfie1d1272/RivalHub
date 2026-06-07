import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { PlayerIdentityMap } from "@cs2dak/cohort";
import { loadDemoPackageFromZip } from "@cs2dak/core";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { Pool } from "pg";
import { buildDakMatchArtifactsFromPackage, buildDakSeasonArtifacts } from "../src/lib/demo/dak";
import { buildMatchWorkspaceModel } from "@cs2dak/presentation";

const ZIP_DIR = process.env.DAK_ZIP_DIR
  ?? "/Users/starfie1d/GitHub/cs2-demo-analysis-kit/fixtures/output/nju-rivals-2026";
const BUCKET = "demo-imports";
const execute = process.argv.includes("--execute");
const cleanup = process.argv.includes("--cleanup");

interface Candidate {
  seasonId: string;
  seasonSlug: string;
  mapId: string | null;
  matchId: string;
  mapName: string;
  scoreA: number;
  scoreB: number;
  completedDate: string | null;
  teamAName: string;
  teamBName: string;
  demoHashes: string[];
  teamAPlayers: string[];
  teamBPlayers: string[];
}

interface ZipInfo {
  path: string;
  fileName: string;
  buffer: Buffer;
  manifest: Record<string, unknown> & {
    schemaVersion: string;
    mapName: string;
    tickrate: number;
    exportedAt?: string;
    demo?: { hash?: string };
    exporter?: { name?: string; version?: string };
    parser?: { name?: string };
  };
  match: {
    teamA: { name: string; score: number };
    teamB: { name: string; score: number };
  };
  steamIds: string[];
  candidate: Candidate;
}

function normalizeName(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll("車", "车")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function sameTeam(actual: string, expected: string) {
  const a = normalizeName(actual);
  const e = normalizeName(expected);
  return a === e || a.includes(e) || e.includes(a);
}

function dateFromFileName(fileName: string) {
  return fileName.match(/^(\d{4}-\d{2}-\d{2})_/)?.[1] ?? null;
}

function matchCandidates(info: Omit<ZipInfo, "candidate">, candidates: Candidate[]) {
  const demoHash = info.manifest.demo?.hash;
  const byHash = demoHash ? candidates.filter((candidate) => candidate.demoHashes.includes(demoHash)) : [];
  if (byHash.length === 1) return byHash;
  const byTeams = candidates.filter((candidate) => {
    if (candidate.mapId && candidate.mapName !== info.manifest.mapName) return false;
    const direct = sameTeam(candidate.teamAName, info.match.teamA.name) && sameTeam(candidate.teamBName, info.match.teamB.name);
    const reverse = sameTeam(candidate.teamAName, info.match.teamB.name) && sameTeam(candidate.teamBName, info.match.teamA.name);
    return direct || reverse;
  });
  if (byTeams.length === 1) return byTeams;
  const date = dateFromFileName(info.fileName);
  const byDate = byTeams.filter((candidate) => candidate.completedDate === date);
  if (byDate.length === 1) return byDate;
  if (date && byTeams.length > 1) {
    const target = Date.parse(`${date}T00:00:00Z`);
    const ranked = byTeams
      .filter((candidate) => candidate.completedDate)
      .map((candidate) => ({
        candidate,
        distance: Math.abs(Date.parse(`${candidate.completedDate}T00:00:00Z`) - target),
      }))
      .sort((a, b) => a.distance - b.distance);
    if (ranked[0] && ranked[0].distance <= 3 * 86_400_000 && ranked[0].distance < (ranked[1]?.distance ?? Infinity)) {
      return [ranked[0].candidate];
    }
  }
  const byScore = byDate.filter((candidate) => {
    const directScore = candidate.scoreA === info.match.teamA.score && candidate.scoreB === info.match.teamB.score;
    const reverseScore = candidate.scoreA === info.match.teamB.score && candidate.scoreB === info.match.teamA.score;
    return directScore || reverseScore;
  });
  if (byScore.length === 1) return byScore;
  const steamIds = new Set(info.steamIds);
  return candidates.filter((candidate) => {
    if (candidate.mapId && candidate.mapName !== info.manifest.mapName) return false;
    const roster = new Set([...candidate.teamAPlayers, ...candidate.teamBPlayers]);
    return [...steamIds].filter((steamId) => roster.has(steamId)).length >= 6;
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 未配置");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const candidateResult = await pool.query<Candidate>(`
      SELECT
        s.id AS "seasonId",
        s.slug AS "seasonSlug",
        mm.id AS "mapId",
        m.id AS "matchId",
        mm.map_name AS "mapName",
        COALESCE(mm.score_a, 0) AS "scoreA",
        COALESCE(mm.score_b, 0) AS "scoreB",
        to_char(COALESCE(mm.completed_at, m.completed_at, m.scheduled_at) AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD') AS "completedDate",
        ta.name AS "teamAName",
        tb.name AS "teamBName",
        COALESCE(array_agg(DISTINCT di.demo_hash) FILTER (WHERE di.demo_hash IS NOT NULL), '{}') AS "demoHashes",
        ARRAY(
          SELECT DISTINCT u.steam64 FROM team_members tm
          JOIN season_registrations sr ON sr.id = tm.registration_id
          JOIN users u ON u.id = sr.user_id
          WHERE tm.team_id = m.team_a_id AND u.steam64 IS NOT NULL
        ) AS "teamAPlayers",
        ARRAY(
          SELECT DISTINCT u.steam64 FROM team_members tm
          JOIN season_registrations sr ON sr.id = tm.registration_id
          JOIN users u ON u.id = sr.user_id
          WHERE tm.team_id = m.team_b_id AND u.steam64 IS NOT NULL
        ) AS "teamBPlayers"
      FROM matches m
      LEFT JOIN match_maps mm ON mm.match_id = m.id
      JOIN seasons s ON s.id = m.season_id
      JOIN teams ta ON ta.id = m.team_a_id
      JOIN teams tb ON tb.id = m.team_b_id
      LEFT JOIN demo_imports di ON di.map_id = mm.id
      WHERE m.status <> 'cancelled'
      GROUP BY s.id, s.slug, mm.id, m.id, ta.name, tb.name
    `);
    const candidates = candidateResult.rows;
    const files = (await readdir(ZIP_DIR)).filter((file) => file.endsWith(".zip")).sort();
    const zips: ZipInfo[] = [];
    const failures: string[] = [];

    for (const fileName of files) {
      const path = join(ZIP_DIR, fileName);
      const buffer = await readFile(path);
      const zip = await JSZip.loadAsync(buffer);
      const manifestFile = zip.file("manifest.json");
      const matchFile = zip.file("match.json");
      const playersFile = zip.file("players.json");
      if (!manifestFile || !matchFile || !playersFile) {
        failures.push(`${fileName}: 缺少 manifest.json、match.json 或 players.json`);
        continue;
      }
      const manifest = JSON.parse(await manifestFile.async("string")) as ZipInfo["manifest"];
      const match = JSON.parse(await matchFile.async("string")) as ZipInfo["match"];
      const players = JSON.parse(await playersFile.async("string")) as Array<{ steamId64: string }>;
      const base = { path, fileName, buffer, manifest, match, steamIds: players.map((player) => player.steamId64) };
      const matched = matchCandidates(base, candidates);
      if (matched.length !== 1) {
        const date = dateFromFileName(fileName);
        const nearby = candidates
          .filter((candidate) => (!candidate.mapId || candidate.mapName === manifest.mapName) && candidate.completedDate === date)
          .map((candidate) => `${candidate.teamAName} vs ${candidate.teamBName} ${candidate.scoreA}:${candidate.scoreB}`)
          .join(" | ");
        const matchedDetail = matched.map((candidate) =>
          `${candidate.matchId}/${candidate.mapId ?? "无图"} ${candidate.teamAName} vs ${candidate.teamBName} ${candidate.completedDate ?? "无日期"}`,
        ).join(" | ");
        failures.push(`${fileName}: 匹配到 ${matched.length} 张地图；命中=${matchedDetail || "无"}；同日同图候选=${nearby || "无"}`);
        continue;
      }
      zips.push({ ...base, candidate: matched[0] });
    }

    const mapIds = zips.map((zip) => zip.candidate.mapId).filter((mapId): mapId is string => mapId !== null);
    const duplicateMaps = [...new Set(mapIds.filter((mapId, index, all) => all.indexOf(mapId) !== index))];
    console.log(`ZIP=${files.length} 唯一匹配=${zips.length} 失败=${failures.length} 重复地图=${duplicateMaps.length}`);
    for (const failure of failures) console.error(failure);
    if (duplicateMaps.length > 0) console.error("重复 mapId:", duplicateMaps);
    if (failures.length > 0 || duplicateMaps.length > 0 || zips.length !== files.length) {
      throw new Error("dry-run 未通过，拒绝执行写入");
    }

    const artifacts = [];
    for (const [index, zip] of zips.entries()) {
      const parsed = { manifest: zip.manifest };
      const dak = buildDakMatchArtifactsFromPackage(await loadDemoPackageFromZip(zip.buffer));
      artifacts.push({ zip, parsed, dak });
      console.log(`[${index + 1}/${zips.length}] ${basename(zip.path)} workspace=${Math.round(JSON.stringify(dak.workspace).length / 1024)}KB`);
    }
    console.log("所有 ZIP 均通过 cs2-demo-format/2.0 + DAK 分析。");
    if (!execute) {
      console.log("dry-run 完成；确认无误后使用 --execute 写入。");
      return;
    }

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase Service Role 环境变量未配置");
    }
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: bucket } = await supabase.storage.getBucket(BUCKET);
    if (!bucket) {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
      if (error) throw error;
    }

    // Phase 1: 上传所有 ZIP 和 workspace JSON 到 Storage（无事务）
    for (const [index, artifact] of artifacts.entries()) {
      const { zip, parsed } = artifact;
      const demoHash = parsed.manifest.demo?.hash ?? "";
      if (!zip.candidate.mapId) {
        // resolve mapId via a short-lived query
        const mapRow = await pool.query<{ id: string }>(`
          INSERT INTO match_maps (
            match_id, map_order, map_name, score_a, score_b, completed_at
          ) VALUES (
            $1,
            (SELECT COALESCE(max(map_order), 0) + 1 FROM match_maps WHERE match_id = $1),
            $2, $3, $4, now()
          )
          RETURNING id
        `, [
          zip.candidate.matchId,
          parsed.manifest.mapName,
          zip.match.teamA.score,
          zip.match.teamB.score,
        ]);
        zip.candidate.mapId = mapRow.rows[0].id;
      }
      const mapId = zip.candidate.mapId;
      const objectPath = `${zip.candidate.seasonId}/${mapId}/${demoHash}.zip`;
      const workspacePath = `${zip.candidate.seasonId}/${mapId}/${demoHash}-workspace.json`;
      const fullWorkspace = buildMatchWorkspaceModel(artifact.dak.pkg);
      const [zipUpload, wsUpload] = await Promise.all([
        supabase.storage.from(BUCKET).upload(objectPath, zip.buffer, {
          contentType: "application/zip",
          upsert: true,
        }),
        supabase.storage.from(BUCKET).upload(workspacePath, JSON.stringify(fullWorkspace), {
          contentType: "application/json",
          upsert: true,
        }),
      ]);
      if (zipUpload.error) throw zipUpload.error;
      if (wsUpload.error) console.error(`完整 workspace JSON 上传失败（非致命）：${wsUpload.error.message}`);
      console.log(`[上传 ${index + 1}/${artifacts.length}] ${zip.fileName}`);
    }
    console.log("所有 ZIP 和 workspace JSON 上传完成。");

    // Phase 2: DB 事务写入（快速执行，不包含网络 I/O）
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (cleanup) {
        await client.query("DELETE FROM match_player_stats");
        for (const table of [
          "demo_kills", "demo_damages", "demo_blinds", "demo_bombs", "demo_clutches",
          "demo_grenades", "demo_shots", "demo_positions", "demo_player_economies",
          "demo_player_stats", "demo_rounds", "demo_players",
        ]) {
          await client.query(`DELETE FROM ${table}`);
        }
        console.log("OCR 旧数据已清理。");
      }
      await client.query("UPDATE demo_imports SET is_current = false");
      await client.query("UPDATE demo_analysis_runs SET status = 'superseded' WHERE status = 'ready'");

      for (const [index, artifact] of artifacts.entries()) {
        const { zip, parsed, dak } = artifact;
        const demoHash = parsed.manifest.demo?.hash ?? "";
        const mapId = zip.candidate.mapId!;
        const objectPath = `${zip.candidate.seasonId}/${mapId}/${demoHash}.zip`;
        const previous = await client.query<{ id: string }>(
          "SELECT id FROM demo_imports WHERE map_id = $1 ORDER BY imported_at DESC LIMIT 1",
          [mapId],
        );
        const inserted = await client.query<{ id: string }>(`
          INSERT INTO demo_imports (
            map_id, demo_hash, zip_object_path, zip_byte_size, manifest, supersedes_import_id,
            is_current, schema_version, exporter_name, exporter_version, parser_name,
            map_name, tickrate, exported_at, imported_at
          ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,true,$7,$8,$9,$10,$11,$12,$13,now())
          RETURNING id
        `, [
          mapId,
          demoHash,
          objectPath,
          zip.buffer.byteLength,
          JSON.stringify(parsed.manifest),
          previous.rows[0]?.id ?? null,
          parsed.manifest.schemaVersion,
          parsed.manifest.exporter?.name ?? null,
          parsed.manifest.exporter?.version ?? null,
          parsed.manifest.parser?.name ?? null,
          parsed.manifest.mapName,
          parsed.manifest.tickrate,
          parsed.manifest.exportedAt ?? null,
        ]);
        await client.query(`
          INSERT INTO demo_analysis_runs (
            import_id, status, analysis_version, rating_version, analysis_bundle,
            workspace_model, qa_report, completed_at
          ) VALUES ($1,'ready',$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,now())
        `, [
          inserted.rows[0].id,
          dak.analysis.provenance.analysisVersion,
          dak.analysis.provenance.ratingVersions.valueAccounts,
          JSON.stringify(dak.analysis),
          JSON.stringify(dak.workspace),
          JSON.stringify(dak.analysis.qa),
        ]);
        console.log(`[写入 ${index + 1}/${artifacts.length}] ${zip.fileName}`);
      }

      const users = await client.query<{ id: string; steamId64: string | null; displayName: string | null; perfectName: string | null; steamName: string | null }>(
        `SELECT id, steam64 AS "steamId64", display_name AS "displayName", perfect_name AS "perfectName", steam_name AS "steamName" FROM users`,
      );
      const aliases = await client.query<{ steamId64: string; userId: string }>(
        `SELECT steam_id64 AS "steamId64", user_id AS "userId" FROM user_steam_aliases`,
      );
      const usersById = new Map(users.rows.map((user) => [user.id, user]));
      const identityMap: PlayerIdentityMap = {};
      const addIdentity = (steamId64: string | null, userId: string) => {
        if (!steamId64) return;
        const user = usersById.get(userId);
        identityMap[steamId64] = {
          playerKey: `user:${userId}`,
          userId,
          displayName: user?.displayName ?? user?.perfectName ?? user?.steamName ?? steamId64,
        };
      };
      for (const user of users.rows) addIdentity(user.steamId64, user.id);
      for (const alias of aliases.rows) addIdentity(alias.steamId64, alias.userId);

      const bySeason = Map.groupBy(artifacts, (artifact) => artifact.zip.candidate.seasonId);
      for (const [seasonId, seasonArtifacts] of bySeason) {
        const { cohort, leaderboard } = buildDakSeasonArtifacts(
          seasonArtifacts.map((artifact) => ({ matchId: artifact.zip.candidate.mapId!, pkg: artifact.dak.pkg })),
          identityMap,
        );
        const sourceFingerprint = createHash("sha256")
          .update(seasonArtifacts.map((artifact) => `${artifact.zip.candidate.mapId!}:${artifact.parsed.manifest.demo?.hash ?? ""}`).sort().join("\n"))
          .digest("hex");
        await client.query("UPDATE season_analysis_runs SET status = 'superseded' WHERE season_id = $1 AND status = 'ready'", [seasonId]);
        await client.query(`
          INSERT INTO season_analysis_runs (
            season_id, status, cohort_version, rating_version, source_fingerprint,
            cohort_bundle, leaderboard_model, completed_at
          ) VALUES ($1,'ready',$2,$3,$4,$5::jsonb,$6::jsonb,now())
        `, [seasonId, cohort.version, cohort.weightsVersion, sourceFingerprint, JSON.stringify(cohort), JSON.stringify(leaderboard)]);
      }
      await client.query("COMMIT");
      console.log("DAK 全量重建完成。");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
