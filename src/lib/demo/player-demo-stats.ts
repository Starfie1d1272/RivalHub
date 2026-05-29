/**
 * 选手 demo 数据聚合
 *
 * 跨场聚合：所有跨场查询必须按 active_stat_source='demo_import' 过滤（契约 E）。
 * 纯函数，可单测。
 */

// ── 输入类型 ────────────────────────────────────────────────────────────

export interface KillRow {
  weapon: string | null;
  headshot: boolean | null;
  tradeKill: boolean | null;
  throughSmoke: boolean | null;
  noScope: boolean | null;
  penetratedObjects: number | null;
}

export interface ClutchRow {
  opponentCount: number | null;
  won: boolean | null;
}

export interface BlindsRow {
  flasherSteamId64: string | null;
  flashedSide: string | null;
  flasherSide: string | null;
  durationSeconds: number | null;
}

export interface UtilityRow {
  utilityDamage: number | null;
}

export interface PlayerStatRow {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  adr: number | null;
  kast: number | null;
  firstKillCount: number | null;
  firstDeathCount: number | null;
  tradeKillCount: number | null;
  tradeDeathCount: number | null;
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
  utilityDamage: number | null;
  averageUtilityDamagePerRound: number | null;
  wallbangKillCount: number | null;
  noScopeKillCount: number | null;
  collateralKillCount: number | null;
  rounds?: number | null;
}

// ── 输出类型 ────────────────────────────────────────────────────────────

export interface PlayerDemoAggregate {
  /** 选手参与的总 demo 回合数 */
  totalRounds: number;

  /** KAST % (0-100) */
  kast: number;
  /** ADR */
  adr: number;
  /** 场均 utility damage */
  utilityDamagePerRound: number;

  /** 首杀数 / totalRounds */
  firstKillRate: number;
  /** 首死数 / totalRounds */
  firstDeathRate: number;
  /** entry 成功率 = firstKill / (firstKill + firstDeath) */
  entrySuccessRate: number;

  /** multi-kill rounds / totalRounds */
  multiKillRate: number;

  /** 残局胜率（all vN combined） */
  clutchWinRate: number;
  /** 残局尝试数 */
  clutchAttempts: number;
  /** 残局胜场 */
  clutchWins: number;

  /** 首杀数 */
  firstKillCount: number;
  /** 首死数 */
  firstDeathCount: number;

  // 残局细分
  vsOne: { count: number; won: number };
  vsTwo: { count: number; won: number };
  vsThree: { count: number; won: number };
  vsFour: { count: number; won: number };
  vsFive: { count: number; won: number };

  /** trade kill 率 */
  tradeKillRate: number;

  /** 致盲敌人数 */
  blindsEnemies: number;
  /** 致盲总秒数 */
  blindsDuration: number;
}

// ── 聚合函数 ────────────────────────────────────────────────────────────

/**
 * 聚合某选手所有 demo 数据为选手页可展示的摘要指标。
 *
 * @param stats - demoPlayerStats 行（通常多场比赛，按 userId 映射后合并）
 * @param blinds - demoBlinds 行（该选手作为 flasher）
 */
export function aggregatePlayerDemoStats(
  stats: PlayerStatRow[],
  blinds: BlindsRow[] = [],
): PlayerDemoAggregate {
  // ── 对 stats 行求和 ──
  let totalRounds = 0;
  let kastWeighted = 0;
  let adrWeighted = 0;
  let utilityDamageTotal = 0;
  let firstKillCount = 0;
  let firstDeathCount = 0;
  let tradeKillCount = 0;
  let multiKillCount = 0;

  // 残局
  let vsOneCount = 0; let vsOneWon = 0;
  let vsTwoCount = 0; let vsTwoWon = 0;
  let vsThreeCount = 0; let vsThreeWon = 0;
  let vsFourCount = 0; let vsFourWon = 0;
  let vsFiveCount = 0; let vsFiveWon = 0;

  for (const s of stats) {
    const kills = s.kills ?? 0;
    const deaths = s.deaths ?? 0;
    const assists = s.assists ?? 0;

    // 优先使用真实回合数，回退到 kills+deaths 近似
    const mapRounds = s.rounds != null ? s.rounds : Math.max(kills + deaths, 1);
    // 实际回合数优先用 kills+deaths（比总回合更准确反映参与度）
    totalRounds += mapRounds;

    // KAST 加权（已有 kast % 值）
    if (s.kast != null) kastWeighted += s.kast * mapRounds;
    // ADR 加权
    if (s.adr != null) adrWeighted += s.adr * mapRounds;

    utilityDamageTotal += (s.utilityDamage ?? 0);
    firstKillCount += (s.firstKillCount ?? 0);
    firstDeathCount += (s.firstDeathCount ?? 0);
    tradeKillCount += (s.tradeKillCount ?? 0);

    multiKillCount += (s.twoKillCount ?? 0) + (s.threeKillCount ?? 0) + (s.fourKillCount ?? 0) + (s.fiveKillCount ?? 0);

    vsOneCount += (s.vsOneCount ?? 0); vsOneWon += (s.vsOneWonCount ?? 0);
    vsTwoCount += (s.vsTwoCount ?? 0); vsTwoWon += (s.vsTwoWonCount ?? 0);
    vsThreeCount += (s.vsThreeCount ?? 0); vsThreeWon += (s.vsThreeWonCount ?? 0);
    vsFourCount += (s.vsFourCount ?? 0); vsFourWon += (s.vsFourWonCount ?? 0);
    vsFiveCount += (s.vsFiveCount ?? 0); vsFiveWon += (s.vsFiveWonCount ?? 0);
  }

  // ── 致盲统计 ──
  let blindsEnemies = 0;
  let blindsDuration = 0;
  for (const b of blinds) {
    // 只算致盲敌方
    if (b.flashedSide !== b.flasherSide) {
      blindsEnemies++;
      blindsDuration += (b.durationSeconds ?? 0);
    }
  }

  // ── 计算比率 ──
  const kast = totalRounds > 0 ? kastWeighted / totalRounds : 0;
  const adr = totalRounds > 0 ? adrWeighted / totalRounds : 0;
  const utilityDamagePerRound = totalRounds > 0 ? utilityDamageTotal / totalRounds : 0;

  const firstKillRate = totalRounds > 0 ? firstKillCount / totalRounds : 0;
  const firstDeathRate = totalRounds > 0 ? firstDeathCount / totalRounds : 0;
  const entrySuccessRate = (firstKillCount + firstDeathCount) > 0
    ? firstKillCount / (firstKillCount + firstDeathCount)
    : 0;
  const multiKillRate = totalRounds > 0 ? multiKillCount / totalRounds : 0;
  const tradeKillRate = totalRounds > 0 ? tradeKillCount / totalRounds : 0;

  const totalClutchAttempts = vsOneCount + vsTwoCount + vsThreeCount + vsFourCount + vsFiveCount;
  const totalClutchWins = vsOneWon + vsTwoWon + vsThreeWon + vsFourWon + vsFiveWon;
  const clutchWinRate = totalClutchAttempts > 0 ? totalClutchWins / totalClutchAttempts : 0;

  return {
    totalRounds,
    kast,
    adr,
    utilityDamagePerRound,
    firstKillRate,
    firstDeathRate,
    entrySuccessRate,
    multiKillRate,
    clutchWinRate,
    clutchAttempts: totalClutchAttempts,
    clutchWins: totalClutchWins,
    firstKillCount,
    firstDeathCount,
    vsOne: { count: vsOneCount, won: vsOneWon },
    vsTwo: { count: vsTwoCount, won: vsTwoWon },
    vsThree: { count: vsThreeCount, won: vsThreeWon },
    vsFour: { count: vsFourCount, won: vsFourWon },
    vsFive: { count: vsFiveCount, won: vsFiveWon },
    tradeKillRate,
    blindsEnemies,
    blindsDuration,
  };
}
