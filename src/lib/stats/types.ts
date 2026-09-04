/**
 * 统计筛选条件 — stage/mapName 为未来按阶段/地图下钻预留，当前可传 undefined
 *
 * 双轨兼容说明：match_player_stats 表同时承载 OCR 和 demo 导入数据，
 * source 字段（"ocr" | "demo"）将在 demo 导入功能建设时加入 schema，
 * 届时在此 interface 添加 source?: "ocr" | "demo" 即可，计算逻辑无需改动。
 */
export interface StatFilter {
  seasonId: string;
  /** 赛季阶段（matches.stage），如 "group" / "playoff"，undefined 为全量 */
  stage?: string;
  /** 指定地图名（matchMaps.mapName），undefined 为全量 */
  mapName?: string;
  /** 比赛格式过滤 */
  format?: "bo1" | "bo3" | "bo5";
  /** 排行榜最少图数门槛（默认 3） */
  minMaps?: number;
}

/** 聚合后的单选手统计 — in-memory 和 SQL 两条路径的共同输出格式 */
export interface AggregatedPlayerStats {
  userId: string | null;
  perfectName: string;
  maps: number;
  /** 已知回合数之和；所有回合事实都缺失时为 null。 */
  totalRounds: number | null;
  /** 每个 count 字段都保留“全量缺失”和真实 0 的区别。 */
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  firstKills: number | null;
  multiKills: number | null;
  clutches: number | null;
  /** sum(kills) / sum(deaths) */
  kd: number | null;
  /** sum(kills) / sum(rounds) */
  kpr: number | null;
  /** sum(firstKills) / sum(rounds) */
  fkpr: number | null;
  /** sum(multiKills) / sum(rounds) */
  mkpr: number | null;
  /** sum(clutches) / sum(rounds) */
  cpr: number | null;
  /** round-weighted: sum(adr × rounds) / sum(rounds) */
  adr: number | null;
  /** kill-weighted: sum(hs% × kills) / sum(kills) */
  hsPercent: number | null;
  /** simple avg by maps */
  ratingPro: number | null;
  /** simple avg by maps */
  rws: number | null;
  /** simple avg by maps */
  we: number | null;
}
