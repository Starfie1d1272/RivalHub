import type { StatsDisplayUnit } from "./display";

export type MetricUnit = StatsDisplayUnit;
export type SampleKind = "scoreboard" | "kills" | "rounds" | "openings" | "deaths" | "flashes" | "throws" | "attempts" | "pistolRounds" | "opportunities" | "plants" | "weaponKills" | "maps";
export type MetricSampleMode = "fraction" | "denominator" | "hidden";

const sampleLabels: Record<SampleKind, string> = {
  scoreboard: "maps",
  kills: "kills",
  rounds: "rounds",
  openings: "openings",
  deaths: "deaths",
  flashes: "flashes",
  throws: "throws",
  attempts: "attempts",
  pistolRounds: "pistol rounds",
  opportunities: "opportunities",
  plants: "plants",
  weaponKills: "weapon kills",
  maps: "maps",
};

function metric<K extends SampleKind>(
  label: string,
  unit: MetricUnit,
  precision: number,
  sampleKind: K,
  description: string,
  options: { sampleMode?: MetricSampleMode; rankingSampleKind?: SampleKind | null } = {},
) {
  return {
    label,
    unit,
    precision,
    sampleKind,
    sampleLabel: sampleLabels[sampleKind],
    description,
    sampleMode: options.sampleMode ?? "fraction",
    rankingSampleKind: options.rankingSampleKind ?? null,
    rankingSampleLabel: options.rankingSampleKind ? sampleLabels[options.rankingSampleKind] : null,
  } as const;
}

export const STATS_METRICS = {
  rating: metric("Rating", "number", 2, "scoreboard", "综合衡量选手或队伍整体表现的评分，适合横向比较当前统计范围内的发挥。", { rankingSampleKind: "rounds" }),
  adr: metric("ADR", "number", 1, "scoreboard", "平均每回合造成的伤害。", { rankingSampleKind: "rounds" }),
  kd: metric("K/D", "number", 2, "scoreboard", "击杀数与死亡数的比值。", { rankingSampleKind: "rounds" }),
  kpr: metric("KPR", "perRound", 2, "scoreboard", "平均每回合击杀数。", { rankingSampleKind: "rounds" }),
  hs: metric("HS%", "ratioPercent", 1, "kills", "爆头击杀占全部击杀的比例。", { rankingSampleKind: "kills" }),
  we: metric("WE", "number", 1, "scoreboard", "武器效率，用于描述选手的击杀产出。", { rankingSampleKind: "rounds" }),
  rws: metric("RWS", "number", 2, "scoreboard", "回合胜利贡献指标（Round Win Shares）。", { rankingSampleKind: "rounds" }),
  mk: metric("MK/100r", "per100Round", 1, "scoreboard", "每 100 回合多杀回合数。", { rankingSampleKind: "rounds" }),
  openingAttempt: metric("Attempts%", "ratioPercent", 1, "rounds", "参与首杀对枪的回合占比，反映开局交火参与频率。", { rankingSampleKind: "rounds" }),
  openingWin: metric("Success%", "ratioPercent", 1, "openings", "首杀对枪胜率：首杀次数 ÷ 首杀对枪次数。", { rankingSampleKind: "openings" }),
  firstKill: metric("FK/100r", "per100Round", 2, "rounds", "每 100 回合取得首杀的次数。", { rankingSampleKind: "rounds" }),
  firstDeath: metric("FD/100r", "per100Round", 2, "rounds", "每 100 回合成为首个阵亡者的次数。", { rankingSampleKind: "rounds" }),
  kast: metric("KAST", "ratioPercent", 1, "rounds", "完成击杀、助攻、存活或被队友及时补枪的回合占比。", { rankingSampleKind: "rounds" }),
  survival: metric("Survival%", "ratioPercent", 1, "rounds", "回合结束时存活的回合占比。", { rankingSampleKind: "rounds" }),
  trade: metric("Trade/100r", "per100Round", 1, "rounds", "每 100 回合完成的补枪击杀次数。", { rankingSampleKind: "rounds" }),
  traded: metric("Traded%", "ratioPercent", 1, "deaths", "本人阵亡后被队友及时补枪的死亡占比。", { rankingSampleKind: "deaths" }),
  assist: metric("A/100r", "per100Round", 1, "rounds", "每 100 回合取得的助攻次数。", { rankingSampleKind: "rounds" }),
  tradedOpening: metric("Opening deaths traded", "count", 0, "openings", "本人输掉首杀对枪后，该次死亡被队友及时补枪的次数。", { sampleMode: "hidden" }),
  utility: metric("Util/r", "perRound", 2, "rounds", "平均每回合道具伤害。", { rankingSampleKind: "rounds" }),
  flashAssist: metric("FA/100r", "per100Round", 2, "rounds", "每 100 回合闪光助攻次数。", { rankingSampleKind: "rounds" }),
  blindPerFlash: metric("Blind/Flash", "seconds", 2, "flashes", "每颗闪光对敌方造成的平均致盲时间。", { sampleMode: "denominator", rankingSampleKind: "flashes" }),
  netBlindPerFlash: metric("Net Blind/Flash", "seconds", 2, "flashes", "每颗闪光对敌方产生的平均净致盲时间。", { sampleMode: "denominator", rankingSampleKind: "flashes" }),
  enemyBlindPerRound: metric("Enemy blind/r", "seconds", 2, "rounds", "平均每回合对敌方造成的致盲时间。", { rankingSampleKind: "rounds" }),
  teamBlindPerRound: metric("Team blind/r", "seconds", 2, "rounds", "平均每回合对队友造成的致盲时间。", { rankingSampleKind: "rounds" }),
  hePerRound: metric("HE/r", "perRound", 2, "rounds", "平均每回合 HE 手雷伤害。", { rankingSampleKind: "rounds" }),
  hePerThrow: metric("HE dmg/throw", "number", 1, "throws", "每次投掷 HE 手雷平均造成的伤害。", { sampleMode: "denominator", rankingSampleKind: "throws" }),
  firePerRound: metric("Fire/r", "perRound", 2, "rounds", "平均每回合燃烧弹或燃烧瓶伤害。", { rankingSampleKind: "rounds" }),
  firePerThrow: metric("Fire dmg/throw", "number", 1, "throws", "每次投掷燃烧弹或燃烧瓶平均造成的伤害。", { sampleMode: "denominator", rankingSampleKind: "throws" }),
  smokePerRound: metric("Smoke/r", "perRound", 2, "rounds", "平均每回合投掷的烟雾弹数量。", { rankingSampleKind: "rounds" }),
  utilityKills: metric("Utility K/100r", "per100Round", 2, "rounds", "每 100 回合由伤害型道具造成的击杀。", { rankingSampleKind: "rounds" }),
  clutch: metric("Clutch%", "ratioPercent", 1, "attempts", "残局胜率：残局胜利次数 ÷ 残局尝试次数。", { rankingSampleKind: "attempts" }),
  clutchFrequency: metric("C/100r", "per100Round", 2, "rounds", "每 100 回合残局胜利次数。", { rankingSampleKind: "rounds" }),
  pistol: metric("Pistol Win%", "ratioPercent", 1, "pistolRounds", "手枪局胜率。", { rankingSampleKind: "pistolRounds" }),
  roundWin: metric("RW%", "ratioPercent", 1, "rounds", "回合胜率。", { rankingSampleKind: "rounds" }),
  conversion: metric("R2 Conv", "ratioPercent", 1, "opportunities", "手枪局取胜后继续赢下第二回合的比例。", { rankingSampleKind: "opportunities" }),
  break: metric("R2 Break", "ratioPercent", 1, "opportunities", "手枪局失利后赢下第二回合的比例。", { rankingSampleKind: "opportunities" }),
  fiveVFour: metric("5v4", "ratioPercent", 1, "opportunities", "进入 5v4 人数优势后赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  fourVFive: metric("4v5", "ratioPercent", 1, "opportunities", "进入 4v5 人数劣势后赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  fiveVThree: metric("5v3", "ratioPercent", 1, "opportunities", "进入 5v3 人数优势后赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  threeVFive: metric("3v5", "ratioPercent", 1, "opportunities", "进入 3v5 人数劣势后赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  ecoSemi: metric("Eco/Semi Win%", "ratioPercent", 1, "opportunities", "低经济方对高经济方的回合胜率。", { rankingSampleKind: "opportunities" }),
  plantConversion: metric("Plant conv", "ratioPercent", 1, "plants", "完成下包后的回合胜率。", { rankingSampleKind: "plants" }),
  headshot: metric("HS%", "ratioPercent", 1, "kills", "爆头击杀占全部击杀的比例。", { rankingSampleKind: "kills" }),
  killShare: metric("Kill share", "ratioPercent", 1, "weaponKills", "该武器击杀占当前范围全部武器击杀的比例。", { rankingSampleKind: "weaponKills" }),
  killsPerRound: metric("Kills/r", "perRound", 2, "rounds", "平均每回合击杀数。", { rankingSampleKind: "rounds" }),
  damagePerRound: metric("ADR", "perRound", 1, "rounds", "平均每回合伤害。", { rankingSampleKind: "rounds" }),
  rounds: metric("Rounds", "count", 0, "rounds", "出场回合数。", { sampleMode: "hidden" }),
  maps: metric("Maps", "count", 0, "maps", "出场地图数。", { sampleMode: "hidden" }),
} as const;

export type StatsMetricKey = keyof typeof STATS_METRICS;
