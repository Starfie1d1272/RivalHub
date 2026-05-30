/**
 * toRRIndicators — 将 RivalHub demo 数据结构适配为 RRIndicators 格式
 *
 * 输入来自 RivalHub 现有类型；输出与 @rivalhub/rival-rating 的 RRIndicators 接口兼容。
 * TODO: 待 rival-rating 加入 pnpm workspace 后，将返回类型改为
 *       `import type { RRIndicators } from "@rivalhub/rival-rating"`
 *
 * 字段映射说明：
 *   PlayerStatRow[]  → 基础输出、多杀、首杀/补枪/残局细分
 *   BlindsRow[]      → blindDuration（通过现有 aggregatePlayerDemoStats）
 *   WeaponStat[]     → awpKills、sniperKills
 *   grenadeCount     → 来自 grenades.json 聚合（当前可选，默认 0）
 *   flashAssistCount → 来自 kills.json flashAssist 字段聚合（当前可选）
 */

import { aggregatePlayerDemoStats } from "./player-demo-stats";
import type { PlayerStatRow, BlindsRow } from "./player-demo-stats";
import type { WeaponStat } from "./weapon-stats";
import type { RRIndicators } from "@rivalhub/rival-rating";

// ─── 适配器入参 ───────────────────────────────────────────────────────────────

export interface ToRRIndicatorsInput {
  steamId64: string;
  /** demoPlayerStats 行（多场比赛） */
  stats: PlayerStatRow[];
  /** demoBlinds 行（该选手作为 flasher） */
  blinds?: BlindsRow[];
  /** 武器统计（来自 aggregateWeaponStats） */
  weaponStats?: WeaponStat[];
  /**
   * 投掷物总数（来自 grenades.json 中该选手的 throw 次数）
   * 当前 demo 格式尚未聚合，默认 0
   */
  grenadeCount?: number;
  /**
   * 闪光助攻数（来自 kills.json flashAssist=true 的选手击杀数）
   * 可由 aggregateUtilityStats 得到，不传则默认 0
   */
  flashAssistCount?: number;
  /**
   * 地图总回合数（来自 rounds.json 行数，过滤 roundNumber=0 后）。
   *
   * player-stats.json 当前不含 rounds 字段，直接传入可修正 fallback 误差。
   * 不传时退化为 aggregatePlayerDemoStats 的 kills+deaths 近似（误差 ~20%）。
   *
   * 推荐传入方式：
   *   parsedPackage.files.rounds.length
   */
  totalRoundsOverride?: number;
  /**
   * 经济回合分类数（来自 player-economies.json 聚合）
   * 当前可选；Layer 1 eco 乘子激活前影响不大
   */
  economy?: {
    ecoRounds: number;
    forceRounds: number;
    fullBuyRounds: number;
    pistolRounds: number;
    avgEquipmentValue: number;
  };
}

// ─── 适配器主函数 ────────────────────────────────────────────────────────────

/**
 * 将 RivalHub demo 数据转换为 RRIndicators。
 * 纯函数，无副作用。
 */
export function toRRIndicators(input: ToRRIndicatorsInput): RRIndicators {
  const {
    steamId64,
    stats,
    blinds = [],
    weaponStats = [],
    grenadeCount = 0,
    flashAssistCount = 0,
    totalRoundsOverride,
    economy,
  } = input;

  // ── Step 1: 用现有 aggregate 拿已算好的字段 ─────────────────────────────
  const agg = aggregatePlayerDemoStats(stats, blinds);

  // ── Step 2: 从原始 stats 行补充 aggregate 没有的字段 ─────────────────────
  let kills = 0, deaths = 0, assists = 0;
  let headshotCount = 0;
  let tradeKillCount = 0, tradeDeathCount = 0;
  let twoKillRounds = 0, threeKillRounds = 0, fourKillRounds = 0, fiveKillRounds = 0;
  let utilityDamage = 0;

  for (const s of stats) {
    kills           += s.kills           ?? 0;
    deaths          += s.deaths          ?? 0;
    assists         += s.assists         ?? 0;
    headshotCount   += (s as { headshotCount?: number | null }).headshotCount   ?? 0;
    tradeKillCount  += s.tradeKillCount  ?? 0;
    tradeDeathCount += (s as { tradeDeathCount?: number | null }).tradeDeathCount ?? 0;
    twoKillRounds   += s.twoKillCount    ?? 0;
    threeKillRounds += s.threeKillCount  ?? 0;
    fourKillRounds  += s.fourKillCount   ?? 0;
    fiveKillRounds  += s.fiveKillCount   ?? 0;
    utilityDamage   += s.utilityDamage   ?? 0;
  }

  // totalRoundsOverride 修正 player-stats.json 缺 rounds 字段导致的 fallback 误差
  const totalRounds = totalRoundsOverride ?? agg.totalRounds;
  const safe = (n: number, d: number) => (d > 0 ? n / d : 0);

  // ── Step 3: 狙击字段（从 weaponStats 提取）──────────────────────────────
  const awpStat    = weaponStats.find((w) => w.weapon.toLowerCase() === "awp");
  const ssgStat    = weaponStats.find((w) => w.weapon.toLowerCase() === "ssg08");
  const awpKills   = awpStat?.kills ?? 0;
  const ssgKills   = ssgStat?.kills ?? 0;
  const sniperKills = awpKills + ssgKills;

  // ── Step 4: 残局积分 ─────────────────────────────────────────────────────
  const clutchScore =
    agg.vsOne.won   * 1 +
    agg.vsTwo.won   * 2 +
    agg.vsThree.won * 3 +
    agg.vsFour.won  * 4 +
    agg.vsFive.won  * 5;

  // ── Step 5: 组装 ─────────────────────────────────────────────────────────
  return {
    steamId64,
    totalRounds,

    kills,
    deaths,
    assists,
    kpr:          safe(kills, totalRounds),
    dpr:          safe(deaths, totalRounds),
    apr:          safe(assists, totalRounds),
    adr:          agg.adr,
    hsPercent:    kills > 0 ? (headshotCount / kills) * 100 : 0,
    kast:         agg.kast,
    survivalRate: safe(totalRounds - deaths, totalRounds),

    twoKillRounds,
    threeKillRounds,
    fourKillRounds,
    fiveKillRounds,
    // multiKillRate 用正确 totalRounds 重算（agg 内部用的是 fallback 值）
    multiKillRate: safe(twoKillRounds + threeKillRounds + fourKillRounds + fiveKillRounds, totalRounds),

    firstKillCount:     agg.firstKillCount,
    firstDeathCount:    agg.firstDeathCount,
    firstKillRate:      safe(agg.firstKillCount, totalRounds),
    firstDeathRate:     safe(agg.firstDeathCount, totalRounds),
    openingDuelRate:    safe(agg.firstKillCount + agg.firstDeathCount, totalRounds),
    openingDuelWinRate: agg.entrySuccessRate, // ratio, 不受 totalRounds 影响

    tradeKillCount,
    tradeDeathCount,
    tradeKillRate:  safe(tradeKillCount, totalRounds),
    tradeDeathRate: safe(tradeDeathCount, deaths),

    clutchAttempts:  agg.clutchAttempts,
    clutchWins:      agg.clutchWins,
    clutchWinRate:   agg.clutchWinRate,
    clutchFrequency: safe(agg.clutchAttempts, totalRounds),
    clutchScore,
    clutchScoreRate: safe(clutchScore, totalRounds),
    vsOne:   agg.vsOne,
    vsTwo:   agg.vsTwo,
    vsThree: agg.vsThree,
    vsFour:  agg.vsFour,
    vsFive:  agg.vsFive,

    awpKills,
    awpKillsPerRound: safe(awpKills, totalRounds),
    awpKillRate:      safe(awpKills, kills),
    sniperKills,
    sniperKillRate:   safe(sniperKills, kills),
    awpMultiKillRate: null,  // 待 AWP 多杀回合聚合后填入
    awpDuelWinRate:   null,  // 待经济快照可用后填入

    utilityDamage,
    utilityDamagePerRound:  safe(utilityDamage, totalRounds),
    flashAssistCount,
    flashAssistPerRound:    safe(flashAssistCount, totalRounds),
    blindDurationTotal:     agg.blindsDuration,
    blindDurationPerRound:  safe(agg.blindsDuration, totalRounds),
    grenadeCount,
    grenadeCountPerRound:   safe(grenadeCount, totalRounds),

    ecoRoundCount:      economy?.ecoRounds      ?? 0,
    forceRoundCount:    economy?.forceRounds     ?? 0,
    fullBuyRoundCount:  economy?.fullBuyRounds   ?? 0,
    pistolRoundCount:   economy?.pistolRounds    ?? 0,
    avgEquipmentValue:  economy?.avgEquipmentValue ?? 0,

    roundSwingTotal:   null,
    roundSwingPerKill: null,
  };
}
