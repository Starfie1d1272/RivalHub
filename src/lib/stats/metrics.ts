export type MetricUnit = "number" | "percent" | "perRound" | "seconds" | "count";
export type SampleKind = "scoreboard" | "kills" | "rounds" | "openings" | "deaths" | "flashes" | "attempts" | "pistolRounds" | "opportunities" | "plants" | "weaponKills" | "maps";
export type MetricSampleMode = "fraction" | "denominator" | "hidden";

const sampleLabels: Record<SampleKind, string> = {
  scoreboard: "maps",
  kills: "kills",
  rounds: "rounds",
  openings: "openings",
  deaths: "deaths",
  flashes: "flashes",
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
  rating: metric("Rating", "number", 2, "scoreboard", "赛事使用的综合表现评分，用于比较整体发挥；不等同于单一击杀或伤害指标。", { rankingSampleKind: "rounds" }),
  adr: metric("ADR", "number", 1, "scoreboard", "每回合平均伤害（Average Damage per Round）。", { rankingSampleKind: "rounds" }),
  kd: metric("K/D", "number", 2, "scoreboard", "击杀数 ÷ 死亡数。", { rankingSampleKind: "rounds" }),
  kpr: metric("KPR", "perRound", 2, "scoreboard", "每回合平均击杀数（Kills per Round）。", { rankingSampleKind: "rounds" }),
  hs: metric("HS%", "percent", 1, "kills", "爆头击杀占全部击杀的比例。", { rankingSampleKind: "kills" }),
  we: metric("WE", "number", 1, "scoreboard", "武器效率指标，用于补充描述选手的击杀效率。", { rankingSampleKind: "rounds" }),
  rws: metric("RWS", "number", 2, "scoreboard", "Round Win Shares，用于描述选手对赢下回合的贡献。", { rankingSampleKind: "rounds" }),
  mk: metric("MK/R", "perRound", 2, "scoreboard", "每回合多杀产出。", { rankingSampleKind: "rounds" }),
  openingAttempt: metric("Open Att%", "percent", 1, "rounds", "参与回合首杀对枪的回合占比。数值越高，越频繁参与开局第一波交火。", { rankingSampleKind: "rounds" }),
  openingWin: metric("Open Win%", "percent", 1, "openings", "首杀对枪胜率：取得回合首杀的次数 ÷ 参与首杀对枪的次数。", { rankingSampleKind: "openings" }),
  firstKill: metric("FK/R", "perRound", 2, "rounds", "每回合取得首杀的次数。", { rankingSampleKind: "rounds" }),
  firstDeath: metric("FD/R", "perRound", 2, "rounds", "每回合成为首个阵亡者的次数。", { rankingSampleKind: "rounds" }),
  kast: metric("KAST", "percent", 1, "rounds", "有效回合参与率：回合中完成击杀、助攻、存活或被队友及时补枪之一即计入。", { rankingSampleKind: "rounds" }),
  survival: metric("Survival%", "percent", 1, "rounds", "回合结束时仍存活的回合占比。", { rankingSampleKind: "rounds" }),
  trade: metric("Trade/R", "perRound", 2, "rounds", "每回合补枪击杀：队友阵亡后在补枪窗口内完成的击杀 ÷ 出场回合。", { rankingSampleKind: "rounds" }),
  traded: metric("Traded%", "percent", 1, "deaths", "被补枪率：本人阵亡后被队友及时补枪的次数 ÷ 本人死亡次数。", { rankingSampleKind: "deaths" }),
  utility: metric("Util/R", "perRound", 2, "rounds", "每回合道具伤害。", { rankingSampleKind: "rounds" }),
  flashAssist: metric("FA/R", "perRound", 2, "rounds", "每回合闪光助攻。", { rankingSampleKind: "rounds" }),
  blindPerFlash: metric("Blind/Flash", "seconds", 1, "flashes", "每颗闪光平均造成的敌方致盲时间。只统计敌方致盲；队友被白不计入。", { sampleMode: "denominator", rankingSampleKind: "flashes" }),
  netBlindPerFlash: metric("Net Blind/Flash", "seconds", 1, "flashes", "每颗闪光对应的净敌方致盲时间。", { sampleMode: "denominator", rankingSampleKind: "flashes" }),
  hePerRound: metric("HE/R", "perRound", 2, "rounds", "每回合 HE 手雷伤害。", { rankingSampleKind: "rounds" }),
  firePerRound: metric("Fire/R", "perRound", 2, "rounds", "每回合燃烧弹或燃烧瓶伤害。", { rankingSampleKind: "rounds" }),
  smokePerRound: metric("Smoke/R", "perRound", 2, "rounds", "每回合烟雾弹相关产出。", { rankingSampleKind: "rounds" }),
  utilityKills: metric("Utility kills/R", "perRound", 2, "rounds", "每回合由伤害型道具造成的击杀。", { rankingSampleKind: "rounds" }),
  clutch: metric("Clutch%", "percent", 1, "attempts", "残局胜率：赢下残局的次数 ÷ 进入残局的次数。", { rankingSampleKind: "attempts" }),
  clutchFrequency: metric("Frequency/R", "perRound", 2, "rounds", "每回合进入残局的频率。", { rankingSampleKind: "rounds" }),
  pistol: metric("Pistol%", "percent", 1, "pistolRounds", "手枪局胜率。", { rankingSampleKind: "pistolRounds" }),
  roundWin: metric("RW%", "percent", 1, "rounds", "回合胜率。", { rankingSampleKind: "rounds" }),
  conversion: metric("R2 Conv", "percent", 1, "opportunities", "赢下手枪局后继续赢下第二回合的比例。", { rankingSampleKind: "opportunities" }),
  break: metric("R2 Break", "percent", 1, "opportunities", "输掉手枪局后在第二回合翻盘的比例。", { rankingSampleKind: "opportunities" }),
  fiveVFour: metric("5v4", "percent", 1, "opportunities", "取得 5v4 人数优势后最终赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  fourVFive: metric("4v5", "percent", 1, "opportunities", "先陷入 4v5 后仍翻盘赢下该回合的比例。", { rankingSampleKind: "opportunities" }),
  ecoSemi: metric("Eco/Semi", "percent", 1, "opportunities", "低经济方对更高经济方取得回合胜利的比例。", { rankingSampleKind: "opportunities" }),
  plantConversion: metric("Plant conv", "percent", 1, "plants", "完成下包后最终赢下回合的比例。", { rankingSampleKind: "plants" }),
  headshot: metric("HS%", "percent", 1, "kills", "爆头击杀占全部击杀的比例。", { rankingSampleKind: "kills" }),
  killShare: metric("Kill share", "percent", 1, "weaponKills", "该武器击杀占当前统计范围全部武器击杀的比例。", { rankingSampleKind: "weaponKills" }),
  killsPerRound: metric("Kills/R", "perRound", 2, "rounds", "每回合平均击杀数。", { rankingSampleKind: "rounds" }),
  damagePerRound: metric("DMG/R", "perRound", 1, "rounds", "每回合平均伤害。", { rankingSampleKind: "rounds" }),
  rounds: metric("Rounds", "count", 0, "rounds", "出场回合数。", { sampleMode: "hidden" }),
  maps: metric("Maps", "count", 0, "maps", "出场地图数。", { sampleMode: "hidden" }),
} as const;

export type StatsMetricKey = keyof typeof STATS_METRICS;
