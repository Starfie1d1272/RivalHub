import { eq, and, desc } from "drizzle-orm";
import { db } from "@/db/client";
import { matchMaps } from "@/db/schema/match-maps";
import {
  demoImports,
  demoPlayerStats,
  demoRounds,
  demoKills,
  demoBombs,
  demoGrenades,
  demoClutches,
  demoPlayerEconomies,
} from "@/db/schema/demo";
import { ok, type ActionResult } from "@/types/action";

// ── 类型 ────────────────────────────────────────────────────────────────

export interface DemoPoint {
  x: number;
  y: number;
  roundNumber: number;
  side: string | null;
}

export interface DemoPlayerStatRow {
  steamId64: string;
  userId: string | null;
  teamKey: string;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  damageHealth: number | null;
  damageArmor: number | null;
  adr: number | null;
  utilityDamage: number | null;
  averageUtilityDamagePerRound: number | null;
  headshotCount: number | null;
  firstKillCount: number | null;
  firstDeathCount: number | null;
  tradeKillCount: number | null;
  tradeDeathCount: number | null;
  kast: number | null;
  oneKillCount: number | null;
  twoKillCount: number | null;
  threeKillCount: number | null;
  fourKillCount: number | null;
  fiveKillCount: number | null;
  vsOneCount: number | null;
  vsOneWonCount: number | null;
  vsTwoCount: number | null;
  vsTwoWonCount: number | null;
  vsThreeCount: number | null;
  vsThreeWonCount: number | null;
  vsFourCount: number | null;
  vsFourWonCount: number | null;
  vsFiveCount: number | null;
  vsFiveWonCount: number | null;
  bombPlantedCount: number | null;
  bombDefusedCount: number | null;
  wallbangKillCount: number | null;
  noScopeKillCount: number | null;
  collateralKillCount: number | null;
}

export interface DemoRoundRow {
  roundNumber: number;
  teamASide: string | null;
  teamBSide: string | null;
  teamAScoreBefore: number | null;
  teamBScoreBefore: number | null;
  teamAEconomy: string | null;
  teamBEconomy: string | null;
  winnerTeamKey: string | null;
  winnerSide: string | null;
  endReason: string | null;
}

export interface KillFeedItem {
  roundNumber: number;
  tick: number;
  killerSteamId64: string | null;
  victimSteamId64: string | null;
  assisterSteamId64: string | null;
  killerTeamKey: string | null;
  victimTeamKey: string | null;
  weapon: string | null;
  headshot: boolean | null;
  flashAssist: boolean | null;
  tradeKill: boolean | null;
  throughSmoke: boolean | null;
  noScope: boolean | null;
  penetratedObjects: number | null;
  killerSide: string | null;
  victimSide: string | null;
}

export interface EconomyRow {
  roundNumber: number;
  steamId64: string;
  teamKey: string | null;
  equipmentValue: number | null;
  type: string | null;
}

export interface ClutchRow {
  roundNumber: number;
  clutcherSteamId64: string | null;
  clutcherTeamKey: string | null;
  clutcherSide: string | null;
  opponentCount: number | null;
  won: boolean | null;
  killCount: number | null;
}

export interface DemoDetailData {
  importBatchId: string;
  playerStats: DemoPlayerStatRow[];
  rounds: DemoRoundRow[];
  killPoints: DemoPoint[];
  deathPoints: DemoPoint[];
  bombPoints: DemoPoint[];
  grenadePoints: DemoPoint[];
  kills: KillFeedItem[];
  economies: EconomyRow[];
  clutches: ClutchRow[];
}

// ── 查询 ────────────────────────────────────────────────────────────────

/**
 * 获取某地图最新 demo 导入批次的明细数据。
 * 无导入返回 ok(null)。
 * 页面只读 RSC 查询。
 */
export async function getDemoDetail(
  mapId: string,
): Promise<ActionResult<DemoDetailData | null>> {
  const latestImport = await db.query.demoImports.findFirst({
    where: eq(demoImports.mapId, mapId),
    orderBy: [desc(demoImports.importedAt)],
  });

  if (!latestImport) return ok(null);

  const batchId = latestImport.id;

  const [playerStats, rounds, kills, bombs, grenades, clutches, economies] =
    await Promise.all([
      // playerStats
      db
        .select()
        .from(demoPlayerStats)
        .where(
          and(
            eq(demoPlayerStats.importBatchId, batchId),
            eq(demoPlayerStats.mapId, mapId),
          ),
        ),
      // rounds
      db
        .select()
        .from(demoRounds)
        .where(
          and(
            eq(demoRounds.importBatchId, batchId),
            eq(demoRounds.mapId, mapId),
          ),
        )
        .orderBy(demoRounds.roundNumber),
      // kills + positions
      db
        .select()
        .from(demoKills)
        .where(
          and(
            eq(demoKills.importBatchId, batchId),
            eq(demoKills.mapId, mapId),
          ),
        )
        .orderBy(demoKills.roundNumber, demoKills.tick),
      // bombs
      db
        .select()
        .from(demoBombs)
        .where(
          and(
            eq(demoBombs.importBatchId, batchId),
            eq(demoBombs.mapId, mapId),
          ),
        )
        .orderBy(demoBombs.roundNumber, demoBombs.tick),
      // grenades
      db
        .select()
        .from(demoGrenades)
        .where(
          and(
            eq(demoGrenades.importBatchId, batchId),
            eq(demoGrenades.mapId, mapId),
          ),
        )
        .orderBy(demoGrenades.roundNumber),
      // clutches
      db
        .select()
        .from(demoClutches)
        .where(
          and(
            eq(demoClutches.importBatchId, batchId),
            eq(demoClutches.mapId, mapId),
          ),
        )
        .orderBy(demoClutches.roundNumber),
      // economies
      db
        .select()
        .from(demoPlayerEconomies)
        .where(
          and(
            eq(demoPlayerEconomies.importBatchId, batchId),
            eq(demoPlayerEconomies.mapId, mapId),
          ),
        )
        .orderBy(demoPlayerEconomies.roundNumber),
    ]);

  // 提取热力图点集
  const killPoints: DemoPoint[] = kills
    .filter((k) => k.killerPosition)
    .map((k) => ({
      x: (k.killerPosition as { x: number; y: number; z: number }).x,
      y: (k.killerPosition as { x: number; y: number; z: number }).y,
      roundNumber: k.roundNumber,
      side: k.killerSide,
    }));

  const deathPoints: DemoPoint[] = kills
    .filter((k) => k.victimPosition)
    .map((k) => ({
      x: (k.victimPosition as { x: number; y: number; z: number }).x,
      y: (k.victimPosition as { x: number; y: number; z: number }).y,
      roundNumber: k.roundNumber,
      side: k.victimSide,
    }));

  const bombPoints: DemoPoint[] = bombs
    .filter((b) => b.position)
    .map((b) => ({
      x: (b.position as { x: number; y: number; z: number }).x,
      y: (b.position as { x: number; y: number; z: number }).y,
      roundNumber: b.roundNumber,
      side: b.actorSide,
    }));

  const grenadePoints: DemoPoint[] = grenades
    .filter((g) => g.effectPosition)
    .map((g) => ({
      x: (g.effectPosition as { x: number; y: number; z: number }).x,
      y: (g.effectPosition as { x: number; y: number; z: number }).y,
      roundNumber: g.roundNumber,
      side: g.throwerSide,
    }));

  // kills 明细（用于 KillFeed）
  const killItems: KillFeedItem[] = kills.map((k) => ({
    roundNumber: k.roundNumber,
    tick: k.tick,
    killerSteamId64: k.killerSteamId64,
    victimSteamId64: k.victimSteamId64,
    assisterSteamId64: k.assisterSteamId64,
    killerTeamKey: k.killerTeamKey,
    victimTeamKey: k.victimTeamKey,
    weapon: k.weapon,
    headshot: k.headshot,
    flashAssist: k.flashAssist,
    tradeKill: k.tradeKill,
    throughSmoke: k.throughSmoke,
    noScope: k.noScope,
    penetratedObjects: k.penetratedObjects,
    killerSide: k.killerSide,
    victimSide: k.victimSide,
  }));

  // economies（用于经济曲线）
  const economyRows: EconomyRow[] = economies.map((e) => ({
    roundNumber: e.roundNumber,
    steamId64: e.steamId64,
    teamKey: e.teamKey,
    equipmentValue: e.equipmentValue,
    type: e.type,
  }));

  // clutches（用于残局复盘）
  const clutchRows: ClutchRow[] = clutches.map((c) => ({
    roundNumber: c.roundNumber,
    clutcherSteamId64: c.clutcherSteamId64,
    clutcherTeamKey: c.clutcherTeamKey,
    clutcherSide: c.clutcherSide,
    opponentCount: c.opponentCount,
    won: c.won,
    killCount: c.killCount,
  }));

  // playerStats 行
  const statRows: DemoPlayerStatRow[] = playerStats.map((s) => ({
    steamId64: s.steamId64,
    userId: s.userId,
    teamKey: s.teamKey,
    kills: s.kills,
    deaths: s.deaths,
    assists: s.assists,
    damageHealth: s.damageHealth,
    damageArmor: s.damageArmor,
    adr: s.adr,
    utilityDamage: s.utilityDamage,
    averageUtilityDamagePerRound: s.averageUtilityDamagePerRound,
    headshotCount: s.headshotCount,
    firstKillCount: s.firstKillCount,
    firstDeathCount: s.firstDeathCount,
    tradeKillCount: s.tradeKillCount,
    tradeDeathCount: s.tradeDeathCount,
    kast: s.kast,
    oneKillCount: s.oneKillCount,
    twoKillCount: s.twoKillCount,
    threeKillCount: s.threeKillCount,
    fourKillCount: s.fourKillCount,
    fiveKillCount: s.fiveKillCount,
    vsOneCount: s.vsOneCount,
    vsOneWonCount: s.vsOneWonCount,
    vsTwoCount: s.vsTwoCount,
    vsTwoWonCount: s.vsTwoWonCount,
    vsThreeCount: s.vsThreeCount,
    vsThreeWonCount: s.vsThreeWonCount,
    vsFourCount: s.vsFourCount,
    vsFourWonCount: s.vsFourWonCount,
    vsFiveCount: s.vsFiveCount,
    vsFiveWonCount: s.vsFiveWonCount,
    bombPlantedCount: s.bombPlantedCount,
    bombDefusedCount: s.bombDefusedCount,
    wallbangKillCount: s.wallbangKillCount,
    noScopeKillCount: s.noScopeKillCount,
    collateralKillCount: s.collateralKillCount,
  }));

  return ok({
    importBatchId: batchId,
    playerStats: statRows,
    rounds,
    killPoints,
    deathPoints,
    bombPoints,
    grenadePoints,
    kills: killItems,
    economies: economyRows,
    clutches: clutchRows,
  });
}
