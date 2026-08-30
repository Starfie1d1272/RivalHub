import { and, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import {
  auditLogs,
  majorFinalResults,
  matches,
  postEventAdjudications,
  seasons,
  competitionEntries,
  tournamentHonors,
  type AdjudicationImpact,
  type PostEventAdjudication,
  type TournamentHonor,
} from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";

export const ADJUDICATION_IMPACTS = [
  "canonical_matches",
  "final_result",
  "official_placements",
  "honors",
  "none",
] as const satisfies readonly AdjudicationImpact[];

type AdjudicationTarget = "season" | "entry" | "user" | "match";
type AdjudicationKind = "team_sanction" | "result_statement" | "placement_statement" | "honor_directive";
type HonorType = "champion" | "runner_up" | "placement" | "manual_award";
type HonorBasis = "final_result" | "manual" | "adjudication";

type PlacementGroup = { from: number; to: number; entryIds: string[] };

function validateImpacts(impacts: readonly AdjudicationImpact[]): AdjudicationImpact[] {
  const distinct = [...new Set(impacts)];
  if (distinct.length === 0 || !distinct.every((impact) => ADJUDICATION_IMPACTS.includes(impact))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "裁决影响范围不合法。");
  }
  if (distinct.includes("none") && distinct.length !== 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "无实际影响的裁决不能同时声明其他影响范围。");
  }
  return distinct;
}

function parsePlacementGroups(value: unknown): PlacementGroup[] {
  if (!Array.isArray(value)) throw new AppError(ErrorCode.INTERNAL_ERROR, "官方名次分组格式损坏。");
  const groups = value.map((group): PlacementGroup => {
    if (!group || typeof group !== "object") throw new AppError(ErrorCode.INTERNAL_ERROR, "官方名次分组格式损坏。");
    const candidate = group as Partial<PlacementGroup>;
    if (!Number.isInteger(candidate.from) || !Number.isInteger(candidate.to) || !Array.isArray(candidate.entryIds) || !candidate.entryIds.every((id) => typeof id === "string")) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, "官方名次分组格式损坏。");
    }
    return { from: candidate.from!, to: candidate.to!, entryIds: candidate.entryIds! };
  });
  return groups;
}

async function lockFinalResultInTx(tx: TxDb, seasonId: string) {
  const [result] = await tx.select().from(majorFinalResults)
    .where(eq(majorFinalResults.seasonId, seasonId)).for("update");
  if (!result) throw new AppError(ErrorCode.NOT_FOUND, "该赛事尚未形成正式最终结果。");
  return result;
}

async function assertEntryBelongsToSeasonInTx(tx: TxDb, seasonId: string, entryId: string): Promise<void> {
  const [team] = await tx.select({ id: competitionEntries.id }).from(competitionEntries)
    .where(and(eq(competitionEntries.id, entryId), eq(competitionEntries.competitionId, seasonId)));
  if (!team) throw new AppError(ErrorCode.VALIDATION_FAILED, "目标队伍不属于当前赛事。");
}

async function assertMatchBelongsToSeasonInTx(tx: TxDb, seasonId: string, matchId: string): Promise<void> {
  const [match] = await tx.select({ id: matches.id }).from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.seasonId, seasonId)));
  if (!match) throw new AppError(ErrorCode.VALIDATION_FAILED, "目标比赛不属于当前赛事。");
}

export async function confirmMajorFinalResultInTx(
  tx: TxDb,
  args: { seasonId: string; actorId: string },
): Promise<{ resultId: string; alreadyConfirmed: boolean }> {
  const result = await lockFinalResultInTx(tx, args.seasonId);
  if (result.status === "confirmed") return { resultId: result.id, alreadyConfirmed: true };
  await tx.update(majorFinalResults).set({
    status: "confirmed",
    confirmedAt: new Date(),
    confirmedBy: args.actorId,
  }).where(eq(majorFinalResults.id, result.id));
  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "major.result.confirm",
    actorId: args.actorId,
    targetId: result.id,
    targetType: "major_final_result",
    meta: { championEntryId: result.championEntryId, placementGroupCount: parsePlacementGroups(result.placementGroups).length },
  });
  return { resultId: result.id, alreadyConfirmed: false };
}

export async function createPostEventAdjudicationInTx(
  tx: TxDb,
  args: {
    seasonId: string;
    clientRequestId: string;
    kind: AdjudicationKind;
    target: AdjudicationTarget;
    targetEntryId?: string | null;
    targetUserId?: string | null;
    targetMatchId?: string | null;
    impacts: readonly AdjudicationImpact[];
    reason: string;
    publicExplanation: string;
    internalEvidence?: string | null;
    actorId: string;
  },
): Promise<{ adjudicationId: string; created: boolean }> {
  const [existing] = await tx.select().from(postEventAdjudications)
    .where(eq(postEventAdjudications.clientRequestId, args.clientRequestId)).for("update");
  if (existing) {
    if (existing.seasonId !== args.seasonId) throw new AppError(ErrorCode.VALIDATION_FAILED, "幂等请求键已属于另一项裁决。");
    return { adjudicationId: existing.id, created: false };
  }

  const impacts = validateImpacts(args.impacts);
  const targetIds = {
    entry: args.targetEntryId ?? null,
    user: args.targetUserId ?? null,
    match: args.targetMatchId ?? null,
  };
  if ((args.target === "entry" && !targetIds.entry) || (args.target === "user" && !targetIds.user) || (args.target === "match" && !targetIds.match)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "裁决目标与目标事实不一致。");
  }
  if ((args.target === "season" && (targetIds.entry || targetIds.user || targetIds.match)) ||
      (args.target !== "entry" && targetIds.entry) || (args.target !== "user" && targetIds.user) || (args.target !== "match" && targetIds.match)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "裁决目标必须唯一且明确。");
  }
  if (targetIds.entry) await assertEntryBelongsToSeasonInTx(tx, args.seasonId, targetIds.entry);
  if (targetIds.match) await assertMatchBelongsToSeasonInTx(tx, args.seasonId, targetIds.match);

  const [created] = await tx.insert(postEventAdjudications).values({
    seasonId: args.seasonId,
    clientRequestId: args.clientRequestId,
    kind: args.kind,
    target: args.target,
    impacts,
    targetEntryId: targetIds.entry,
    targetUserId: targetIds.user,
    targetMatchId: targetIds.match,
    reason: args.reason,
    publicExplanation: args.publicExplanation,
    internalEvidence: args.internalEvidence ?? null,
    createdBy: args.actorId,
  }).onConflictDoNothing().returning({ id: postEventAdjudications.id });
  if (!created) {
    const [retry] = await tx.select({ id: postEventAdjudications.id, seasonId: postEventAdjudications.seasonId })
      .from(postEventAdjudications).where(eq(postEventAdjudications.clientRequestId, args.clientRequestId));
    if (retry?.seasonId === args.seasonId) return { adjudicationId: retry.id, created: false };
    throw new AppError(ErrorCode.VALIDATION_FAILED, "赛后裁决幂等键或目标发生冲突。");
  }
  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "postevent.adjudication.create",
    actorId: args.actorId,
    targetId: created.id,
    targetType: "post_event_adjudication",
    meta: { kind: args.kind, target: args.target, targetEntryId: targetIds.entry, targetUserId: targetIds.user, targetMatchId: targetIds.match, impacts },
  });
  return { adjudicationId: created.id, created: true };
}

export async function revokePostEventAdjudicationInTx(
  tx: TxDb,
  args: { adjudicationId: string; actorId: string; reason: string },
): Promise<{ adjudicationId: string; alreadyRevoked: boolean }> {
  const [adjudication] = await tx.select().from(postEventAdjudications)
    .where(eq(postEventAdjudications.id, args.adjudicationId)).for("update");
  if (!adjudication) throw new AppError(ErrorCode.NOT_FOUND, "赛后裁决不存在。");
  if (adjudication.status === "revoked") return { adjudicationId: adjudication.id, alreadyRevoked: true };
  await tx.update(postEventAdjudications).set({
    status: "revoked",
    revokedAt: new Date(),
    revokedBy: args.actorId,
    revocationReason: args.reason,
  }).where(eq(postEventAdjudications.id, adjudication.id));
  await tx.insert(auditLogs).values({
    seasonId: adjudication.seasonId,
    action: "postevent.adjudication.revoke",
    actorId: args.actorId,
    targetId: adjudication.id,
    targetType: "post_event_adjudication",
    meta: { reason: args.reason },
  });
  return { adjudicationId: adjudication.id, alreadyRevoked: false };
}

function slotForHonor(args: { type: HonorType; placementFrom?: number; placementTo?: number; entryId?: string | null; honorKey?: string }): string {
  if (args.type === "champion" || args.type === "runner_up") return args.type;
  if (args.type === "placement") return `placement:${args.placementFrom}-${args.placementTo}:${args.entryId ?? "unassigned"}`;
  if (!args.honorKey?.trim()) throw new AppError(ErrorCode.VALIDATION_FAILED, "手动奖项必须提供稳定的奖项键。");
  return `manual:${args.honorKey.trim()}`;
}

function assertFinalResultRecipient(
  result: { championEntryId: string; placementGroups: unknown },
  args: { type: HonorType; entryId?: string | null; placementFrom?: number; placementTo?: number },
): void {
  if (!args.entryId) throw new AppError(ErrorCode.VALIDATION_FAILED, "基于正式结果的荣誉必须授予队伍。");
  if (args.type === "champion" && args.entryId !== result.championEntryId) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "冠军荣誉只能授予官方结果中的冠军队伍。");
  }
  const groups = parsePlacementGroups(result.placementGroups);
  if (args.type === "runner_up") {
    const runnerUp = groups.find((group) => group.from === 2 && group.to === 2);
    if (!runnerUp?.entryIds.includes(args.entryId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "亚军荣誉只能授予官方结果中的亚军队伍。");
  }
  if (args.type === "placement") {
    const group = groups.find((candidate) => candidate.from === args.placementFrom && candidate.to === args.placementTo);
    if (!group?.entryIds.includes(args.entryId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "名次荣誉必须与官方名次分组完全一致。");
  }
}

export async function grantTournamentHonorInTx(
  tx: TxDb,
  args: {
    seasonId: string;
    clientRequestId: string;
    type: HonorType;
    label: string;
    basis: HonorBasis;
    entryId?: string | null;
    userId?: string | null;
    placementFrom?: number;
    placementTo?: number;
    honorKey?: string;
    adjudicationId?: string | null;
    actorId: string;
  },
): Promise<{ honorId: string; created: boolean }> {
  const [existing] = await tx.select().from(tournamentHonors)
    .where(eq(tournamentHonors.clientRequestId, args.clientRequestId)).for("update");
  if (existing) {
    if (existing.seasonId !== args.seasonId) throw new AppError(ErrorCode.VALIDATION_FAILED, "幂等请求键已属于另一项荣誉。");
    return { honorId: existing.id, created: false };
  }
  if ((args.entryId ? 1 : 0) + (args.userId ? 1 : 0) !== 1) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "荣誉必须明确授予一支队伍或一名选手。");
  }
  if (args.type === "placement" && (!Number.isInteger(args.placementFrom) || !Number.isInteger(args.placementTo) || args.placementFrom! < 1 || args.placementTo! < args.placementFrom!)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "名次范围不合法。");
  }
  if (args.type !== "placement" && (args.placementFrom !== undefined || args.placementTo !== undefined)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "只有名次荣誉可以携带名次范围。");
  }
  if (args.type === "manual_award" && args.basis === "final_result") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "手动奖项不能伪装为官方最终结果的自动派生物。");
  }
  if (args.type !== "manual_award" && args.basis === "manual") {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "冠军、亚军和名次荣誉必须以官方最终结果或明确赛后裁决为依据。");
  }
  if (args.entryId) await assertEntryBelongsToSeasonInTx(tx, args.seasonId, args.entryId);

  const honorKey = slotForHonor(args);
  const [alreadyValid] = await tx.select({ id: tournamentHonors.id }).from(tournamentHonors)
    .where(and(eq(tournamentHonors.seasonId, args.seasonId), eq(tournamentHonors.honorKey, honorKey), eq(tournamentHonors.state, "valid")))
    .for("update");
  if (alreadyValid) throw new AppError(ErrorCode.VALIDATION_FAILED, "该荣誉席位已有有效授予；请先显式撤销，系统不会自动替换获奖者。");

  let sourceFinalResultId: string | null = null;
  if (args.basis === "final_result") {
    const result = await lockFinalResultInTx(tx, args.seasonId);
    if (result.status !== "confirmed") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "必须先明确确认最终赛事结果，才能授予基于结果的荣誉。");
    assertFinalResultRecipient(result, args);
    sourceFinalResultId = result.id;
  }
  if (args.basis === "adjudication") {
    if (!args.adjudicationId) throw new AppError(ErrorCode.VALIDATION_FAILED, "裁决依据荣誉必须关联有效裁决。");
    const [adjudication] = await tx.select().from(postEventAdjudications)
      .where(eq(postEventAdjudications.id, args.adjudicationId)).for("update");
    if (!adjudication || adjudication.seasonId !== args.seasonId || adjudication.status !== "active" || !(adjudication.impacts as string[]).includes("honors")) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "关联裁决不是当前赛事的有效荣誉裁决。");
    }
  }

  const [created] = await tx.insert(tournamentHonors).values({
    seasonId: args.seasonId,
    clientRequestId: args.clientRequestId,
    honorKey,
    type: args.type,
    label: args.label,
    state: "valid",
    basis: args.basis,
    placementFrom: args.type === "placement" ? args.placementFrom! : null,
    placementTo: args.type === "placement" ? args.placementTo! : null,
    entryId: args.entryId ?? null,
    userId: args.userId ?? null,
    sourceFinalResultId,
    adjudicationId: args.adjudicationId ?? null,
    awardedBy: args.actorId,
  }).onConflictDoNothing().returning({ id: tournamentHonors.id });
  if (!created) {
    const [retry] = await tx.select({ id: tournamentHonors.id, seasonId: tournamentHonors.seasonId })
      .from(tournamentHonors).where(eq(tournamentHonors.clientRequestId, args.clientRequestId));
    if (retry?.seasonId === args.seasonId) return { honorId: retry.id, created: false };
    throw new AppError(ErrorCode.VALIDATION_FAILED, "该荣誉席位已有有效授予；系统不会自动替换获奖者。");
  }
  await tx.insert(auditLogs).values({
    seasonId: args.seasonId,
    action: "postevent.honor.grant",
    actorId: args.actorId,
    targetId: created.id,
    targetType: "tournament_honor",
    meta: { honorKey, type: args.type, basis: args.basis, entryId: args.entryId ?? null, userId: args.userId ?? null, placementFrom: args.placementFrom ?? null, placementTo: args.placementTo ?? null, adjudicationId: args.adjudicationId ?? null },
  });
  return { honorId: created.id, created: true };
}

export async function revokeTournamentHonorInTx(
  tx: TxDb,
  args: { honorId: string; actorId: string; reason: string },
): Promise<{ honorId: string; alreadyRevoked: boolean }> {
  const [honor] = await tx.select().from(tournamentHonors)
    .where(eq(tournamentHonors.id, args.honorId)).for("update");
  if (!honor) throw new AppError(ErrorCode.NOT_FOUND, "赛事荣誉不存在。");
  if (honor.state === "revoked") return { honorId: honor.id, alreadyRevoked: true };
  if (honor.state !== "valid") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有有效荣誉可以撤销。");
  await tx.update(tournamentHonors).set({
    state: "revoked",
    revokedAt: new Date(),
    revokedBy: args.actorId,
    revocationReason: args.reason,
    updatedAt: new Date(),
  }).where(eq(tournamentHonors.id, honor.id));
  await tx.insert(auditLogs).values({
    seasonId: honor.seasonId,
    action: "postevent.honor.revoke",
    actorId: args.actorId,
    targetId: honor.id,
    targetType: "tournament_honor",
    meta: { honorKey: honor.honorKey, type: honor.type, reason: args.reason, automaticPromotion: false },
  });
  return { honorId: honor.id, alreadyRevoked: false };
}

export async function archiveTournamentInTx(
  tx: TxDb,
  args: { seasonId: string; actorId: string },
): Promise<{ archived: boolean; alreadyArchived: boolean }> {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, args.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
  if (season.status === "archived") return { archived: true, alreadyArchived: true };
  const result = await lockFinalResultInTx(tx, args.seasonId);
  if (result.status !== "confirmed") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "必须先明确确认最终赛事结果，才能归档赛事。");
  await tx.update(seasons).set({ status: "archived", updatedAt: new Date() }).where(eq(seasons.id, season.id));
  await tx.insert(auditLogs).values({
    seasonId: season.id,
    action: "major.archive",
    actorId: args.actorId,
    targetId: season.id,
    targetType: "season",
    meta: { from: season.status, to: "archived", finalResultId: result.id },
  });
  return { archived: true, alreadyArchived: false };
}

/** Public-safe shapes: private evidence and internal actor provenance are omitted by construction. */
export function serializePostEventAdjudicationPublic(row: PostEventAdjudication) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    status: row.status,
    kind: row.kind,
    target: row.target,
    impacts: [...(row.impacts as AdjudicationImpact[])],
    targetEntryId: row.targetEntryId,
    targetUserId: row.targetUserId,
    targetMatchId: row.targetMatchId,
    reason: row.reason,
    explanation: row.publicExplanation,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export function serializeTournamentHonorPublic(row: TournamentHonor) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    honorKey: row.honorKey,
    type: row.type,
    label: row.label,
    state: row.state,
    basis: row.basis,
    placementFrom: row.placementFrom,
    placementTo: row.placementTo,
    entryId: row.entryId,
    userId: row.userId,
    awardedAt: row.awardedAt,
    revokedAt: row.revokedAt,
  };
}
