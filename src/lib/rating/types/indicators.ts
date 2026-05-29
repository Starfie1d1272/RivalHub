/**
 * RRIndicators — 指标层（Layer 0）
 *
 * 从单张 demo 提取的所有原始信号，是 RR 标量和 PRISM 八维画像的共同输入。
 * 与 src/lib/demo/to-rr-indicators.ts 中的 RRIndicators 接口保持结构同步。
 */
export interface RRIndicators {
  steamId64: string;
  totalRounds: number;

  kills: number;
  deaths: number;
  assists: number;
  kpr: number;
  dpr: number;
  apr: number;
  adr: number;
  hsPercent: number;
  kast: number;
  survivalRate: number;

  twoKillRounds: number;
  threeKillRounds: number;
  fourKillRounds: number;
  fiveKillRounds: number;
  multiKillRate: number;

  firstKillCount: number;
  firstDeathCount: number;
  firstKillRate: number;
  firstDeathRate: number;
  openingDuelRate: number;
  openingDuelWinRate: number;

  tradeKillCount: number;
  tradeDeathCount: number;
  tradeKillRate: number;
  tradeDeathRate: number;

  clutchAttempts: number;
  clutchWins: number;
  clutchWinRate: number;
  clutchFrequency: number;
  clutchScore: number;
  clutchScoreRate: number;
  vsOne: { count: number; won: number };
  vsTwo: { count: number; won: number };
  vsThree: { count: number; won: number };
  vsFour: { count: number; won: number };
  vsFive: { count: number; won: number };

  awpKills: number;
  awpKillsPerRound: number;
  awpKillRate: number;
  sniperKills: number;
  sniperKillRate: number;
  awpMultiKillRate: number | null;
  awpDuelWinRate: number | null;

  utilityDamage: number;
  utilityDamagePerRound: number;
  flashAssistCount: number;
  flashAssistPerRound: number;
  blindDurationTotal: number;
  blindDurationPerRound: number;
  grenadeCount: number;
  grenadeCountPerRound: number;

  ecoRoundCount: number;
  forceRoundCount: number;
  fullBuyRoundCount: number;
  pistolRoundCount: number;
  avgEquipmentValue: number;

  roundSwingTotal: number | null;
  roundSwingPerKill: number | null;
}
