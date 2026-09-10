// Bracket 适配层——所有 brackets-manager 调用必须经过此模块。
// 业务代码只持有 StageConfig.key 与 CompetitionEntry.id；provider 的
// stage name 和 participant 数字 id 不得成为 RivalHub 的领域 identity。

import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import { Status } from "brackets-model";
import { eq, and } from "drizzle-orm";
import type { DB, TxDb } from "@/db/client";
import { competitionStageBracketStates } from "@/db/schema/competition-bracket-states";
import { matches, type Match } from "@/db/schema/matches";
import type { Database } from "brackets-manager";
import type { CompetitionEntry } from "@/db/schema/competition-entries";
import type { StageConfig } from "@/types/season";

export type { Database as BracketDatabase } from "brackets-manager";

export type BracketStageRef = {
  id: number;
  name: string;
  type?: string;
};

export type BracketParticipantRef = {
  id: number;
  name: string;
  /** Stable RivalHub identity; provider participant ids are not domain ids. */
  rivalhubEntryId: string;
};

export type BracketRoundRef = {
  id: number;
  stage_id: number;
  group_id: number;
  number: number;
};

export type BracketGroupRef = { id: number; stage_id: number; number: number };

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
  child_count: number;
  opponent1: { id: number | null; score?: number; result?: "win" | "loss" } | null;
  opponent2: { id: number | null; score?: number; result?: "win" | "loss" } | null;
}

export interface BracketMatchGame {
  id: number;
  parent_id: number;
  stage_id?: number;
  number?: number;
  status?: number;
  opponent1?: { id: number | null; score?: number; result?: "win" | "loss" } | null;
  opponent2?: { id: number | null; score?: number; result?: "win" | "loss" } | null;
}

export interface BracketData {
  stage: BracketStage[];
  match: BracketMatch[];
  match_game: BracketMatchGame[];
  participant: BracketParticipantRef[];
  group: BracketGroupRef[];
  round: BracketRoundRef[];
}

/** A provider match whose two RivalHub entries are already known. */
export interface ResolvedBracketMatch {
  bracketMatchId: number;
  stageId: number;
  entryAId: string;
  entryBId: string;
  roundNumber: number;
  /** 1=winner bracket, 2=loser bracket, 3=grand final. */
  groupNumber: number;
}

export interface ResolvedBracketMatchInput {
  seasonId: string;
  stageKey: string;
  resolved: ResolvedBracketMatch;
  format: "bo1" | "bo3" | "bo5";
  entryRound?: string | null;
}

type BracketStateDatabase = DB | TxDb;

/** Load one provider state owned by one logical stage. */
export async function loadStageBracketState(
  database: BracketStateDatabase,
  competitionId: string,
  stageKey: string,
): Promise<Database | null> {
  const row = await database.query.competitionStageBracketStates.findFirst({
    where: and(
      eq(competitionStageBracketStates.competitionId, competitionId),
      eq(competitionStageBracketStates.stageKey, stageKey),
    ),
  });
  return row?.data ?? null;
}

/** Load serialized provider views through the adapter; callers never read the provider table. */
export async function loadStageBracketViews(
  database: BracketStateDatabase,
  competitionId: string,
): Promise<Map<string, BracketData>> {
  const rows = await database.query.competitionStageBracketStates.findMany({
    where: eq(competitionStageBracketStates.competitionId, competitionId),
  });
  return new Map(rows.map((row) => [row.stageKey, serializeStageBracket(row.data)]));
}

/** Load only stable RivalHub entrants for standings/read-model consumers. */
export async function loadStageBracketEntrantIds(
  database: BracketStateDatabase,
  competitionId: string,
): Promise<Map<string, string[]>> {
  const views = await loadStageBracketViews(database, competitionId);
  return new Map([...views.entries()].map(([stageKey, data]) => [
    stageKey,
    data.participant.map((participant) => participant.rivalhubEntryId),
  ]));
}

/** Persist one provider state without exposing its storage table to callers. */
export async function saveStageBracketState(
  database: BracketStateDatabase,
  competitionId: string,
  stageKey: string,
  data: Database,
): Promise<void> {
  const updatedAt = new Date();
  await database
    .insert(competitionStageBracketStates)
    .values({ competitionId, stageKey, data, updatedAt })
    .onConflictDoUpdate({
      target: [competitionStageBracketStates.competitionId, competitionStageBracketStates.stageKey],
      set: { data, updatedAt },
    });
}

/**
 * Persist one resolved provider node without hiding divergent existing facts.
 * Retries are idempotent only when identity, stage and format all agree.
 */
export async function ensureResolvedBracketMatch(
  database: BracketStateDatabase,
  input: ResolvedBracketMatchInput,
): Promise<void> {
  const nodeId = input.resolved.bracketMatchId.toString();
  await database.insert(matches).values({
    seasonId: input.seasonId,
    entryAId: input.resolved.entryAId,
    entryBId: input.resolved.entryBId,
    stage: input.stageKey,
    format: input.format,
    status: "scheduled",
    bracketNodeId: nodeId,
    ...(input.entryRound === undefined ? {} : { entryRound: input.entryRound }),
  }).onConflictDoNothing();

  const existing = await database.query.matches.findFirst({
    where: and(
      eq(matches.seasonId, input.seasonId),
      eq(matches.stage, input.stageKey),
      eq(matches.bracketNodeId, nodeId),
    ),
  });
  if (!existing) {
    throw new Error(`bracket node ${nodeId} 写入后无法读取，拒绝继续`);
  }
  assertResolvedBracketMatchCompatible(existing, input);
}

export function assertResolvedBracketMatchCompatible(
  existing: Pick<Match, "seasonId" | "entryAId" | "entryBId" | "stage" | "format" | "bracketNodeId" | "entryRound">,
  input: ResolvedBracketMatchInput,
): void {
  const expectedNodeId = input.resolved.bracketMatchId.toString();
  const compatible = existing.seasonId === input.seasonId &&
    existing.entryAId === input.resolved.entryAId &&
    existing.entryBId === input.resolved.entryBId &&
    existing.stage === input.stageKey &&
    existing.format === input.format &&
    existing.bracketNodeId === expectedNodeId &&
    (input.entryRound === undefined || existing.entryRound === input.entryRound);
  if (!compatible) {
    throw new Error(`bracket node ${expectedNodeId} 与现有比赛事实不一致，拒绝静默复用`);
  }
}

function buildManager(data: Database): { manager: BracketsManager; db: InMemoryDatabase } {
  const memoryDb = new InMemoryDatabase();
  memoryDb.setData(data);
  return { manager: new BracketsManager(memoryDb), db: memoryDb };
}

function providerType(type: StageConfig["type"]): "double_elimination" | "single_elimination" | "round_robin" {
  if (type === "double_elim") return "double_elimination";
  if (type === "single_elim") return "single_elimination";
  if (type === "round_robin") return "round_robin";
  throw new Error("Swiss 必须由 src/lib/major/swiss.ts 拥有，不能经过通用 bracket adapter");
}

function stableSeeding(entries: CompetitionEntry[]): Array<{ name: string; rivalhubEntryId: string }> {
  return entries.map((entry) => ({ name: entry.name, rivalhubEntryId: entry.id }));
}

/** Create exactly one provider stage for one logical StageConfig. */
export async function createStageBracket(
  config: Pick<StageConfig, "key" | "name" | "type">,
  entries: CompetitionEntry[],
): Promise<{ data: Database; resolvedMatches: ResolvedBracketMatch[] }> {
  const memoryDb = new InMemoryDatabase();
  const manager = new BracketsManager(memoryDb);
  await manager.create.stage({
    tournamentId: 0,
    // This name is presentation-only. The row is loaded by config.key.
    name: config.name,
    type: providerType(config.type),
    seeding: stableSeeding(entries),
    settings: config.type === "round_robin"
      ? { groupCount: 1, roundRobinMode: "simple" }
      : { grandFinal: "simple", seedOrdering: ["inner_outer"] },
  });

  const data = await manager.export();
  return { data, resolvedMatches: collectResolvedMatches(data) };
}

/** Advance one provider node in a stage-scoped state. */
export async function advanceStageBracket(
  stageKey: string,
  bracketNodeId: string,
  result: { scoreA: number; scoreB: number },
  currentData: Database,
): Promise<{ updatedData: Database; newResolvedMatches: ResolvedBracketMatch[] }> {
  if (!stageKey.trim()) throw new Error("stageKey 不能为空");
  const { manager } = buildManager(currentData);
  const previousResolved = new Set(collectResolvedMatches(currentData).map((match) => match.bracketMatchId));
  const matchId = Number.parseInt(bracketNodeId, 10);
  if (!Number.isInteger(matchId)) throw new Error(`无效的 bracket node id: ${bracketNodeId}`);
  if (result.scoreA === result.scoreB) throw new Error("bracket 比赛不能以平局结束");

  await manager.update.match({
    id: matchId,
    opponent1: { score: result.scoreA, result: result.scoreA > result.scoreB ? "win" : "loss" },
    opponent2: { score: result.scoreB, result: result.scoreA > result.scoreB ? "loss" : "win" },
    status: Status.Completed,
  });

  const updatedData = await manager.export();
  const newResolvedMatches = collectResolvedMatches(updatedData)
    .filter((match) => !previousResolved.has(match.bracketMatchId));
  return { updatedData, newResolvedMatches };
}

/** Project provider state into the brackets-viewer contract. */
export function serializeStageBracket(data: Database | null): BracketData {
  if (!data) return { stage: [], match: [], match_game: [], participant: [], group: [], round: [] };

  const participant = (data.participant as unknown as BracketParticipantRef[]).map((item) => ({
    id: item.id,
    name: item.name,
    rivalhubEntryId: item.rivalhubEntryId,
  }));
  const stage = (data.stage as Array<BracketStage & { type: string }>).map((item) => ({
    id: item.id,
    tournament_id: item.tournament_id,
    name: item.name,
    number: item.number,
    type: item.type as BracketStage["type"],
    settings: item.settings ?? {},
  }));
  const match = (data.match as Array<{
    id: number;
    stage_id: number;
    group_id: number;
    round_id: number;
    number: number;
    status: number;
    child_count?: number;
    opponent1: { id: number | null; score: number | null; result?: string } | null;
    opponent2: { id: number | null; score: number | null; result?: string } | null;
  }>).map((item) => ({
    id: item.id,
    stage_id: item.stage_id,
    group_id: item.group_id,
    round_id: item.round_id,
    number: item.number,
    status: item.status,
    child_count: item.child_count ?? 0,
    opponent1: projectOpponent(item.opponent1),
    opponent2: projectOpponent(item.opponent2),
  }));

  return {
    stage,
    match,
    match_game: (data.match_game as BracketMatchGame[] | undefined) ?? [],
    participant,
    group: (data.group as BracketGroupRef[]).map((item) => ({ id: item.id, stage_id: item.stage_id, number: item.number })),
    round: (data.round as BracketRoundRef[]).map((item) => ({
      id: item.id,
      stage_id: item.stage_id,
      group_id: item.group_id,
      number: item.number,
    })),
  };
}

function projectOpponent(
  opponent: { id: number | null; score: number | null; result?: string } | null,
): BracketMatch["opponent1"] {
  if (!opponent) return null;
  return {
    id: opponent.id,
    score: opponent.score ?? undefined,
    result: opponent.result as "win" | "loss" | undefined,
  };
}

/** Resolve provider participants using stable metadata, never array position or name. */
export function collectResolvedMatches(data: Database): ResolvedBracketMatch[] {
  const participantById = new Map<number, BracketParticipantRef>(
    (data.participant as unknown as BracketParticipantRef[]).map((participant) => [participant.id, participant]),
  );
  const groupNumberById = new Map<number, number>(
    (data.group as BracketGroupRef[]).map((group) => [group.id, group.number]),
  );
  const roundById = new Map<number, BracketRoundRef>(
    (data.round as BracketRoundRef[]).map((round) => [round.id, round]),
  );

  const resolved: ResolvedBracketMatch[] = [];
  for (const match of data.match as Array<{
    id: number;
    group_id: number;
    round_id: number;
    opponent1: { id: number | null } | null;
    opponent2: { id: number | null } | null;
  }>) {
    const participantA = match.opponent1?.id == null ? undefined : participantById.get(match.opponent1.id);
    const participantB = match.opponent2?.id == null ? undefined : participantById.get(match.opponent2.id);
    if (!participantA?.rivalhubEntryId || !participantB?.rivalhubEntryId) continue;
    const round = roundById.get(match.round_id);
    resolved.push({
      bracketMatchId: match.id,
      stageId: round?.stage_id ?? 0,
      entryAId: participantA.rivalhubEntryId,
      entryBId: participantB.rivalhubEntryId,
      roundNumber: round?.number ?? 0,
      groupNumber: groupNumberById.get(match.group_id) ?? 1,
    });
  }
  return resolved;
}
