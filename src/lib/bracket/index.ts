// Bracket 适配层——所有 brackets-manager 调用必须经过此模块
// 禁止在业务代码中直接 import brackets-manager
//
// 持久化策略：bracket 完整状态（Database JSON）存储在 seasons.bracket_data
// 每次 advanceMatch 调用时：读取 → 重建内存 manager → 更新 → 序列化写回
//
// 参与者 ID 映射：seeding 按 draft_order ASC 排列
// 即 participant[n].id === n 对应 teams[n]（draft_order = n+1 的队伍）

import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import { Status } from "brackets-model";
import type { Database } from "brackets-manager";
import type { Match } from "@/types/match";
import type { Team } from "@/db/schema/teams";

type QualifierFormat = "round_robin" | "swiss";
type PlayoffFormat = "double_elim" | "single_elim";

/** brackets-manager stage 的轻量引用（仅 id + name） */
export type BracketStageRef = { id: number; name: string };
/** brackets-manager participant 的轻量引用 */
export type BracketParticipantRef = { id: number; name: string };
/** brackets-manager round 的轻量引用 */
export type BracketRoundRef = { id: number; stage_id: number; number: number };

export interface BracketStage {
  id: number;
  tournament_id?: number;
  name: string;
  number?: number;
  type: "double_elimination" | "single_elimination" | "round_robin";
  settings?: Record<string, unknown>;
}

export interface BracketMatch {
  id: number;
  stage_id: number;
  group_id: number;
  round_id: number;
  number: number;
  status: number;
  opponent1: { id: number | null; score: number | null; result?: "win" | "loss" } | null;
  opponent2: { id: number | null; score: number | null; result?: "win" | "loss" } | null;
}

export interface BracketMatchGame {
  id: number;
  parent_id: number;
  stage_id?: number;
  number?: number;
  status?: number;
  opponent1?: { id: number | null; score: number | null; result?: "win" | "loss" } | null;
  opponent2?: { id: number | null; score: number | null; result?: "win" | "loss" } | null;
}

export interface BracketData {
  stage: BracketStage[];
  match: BracketMatch[];
  match_game: BracketMatchGame[];
  participant: { id: number; name: string }[];
}

// 封装的"已确定双方"比赛信息，供调用者批量创建 DB match 记录
export interface ResolvedBracketMatch {
  bracketMatchId: number;
  stageId: number;
  teamAParticipantId: number;
  teamBParticipantId: number;
  roundNumber: number;
}

function buildManager(data: Database): { manager: BracketsManager; db: InMemoryDatabase } {
  const db = new InMemoryDatabase();
  db.setData(data);
  const manager = new BracketsManager(db);
  return { manager, db };
}

/**
 * 根据队伍列表与赛季 capability 初始化赛季 bracket。
 * 返回序列化后的 Database JSON 以及所有已确定对阵的 bracket match。
 * 调用方负责：将 data 写入 seasons.bracket_data，对每个 resolved match 创建 DB 记录。
 *
 * teams 必须按 draft_order ASC 排列（draft_order=1 → participantId=0）。
 */
export async function generateBracket(
  teams: Team[],
  config: {
    qualifierFormat: QualifierFormat | null;
    playoffFormat: PlayoffFormat | null;
    qualifierName?: string;
    playoffName?: string;
  }
): Promise<{ data: Database; resolvedMatches: ResolvedBracketMatch[] }> {
  const db = new InMemoryDatabase();
  const manager = new BracketsManager(db);

  const seeding = teams.map((t) => t.name);

  if (config.qualifierFormat !== null) {
    // 排位赛 stage（round_robin 或 swiss；swiss 暂不支持，统一用 round_robin）
    await manager.create.stage({
      tournamentId: 0,
      name: config.qualifierName ?? "排位赛",
      type: "round_robin",
      seeding,
      settings: {
        groupCount: 1,
        roundRobinMode: "simple",
      },
    });
  }

  if (config.playoffFormat !== null) {
    const type =
      config.playoffFormat === "double_elim" ? "double_elimination" : "single_elimination";
    await manager.create.stage({
      tournamentId: 0,
      name: config.playoffName ?? "正赛",
      type,
      seeding: config.qualifierFormat !== null
        // 排位赛结束后才确定晋级顺序；先全部 TBD
        ? new Array(teams.length).fill(null)
        : seeding,
      settings: {
        grandFinal: "simple",
        seedOrdering: ["inner_outer"],
      },
    });
  }

  const data = await manager.export();
  const resolvedMatches = collectResolvedMatches(data);

  return { data, resolvedMatches };
}

/**
 * 推进一场比赛结果，更新 bracket 状态机，写回序列化数据。
 * 返回新出现的已确定对阵（供调用方创建新 DB match 记录）。
 *
 * @param bracketNodeId  matches.bracket_node_id（brackets-manager match ID 字符串）
 * @param scoreA         TeamA 系列赛胜图数
 * @param scoreB         TeamB 系列赛胜图数
 * @param currentData    当前 seasons.bracket_data
 */
export async function advanceMatch(
  bracketNodeId: string,
  scoreA: number,
  scoreB: number,
  currentData: Database
): Promise<{ updatedData: Database; newResolvedMatches: ResolvedBracketMatch[] }> {
  const { manager, db } = buildManager(currentData);

  const matchId = parseInt(bracketNodeId, 10);
  const isWinA = scoreA > scoreB;

  await manager.update.match({
    id: matchId,
    opponent1: { score: scoreA, result: isWinA ? "win" : "loss" },
    opponent2: { score: scoreB, result: isWinA ? "loss" : "win" },
    status: Status.Completed,
  });

  const updatedData = await manager.export();

  // 找出本次更新后新增的已确定对阵（对比更新前已有的 bracketMatchId 集合）
  const prevResolved = new Set(collectResolvedMatches(currentData).map((m) => m.bracketMatchId));
  const allResolved = collectResolvedMatches(updatedData);
  const newResolvedMatches = allResolved.filter((m) => !prevResolved.has(m.bracketMatchId));

  return { updatedData, newResolvedMatches };
}

/**
 * 从 seasons.bracket_data 序列化为 brackets-viewer 可消费的格式。
 * 若 bracket 尚未生成（data 为 null），返回空结构。
 */
export function serializeBracket(
  data: Database | null,
  teams: Team[]
): BracketData {
  if (!data) {
    return { stage: [], match: [], match_game: [], participant: [] };
  }

  // participant 表只有 name；id 顺序对应 teams 按 draft_order 排列
  const participant = (data.participant as BracketParticipantRef[]).map((p) => ({
    id: p.id,
    name: p.name,
  }));

  const stage: BracketStage[] = (
    data.stage as Array<{
      id: number;
      tournament_id?: number;
      name: string;
      number?: number;
      type: string;
      settings?: Record<string, unknown>;
    }>
  ).map((s) => ({
    id: s.id,
    tournament_id: s.tournament_id,
    name: s.name,
    number: s.number,
    type: s.type as BracketStage["type"],
    settings: s.settings ?? {},
  }));

  const match: BracketMatch[] = (
    data.match as Array<{
      id: number;
      stage_id: number;
      group_id: number;
      round_id: number;
      number: number;
      status: number;
      opponent1: { id: number | null; score: number | null; result?: string } | null;
      opponent2: { id: number | null; score: number | null; result?: string } | null;
    }>
  ).map((m) => ({
    id: m.id,
    stage_id: m.stage_id,
    group_id: m.group_id,
    round_id: m.round_id,
    number: m.number,
    status: m.status,
    opponent1: m.opponent1
      ? {
          id: m.opponent1.id,
          score: m.opponent1.score ?? null,
          result: m.opponent1.result as "win" | "loss" | undefined,
        }
      : null,
    opponent2: m.opponent2
      ? {
          id: m.opponent2.id,
          score: m.opponent2.score ?? null,
          result: m.opponent2.result as "win" | "loss" | undefined,
        }
      : null,
  }));

  return {
    stage,
    match,
    match_game: (data.match_game as unknown as BracketMatchGame[] | undefined) ?? [],
    participant,
  };
}

/**
 * 用积分榜顺序更新正赛 stage 的种子，并返回确定的第一轮对阵。
 * 在所有排位赛结束后、管理员点击「生成正赛」时调用。
 *
 * @param seededTeamNames  按种子排序的队伍名称数组（seed 1 在 index 0）
 * @param currentData      当前 seasons.bracket_data
 */
export async function seedPlayoff(
  seededTeamNames: string[],
  currentData: Database,
  stageName = "正赛",
): Promise<{ updatedData: Database; resolvedMatches: ResolvedBracketMatch[] }> {
  const { manager } = buildManager(currentData);

  const stages = currentData.stage as BracketStageRef[];
  const playoffStage = stages.find((s) => s.name === stageName);
  if (!playoffStage) throw new Error(`${stageName} stage 未找到，请先生成赛程`);

  // 用实际队伍名替换 TBD seed
  await manager.update.seeding(playoffStage.id, seededTeamNames);

  // 重新导出，找出已确定双方的第一轮对阵
  const updatedData = await manager.export();
  const resolvedMatches = collectResolvedMatches(updatedData);

  return { updatedData, resolvedMatches };
}

// ─── 内部工具 ───────────────────────────────────────────────────────────────

/**
 * 从 Database JSON 中筛选出双方参与者均已确定的比赛（非 TBD/BYE）。
 */
function collectResolvedMatches(data: Database): ResolvedBracketMatch[] {
  const roundMap = new Map<number, { stageId: number; number: number }>();
  for (const r of data.round as BracketRoundRef[]) {
    roundMap.set(r.id, { stageId: r.stage_id, number: r.number });
  }

  const resolved: ResolvedBracketMatch[] = [];
  for (const m of data.match as Array<{
    id: number;
    round_id: number;
    opponent1: { id: number | null } | null;
    opponent2: { id: number | null } | null;
  }>) {
    if (
      m.opponent1?.id !== null &&
      m.opponent1?.id !== undefined &&
      m.opponent2?.id !== null &&
      m.opponent2?.id !== undefined
    ) {
      const round = roundMap.get(m.round_id);
      resolved.push({
        bracketMatchId: m.id,
        stageId: round?.stageId ?? 0,
        teamAParticipantId: m.opponent1.id,
        teamBParticipantId: m.opponent2.id,
        roundNumber: round?.number ?? 0,
      });
    }
  }
  return resolved;
}
