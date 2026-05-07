// Bracket 适配层——所有 brackets-manager 调用必须经过此模块
// 禁止在业务代码中直接 import brackets-manager
// TODO: Phase 11 实装各函数体

import type { Match } from "@/types/match";

export interface BracketStage {
  id: number;
  name: string;
  type: "double_elimination" | "single_elimination" | "round_robin";
}

export interface BracketMatch {
  id: number;
  stageId: number;
  roundNumber: number;
  opponent1: { id: number; score: number | null; result?: "win" | "loss" } | null;
  opponent2: { id: number; score: number | null; result?: "win" | "loss" } | null;
}

export interface BracketData {
  stage: BracketStage[];
  match: BracketMatch[];
  participant: { id: number; name: string }[];
}

/**
 * 根据队伍列表初始化赛季 bracket 数据结构
 * 实现时调用 brackets-manager 的 manager.create()
 */
export async function generateBracket(
  _seasonId: string,
  _teamIds: string[],
  _bracketType: "double_elim" | "single_elim" | "round_robin"
): Promise<BracketData> {
  throw new Error("not implemented");
}

/**
 * 推进一场比赛结果，更新 bracket 状态
 * 实现时调用 brackets-manager 的 manager.update.match()
 */
export async function advanceMatch(
  _seasonId: string,
  _match: Match
): Promise<void> {
  throw new Error("not implemented");
}

/**
 * 从数据库读取 bracket 数据，序列化为 brackets-viewer 可消费的格式
 */
export async function serializeBracket(
  _seasonId: string
): Promise<BracketData> {
  throw new Error("not implemented");
}
