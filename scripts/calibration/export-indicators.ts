/**
 * 校准数据导出脚本
 *
 * 读取 RivalHub demo ZIP 文件，解析后提取 RRIndicators，导出给 rival-rating 做数据 QA 和校准分析。
 *
 * 用法：
 *   pnpm exec tsx scripts/calibration/export-indicators.ts --input ./demos --output ./calibration-output
 *
 * 输出：
 *   - <output>/player-map.json/csv      一行 = 一个选手在一张图上的 RRIndicators
 *   - <output>/player-season.json/csv   一行 = 一个选手跨全部地图聚合后的 RRIndicators
 *   - <output>/parse-report.json        ZIP 解析、文件行数、经济类型、QA 摘要
 *   - <output>/indicators.json/csv      player-map 的兼容别名
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { parseDemoPackage } = require("cs2-demo-format/parser");
const { aggregateWeaponStats } = require("../../src/lib/demo/weapon-stats");
const { toRRIndicators } = require("../../src/lib/demo/to-rr-indicators");

interface DemoPlayerRow {
  zipFile: string;
  demoHash: string;
  mapName: string;
  schemaVersion: string;
  steamId64: string;
  playerName: string;
  totalRounds: number;
}

interface PlayerMapRow extends DemoPlayerRow {
  [key: string]: unknown;
}

interface PlayerSeasonRow {
  steamId64: string;
  playerName: string;
  mapCount: number;
  mapNames: string[];
  demoHashes: string[];
  totalRounds: number;
  [key: string]: unknown;
}

interface MapReport {
  zipFile: string;
  status: "parsed" | "failed";
  demoHash?: string;
  mapName?: string;
  schemaVersion?: string;
  totalRounds?: number;
  playerCount?: number;
  rowCounts?: Record<string, number>;
  economyTypeCounts?: Record<string, number>;
  warnings: string[];
  error?: string;
}

type AnyRow = Record<string, unknown>;

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o", default: "./calibration-output" },
  },
});

if (!values.input) {
  console.error(
    "Usage: pnpm exec tsx scripts/calibration/export-indicators.ts --input <dir> [--output <dir>]",
  );
  process.exit(1);
}

const inputDir = resolve(values.input);
const outputDir = resolve(values.output!);

if (!existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const PLAYER_MAP_EXTREME_LIMITS: Record<string, { min?: number; max?: number }> = {
  totalRounds: { min: 1, max: 60 },
  kpr: { min: 0, max: 2 },
  dpr: { min: 0, max: 2 },
  apr: { min: 0, max: 2 },
  adr: { min: 0, max: 250 },
  hsPercent: { min: 0, max: 100 },
  kast: { min: 0, max: 100 },
  survivalRate: { min: 0, max: 1 },
  openingDuelWinRate: { min: 0, max: 1 },
  clutchWinRate: { min: 0, max: 1 },
  avgEquipmentValue: { min: 0, max: 20000 },
};

const PLAYER_SEASON_EXTREME_LIMITS: Record<string, { min?: number; max?: number }> = {
  mapCount: { min: 1 },
  totalRounds: { min: 1 },
  kpr: { min: 0, max: 2 },
  dpr: { min: 0, max: 2 },
  apr: { min: 0, max: 2 },
  adr: { min: 0, max: 250 },
  hsPercent: { min: 0, max: 100 },
  kast: { min: 0, max: 100 },
  survivalRate: { min: 0, max: 1 },
  openingDuelWinRate: { min: 0, max: 1 },
  clutchWinRate: { min: 0, max: 1 },
  avgEquipmentValue: { min: 0, max: 20000 },
};

async function main() {
  const zipFiles = readdirSync(inputDir)
    .filter((file) => file.endsWith(".zip"))
    .sort((a, b) => a.localeCompare(b));

  console.log(`Found ${zipFiles.length} ZIP file(s) in ${inputDir}`);

  if (zipFiles.length === 0) {
    console.error("No ZIP files found.");
    process.exit(1);
  }

  const playerMapRows: PlayerMapRow[] = [];
  const mapReports: MapReport[] = [];

  for (const zipFile of zipFiles) {
    const zipPath = join(inputDir, zipFile);
    console.log(`\nProcessing: ${zipFile}`);

    let parsed: Awaited<ReturnType<typeof parseDemoPackage>>;
    try {
      parsed = await parseDemoPackage(readFileSync(zipPath));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  Failed to parse: ${message}`);
      mapReports.push({
        zipFile,
        status: "failed",
        warnings: [],
        error: message,
      });
      continue;
    }

    const demoHash = parsed.manifest.demo?.hash ?? basename(zipFile, ".zip");
    const mapName = parsed.manifest.mapName ?? "unknown";
    const schemaVersion = parsed.manifest.schemaVersion ?? "unknown";

    const playerRows: any[] = parsed.files.playerStats ?? [];
    const kills: any[] = parsed.files.kills ?? [];
    const blinds: any[] = parsed.files.blinds ?? [];
    const economies: any[] = parsed.files.playerEconomies ?? [];
    const grenades: any[] = parsed.files.grenades ?? [];
    const rounds: any[] = parsed.files.rounds ?? [];
    const playerInfo: any[] = parsed.files.players ?? [];

    const uniqueSteamIds = uniqueStrings(playerRows.map((row) => row.steamId64));
    const totalRounds = rounds.length;
    const economyTypeCounts = countEconomyTypes(economies);
    const warnings: string[] = [];

    if (uniqueSteamIds.length !== 10) {
      warnings.push(`expected 10 players, got ${uniqueSteamIds.length}`);
    }
    if (totalRounds === 0) {
      warnings.push("rounds file is empty");
    }
    if (economies.length === 0) {
      warnings.push("playerEconomies file is empty");
    }

    console.log(`  Players: ${uniqueSteamIds.length}`);
    console.log(`  Rounds: ${totalRounds}`);

    const grenadeCountBySteam = new Map<string, number>();
    for (const grenade of grenades) {
      const steamId64 = asString(grenade.throwerSteamId64 ?? grenade.steamId64);
      if (steamId64) {
        grenadeCountBySteam.set(
          steamId64,
          (grenadeCountBySteam.get(steamId64) ?? 0) + 1,
        );
      }
    }

    const flashAssistBySteam = new Map<string, number>();
    for (const kill of kills) {
      if (kill.flashAssist) {
        const steamId64 = asString(kill.killerSteamId64);
        if (steamId64) {
          flashAssistBySteam.set(
            steamId64,
            (flashAssistBySteam.get(steamId64) ?? 0) + 1,
          );
        }
      }
    }

    const nameBySteam = new Map<string, string>();
    for (const player of playerInfo) {
      const steamId64 = asString(player.steamId64);
      if (steamId64) {
        nameBySteam.set(steamId64, asString(player.name) ?? steamId64);
      }
    }

    for (const steamId64 of uniqueSteamIds) {
      const stats = playerRows.filter((row) => asString(row.steamId64) === steamId64);
      const playerBlinds = blinds.filter(
        (blind) => asString(blind.flasherSteamId64) === steamId64,
      );
      const playerKills = kills.filter(
        (kill) => asString(kill.killerSteamId64) === steamId64,
      );
      const playerEconomies = economies.filter(
        (economy) => asString(economy.steamId64) === steamId64,
      );

      const economy = aggregateEconomy(playerEconomies);
      const indicators = toRRIndicators({
        steamId64,
        stats,
        blinds: playerBlinds,
        weaponStats: aggregateWeaponStats(playerKills),
        grenadeCount: grenadeCountBySteam.get(steamId64) ?? 0,
        flashAssistCount: flashAssistBySteam.get(steamId64) ?? 0,
        totalRoundsOverride: totalRounds,
        economy,
      });

      playerMapRows.push({
        zipFile,
        demoHash,
        mapName,
        schemaVersion,
        steamId64,
        playerName: nameBySteam.get(steamId64) ?? steamId64,
        totalRounds,
        ...indicators,
      });
    }

    mapReports.push({
      zipFile,
      status: "parsed",
      demoHash,
      mapName,
      schemaVersion,
      totalRounds,
      playerCount: uniqueSteamIds.length,
      rowCounts: countParsedRows(parsed.files),
      economyTypeCounts,
      warnings,
    });
  }

  const playerSeasonRows = buildPlayerSeasonRows(playerMapRows);
  const parseReport = buildParseReport({
    inputDir,
    outputDir,
    zipFiles,
    mapReports,
    playerMapRows,
    playerSeasonRows,
  });

  writeJsonAndCsv("player-map", playerMapRows);
  writeJsonAndCsv("player-season", playerSeasonRows);
  writeJsonAndCsv("indicators", playerMapRows);

  const reportPath = join(outputDir, "parse-report.json");
  writeFileSync(reportPath, `${JSON.stringify(parseReport, null, 2)}\n`);
  console.log(`Parse report written: ${reportPath}`);

  console.log("\nExport summary:");
  console.log(`  maps parsed: ${parseReport.totals.parsedMaps}/${parseReport.totals.zipFiles}`);
  console.log(`  player-map rows: ${parseReport.totals.playerMapRows}`);
  console.log(`  player-season rows: ${parseReport.totals.playerSeasonRows}`);
  console.log(`  unique players: ${parseReport.totals.uniquePlayers}`);
  console.log(`  total map rounds: ${parseReport.totals.totalMapRounds}`);
}

function aggregateEconomy(economies: any[]) {
  let ecoRounds = 0;
  let forceRounds = 0;
  let fullBuyRounds = 0;
  let pistolRounds = 0;
  let equipmentValueSum = 0;
  let equipmentValueCount = 0;

  for (const economy of economies) {
    const type = normalizeEconomyType(economy.type);
    if (type === "eco") ecoRounds++;
    else if (type === "force" || type === "semi") forceRounds++;
    else if (type === "full") fullBuyRounds++;
    else if (type === "pistol") pistolRounds++;

    if (typeof economy.equipmentValue === "number") {
      equipmentValueSum += economy.equipmentValue;
      equipmentValueCount++;
    }
  }

  return {
    ecoRounds,
    forceRounds,
    fullBuyRounds,
    pistolRounds,
    avgEquipmentValue:
      equipmentValueCount > 0 ? equipmentValueSum / equipmentValueCount : 0,
  };
}

function buildPlayerSeasonRows(playerMapRows: PlayerMapRow[]): PlayerSeasonRow[] {
  const rowsBySteam = new Map<string, PlayerMapRow[]>();
  for (const row of playerMapRows) {
    const existing = rowsBySteam.get(row.steamId64) ?? [];
    existing.push(row);
    rowsBySteam.set(row.steamId64, existing);
  }

  return [...rowsBySteam.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([steamId64, rows]) => aggregatePlayerSeason(steamId64, rows));
}

function aggregatePlayerSeason(
  steamId64: string,
  rows: PlayerMapRow[],
): PlayerSeasonRow {
  const totalRounds = sum(rows, "totalRounds");
  const kills = sum(rows, "kills");
  const deaths = sum(rows, "deaths");
  const assists = sum(rows, "assists");
  const firstKillCount = sum(rows, "firstKillCount");
  const firstDeathCount = sum(rows, "firstDeathCount");
  const tradeKillCount = sum(rows, "tradeKillCount");
  const tradeDeathCount = sum(rows, "tradeDeathCount");
  const clutchAttempts = sum(rows, "clutchAttempts");
  const clutchWins = sum(rows, "clutchWins");
  const clutchScore = sum(rows, "clutchScore");
  const awpKills = sum(rows, "awpKills");
  const sniperKills = sum(rows, "sniperKills");
  const utilityDamage = sum(rows, "utilityDamage");
  const flashAssistCount = sum(rows, "flashAssistCount");
  const blindDurationTotal = sum(rows, "blindDurationTotal");
  const grenadeCount = sum(rows, "grenadeCount");
  const ecoRoundCount = sum(rows, "ecoRoundCount");
  const forceRoundCount = sum(rows, "forceRoundCount");
  const fullBuyRoundCount = sum(rows, "fullBuyRoundCount");
  const pistolRoundCount = sum(rows, "pistolRoundCount");
  const economyRounds =
    ecoRoundCount + forceRoundCount + fullBuyRoundCount + pistolRoundCount;

  const vsOne = sumNested(rows, "vsOne");
  const vsTwo = sumNested(rows, "vsTwo");
  const vsThree = sumNested(rows, "vsThree");
  const vsFour = sumNested(rows, "vsFour");
  const vsFive = sumNested(rows, "vsFive");

  const twoKillRounds = sum(rows, "twoKillRounds");
  const threeKillRounds = sum(rows, "threeKillRounds");
  const fourKillRounds = sum(rows, "fourKillRounds");
  const fiveKillRounds = sum(rows, "fiveKillRounds");
  const estimatedHeadshots = rows.reduce((total, row) => {
    return total + numberValue(row.kills) * (numberValue(row.hsPercent) / 100);
  }, 0);

  return {
    steamId64,
    playerName: mostRecentPlayerName(rows),
    mapCount: rows.length,
    mapNames: uniqueStrings(rows.map((row) => row.mapName)).sort(),
    demoHashes: uniqueStrings(rows.map((row) => row.demoHash)).sort(),
    totalRounds,

    kills,
    deaths,
    assists,
    kpr: safe(kills, totalRounds),
    dpr: safe(deaths, totalRounds),
    apr: safe(assists, totalRounds),
    adr: weightedAverage(rows, "adr", "totalRounds"),
    hsPercent: kills > 0 ? (estimatedHeadshots / kills) * 100 : 0,
    kast: weightedAverage(rows, "kast", "totalRounds"),
    survivalRate: safe(totalRounds - deaths, totalRounds),

    twoKillRounds,
    threeKillRounds,
    fourKillRounds,
    fiveKillRounds,
    multiKillRate: safe(
      twoKillRounds + threeKillRounds + fourKillRounds + fiveKillRounds,
      totalRounds,
    ),

    firstKillCount,
    firstDeathCount,
    firstKillRate: safe(firstKillCount, totalRounds),
    firstDeathRate: safe(firstDeathCount, totalRounds),
    openingDuelRate: safe(firstKillCount + firstDeathCount, totalRounds),
    openingDuelWinRate: safe(firstKillCount, firstKillCount + firstDeathCount),

    tradeKillCount,
    tradeDeathCount,
    tradeKillRate: safe(tradeKillCount, totalRounds),
    tradeDeathRate: safe(tradeDeathCount, deaths),

    clutchAttempts,
    clutchWins,
    clutchWinRate: safe(clutchWins, clutchAttempts),
    clutchFrequency: safe(clutchAttempts, totalRounds),
    clutchScore,
    clutchScoreRate: safe(clutchScore, totalRounds),
    vsOne,
    vsTwo,
    vsThree,
    vsFour,
    vsFive,

    awpKills,
    awpKillsPerRound: safe(awpKills, totalRounds),
    awpKillRate: safe(awpKills, kills),
    sniperKills,
    sniperKillRate: safe(sniperKills, kills),
    awpMultiKillRate: nullableNumberSum(rows, "awpMultiKillRate"),
    awpDuelWinRate: nullableNumberAverage(rows, "awpDuelWinRate"),

    utilityDamage,
    utilityDamagePerRound: safe(utilityDamage, totalRounds),
    flashAssistCount,
    flashAssistPerRound: safe(flashAssistCount, totalRounds),
    blindDurationTotal,
    blindDurationPerRound: safe(blindDurationTotal, totalRounds),
    grenadeCount,
    grenadeCountPerRound: safe(grenadeCount, totalRounds),

    ecoRoundCount,
    forceRoundCount,
    fullBuyRoundCount,
    pistolRoundCount,
    avgEquipmentValue:
      economyRounds > 0
        ? weightedAverage(rows, "avgEquipmentValue", (row) => {
            return (
              numberValue(row.ecoRoundCount) +
              numberValue(row.forceRoundCount) +
              numberValue(row.fullBuyRoundCount) +
              numberValue(row.pistolRoundCount)
            );
          })
        : 0,

    roundSwingTotal: nullableNumberSum(rows, "roundSwingTotal"),
    roundSwingPerKill: nullableNumberAverage(rows, "roundSwingPerKill"),
  };
}

function buildParseReport(input: {
  inputDir: string;
  outputDir: string;
  zipFiles: string[];
  mapReports: MapReport[];
  playerMapRows: PlayerMapRow[];
  playerSeasonRows: PlayerSeasonRow[];
}) {
  const parsedReports = input.mapReports.filter((report) => report.status === "parsed");
  const failedReports = input.mapReports.filter((report) => report.status === "failed");
  const uniquePlayers = new Set(input.playerMapRows.map((row) => row.steamId64));
  const totalMapRounds = parsedReports.reduce(
    (total, report) => total + (report.totalRounds ?? 0),
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    inputDir: input.inputDir,
    outputDir: input.outputDir,
    totals: {
      zipFiles: input.zipFiles.length,
      parsedMaps: parsedReports.length,
      failedMaps: failedReports.length,
      playerMapRows: input.playerMapRows.length,
      playerSeasonRows: input.playerSeasonRows.length,
      uniquePlayers: uniquePlayers.size,
      totalMapRounds,
    },
    economyTypeCounts: mergeCounts(
      parsedReports.map((report) => report.economyTypeCounts ?? {}),
    ),
    qa: buildQa(input.playerMapRows, input.playerSeasonRows, parsedReports),
    maps: input.mapReports,
  };
}

function buildQa(
  playerMapRows: PlayerMapRow[],
  playerSeasonRows: PlayerSeasonRow[],
  mapReports: MapReport[],
) {
  return {
    playerMap: {
      nullCounts: countNulls(playerMapRows),
      nonFiniteValues: findNonFiniteValues(playerMapRows),
      rangeSummary: rangeSummary(playerMapRows, [
        "totalRounds",
        "kills",
        "deaths",
        "kpr",
        "dpr",
        "adr",
        "hsPercent",
        "kast",
        "survivalRate",
        "avgEquipmentValue",
      ]),
      extremeValues: findExtremeValues(playerMapRows, PLAYER_MAP_EXTREME_LIMITS),
      economyRoundMismatches: findEconomyRoundMismatches(playerMapRows),
    },
    playerSeason: {
      nullCounts: countNulls(playerSeasonRows),
      nonFiniteValues: findNonFiniteValues(playerSeasonRows),
      rangeSummary: rangeSummary(playerSeasonRows, [
        "mapCount",
        "totalRounds",
        "kills",
        "deaths",
        "kpr",
        "dpr",
        "adr",
        "hsPercent",
        "kast",
        "survivalRate",
        "avgEquipmentValue",
      ]),
      extremeValues: findExtremeValues(playerSeasonRows, PLAYER_SEASON_EXTREME_LIMITS),
    },
    mapWarnings: mapReports
      .filter((report) => report.warnings.length > 0)
      .map((report) => ({
        zipFile: report.zipFile,
        warnings: report.warnings,
      })),
  };
}

function findEconomyRoundMismatches(rows: AnyRow[]) {
  return rows
    .map((row) => {
      const economyRounds =
        numberValue(row.ecoRoundCount) +
        numberValue(row.forceRoundCount) +
        numberValue(row.fullBuyRoundCount) +
        numberValue(row.pistolRoundCount);
      const totalRounds = numberValue(row.totalRounds);
      return {
        zipFile: row.zipFile,
        steamId64: row.steamId64,
        playerName: row.playerName,
        totalRounds,
        economyRounds,
        delta: economyRounds - totalRounds,
      };
    })
    .filter((row) => row.delta !== 0);
}

function findExtremeValues(
  rows: AnyRow[],
  limits: Record<string, { min?: number; max?: number }>,
) {
  const extremes: Array<{
    row: number;
    zipFile?: unknown;
    steamId64?: unknown;
    playerName?: unknown;
    field: string;
    value: number;
    limit: { min?: number; max?: number };
  }> = [];

  rows.forEach((row, rowIndex) => {
    for (const [field, limit] of Object.entries(limits)) {
      const value = row[field];
      if (typeof value !== "number") continue;
      const belowMin = limit.min != null && value < limit.min;
      const aboveMax = limit.max != null && value > limit.max;
      if (belowMin || aboveMax) {
        extremes.push({
          row: rowIndex,
          zipFile: row.zipFile,
          steamId64: row.steamId64,
          playerName: row.playerName,
          field,
          value,
          limit,
        });
      }
    }
  });

  return extremes;
}

function countNulls(rows: AnyRow[]) {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const [field, value] of Object.entries(row)) {
      if (value === null || value === undefined) {
        counts[field] = (counts[field] ?? 0) + 1;
      }
    }
  }
  return counts;
}

function findNonFiniteValues(rows: AnyRow[]) {
  const values: Array<{
    row: number;
    zipFile?: unknown;
    steamId64?: unknown;
    playerName?: unknown;
    field: string;
    value: string;
  }> = [];

  rows.forEach((row, rowIndex) => {
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        values.push({
          row: rowIndex,
          zipFile: row.zipFile,
          steamId64: row.steamId64,
          playerName: row.playerName,
          field,
          value: String(value),
        });
      }
    }
  });

  return values;
}

function rangeSummary(rows: AnyRow[], fields: string[]) {
  const summary: Record<
    string,
    { min: number; max: number; mean: number; count: number }
  > = {};

  for (const field of fields) {
    const values = rows
      .map((row) => row[field])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

    if (values.length === 0) continue;

    summary[field] = {
      min: Math.min(...values),
      max: Math.max(...values),
      mean: values.reduce((total, value) => total + value, 0) / values.length,
      count: values.length,
    };
  }

  return summary;
}

function writeJsonAndCsv(name: string, rows: AnyRow[]) {
  const jsonPath = join(outputDir, `${name}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`JSON written: ${jsonPath} (${rows.length} rows)`);

  const csvPath = join(outputDir, `${name}.csv`);
  writeFileSync(csvPath, toCsv(rows));
  console.log(`CSV written: ${csvPath}`);
}

function toCsv(rows: AnyRow[]) {
  const headers = collectHeaders(rows);
  const lines = [headers.join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }

  return `${lines.join("\n")}\n`;
}

function collectHeaders(rows: AnyRow[]) {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const field of Object.keys(row)) {
      if (!seen.has(field)) {
        seen.add(field);
        headers.push(field);
      }
    }
  }
  return headers;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function countParsedRows(files: Record<string, unknown>) {
  const counts: Record<string, number> = {};
  for (const [name, value] of Object.entries(files)) {
    counts[name] = Array.isArray(value) ? value.length : 0;
  }
  return counts;
}

function countEconomyTypes(economies: any[]) {
  const counts: Record<string, number> = {};
  for (const economy of economies) {
    const type = normalizeEconomyType(economy.type);
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function mergeCounts(counts: Array<Record<string, number>>) {
  const merged: Record<string, number> = {};
  for (const count of counts) {
    for (const [key, value] of Object.entries(count)) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

function normalizeEconomyType(type: unknown) {
  const raw = asString(type)?.toLowerCase() ?? "unknown";
  if (raw === "force_buy") return "force";
  if (raw === "full_buy") return "full";
  return raw;
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map(asString).filter((value): value is string => Boolean(value)))];
}

function sum(rows: AnyRow[], field: string) {
  return rows.reduce((total, row) => total + numberValue(row[field]), 0);
}

function sumNested(rows: AnyRow[], field: string) {
  return rows.reduce<{ count: number; won: number }>(
    (total, row) => {
      const value = row[field] as { count?: unknown; won?: unknown } | undefined;
      total.count += numberValue(value?.count);
      total.won += numberValue(value?.won);
      return total;
    },
    { count: 0, won: 0 },
  );
}

function weightedAverage(
  rows: AnyRow[],
  field: string,
  weightField: string | ((row: AnyRow) => number),
) {
  let weightedSum = 0;
  let weightSum = 0;

  for (const row of rows) {
    const value = row[field];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    const weight =
      typeof weightField === "string" ? numberValue(row[weightField]) : weightField(row);
    if (weight <= 0) continue;

    weightedSum += value * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0;
}

function nullableNumberSum(rows: AnyRow[], field: string) {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
}

function nullableNumberAverage(rows: AnyRow[], field: string) {
  const values = rows
    .map((row) => row[field])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length > 0
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safe(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function asString(value: unknown) {
  if (value === null || value === undefined) return undefined;
  return String(value);
}

function mostRecentPlayerName(rows: PlayerMapRow[]) {
  return rows[rows.length - 1]?.playerName ?? rows[0]?.steamId64 ?? "unknown";
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
