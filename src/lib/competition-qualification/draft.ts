import "server-only";

import { and, asc, eq } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { competitionEntries, competitionQualificationDrafts, competitionQualificationRuns, seasons } from "@/db/schema";
import { writeAuditInTx } from "@/lib/audit/write";
import { AppError, ErrorCode } from "@/lib/errors";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { deriveCompetitionQualificationPlan, isShortSwissQualificationAllowed, type CompetitionQualificationFormat } from "./policy";

export function sameCandidateSet(order: readonly string[], ids: readonly string[]): boolean {
  return order.length === ids.length && new Set(order).size === order.length && ids.every(id => order.includes(id));
}

export async function saveCompetitionQualificationDraftInTx(tx: TxDb, input: {
  seasonId: string; actorId: string; format: CompetitionQualificationFormat; order: string[]; expectedVersion: number | null;
}) {
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, input.seasonId)).for("update");
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");
  const { entrantCapacity } = getStandardMajorDefinition(season);
  if (season.status !== "registration") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "只有报名阶段可以编辑预排名草稿。");
  const [run] = await tx.select({ id: competitionQualificationRuns.id }).from(competitionQualificationRuns).where(eq(competitionQualificationRuns.seasonId, season.id));
  if (run) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Play-in 配置已锁定；请先显式重置后再编辑草稿。");
  const entries = await tx.select({ id: competitionEntries.id, revision: competitionEntries.approvedRosterRevisionId }).from(competitionEntries)
    .where(and(eq(competitionEntries.competitionId, season.id), eq(competitionEntries.registrationStatus, "approved"))).orderBy(asc(competitionEntries.id)).for("update");
  if (entries.some(entry => !entry.revision) || !sameCandidateSet(input.order, entries.map(entry => entry.id))) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, "候选集合已变化，请刷新后重新编辑草稿。");
  }
  const plan = deriveCompetitionQualificationPlan(entries.length, entrantCapacity);
  if (input.format === "short_swiss_2w2l" && !isShortSwissQualificationAllowed(plan.playInEntryCount)) throw new AppError(ErrorCode.VALIDATION_FAILED, "当前候选数不支持 Short Swiss。");
  const [old] = await tx.select().from(competitionQualificationDrafts).where(eq(competitionQualificationDrafts.seasonId, season.id));
  if ((old?.version ?? null) !== input.expectedVersion) throw new AppError(ErrorCode.VALIDATION_FAILED, "草稿已被其他管理员更新，请刷新后重试。");
  const values = {
    seasonId: season.id, order: [...input.order], format: input.format, targetEntrantCount: entrantCapacity,
    version: (old?.version ?? 0) + 1, updatedBy: input.actorId, updatedAt: new Date(),
  };
  const [draft] = await tx.insert(competitionQualificationDrafts).values(values)
    .onConflictDoUpdate({ target: competitionQualificationDrafts.seasonId, set: values }).returning();
  await writeAuditInTx(tx, { seasonId: season.id, action: "competition_qualification.save_draft", actorId: input.actorId, targetId: season.id,
    meta: { oldOrder: old?.order ?? [], newOrder: values.order, oldFormat: old?.format ?? null, format: values.format, version: values.version, targetEntrantCount: entrantCapacity },
  });
  return { seasonSlug: season.slug, draft: { ...draft!, updatedAt: draft!.updatedAt.toISOString(), stale: false } };
}
