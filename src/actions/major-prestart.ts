"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  eventRosterMembers,
  eventRosters,
  majorTournamentEntrants,
  majorPrestartIssues,
  seasons,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { fail, ok, type ActionResult } from "@/types/action";
import { startMajorInTransaction, type MajorStartResult } from "@/lib/major/start";
import { finalizeMajorSwissRoundInTransaction, type MajorSwissRoundFinalizationResult } from "@/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction, type MajorStageTransitionResult } from "@/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction, type MajorPlayoffFinalizationResult, type MajorPlayoffStartResult } from "@/lib/major/playoff-runtime";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { traceOperation } from "@/lib/observability/server";
import { assertSinglePrestartEntryCoherenceInTx } from "@/lib/major/prestart-entry";
import { lockMajorPrestartEntrantsInTx, selectMajorEntrantsAndSyncRostersInTx } from "@/lib/major/prestart-entrants";
import { saveMajorPrestartRosterInTx } from "@/lib/major/prestart-roster";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { confirmMajorTournamentSeedsInTx, saveMajorTournamentSeedsInTx } from "@/lib/major/prestart-seeds";

const uuid = z.string().uuid();
const issueCategory = z.enum(["qualification", "administration"]);
const rosterRepairInput = z.object({ seasonId: uuid, entrantId: uuid, userIds: z.array(uuid).min(1).max(16), reason: z.string().trim().min(1).max(1000) });
const rosterExceptionInput = z.object({ seasonId: uuid, entrantId: uuid, reason: z.string().trim().min(1).max(1000) });
const entrantSelectionInput = z.object({ seasonId: uuid, competitionEntryIds: z.array(uuid) });
const tournamentSeedsInput = z.object({ seasonId: uuid, entryIds: z.array(uuid), overrideReason: z.string().trim().max(500).optional() });

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function standardMajorOrThrow(season: typeof seasons.$inferSelect): void {
  getStandardMajorDefinition(season, {
    notMajor: "当前赛事不是 Major 赛事模板，不能管理赛前事实。",
    notStandard: "当前赛事不是标准 Major，不能管理赛前事实。",
  });
}

async function seasonAndAdminOrThrow(seasonId: string) {
  const season = await db.query.seasons.findFirst({ where: eq(seasons.id, seasonId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
  if (season.status === "archived") {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已归档，普通 Major 运行态变更被拒绝。");
  }
  standardMajorOrThrow(season);
  return { season, admin: await requireSeasonAdmin(seasonId) };
}

function revalidateMajorPrestart(seasonSlug: string): void {
  revalidatePath(`/admin/${seasonSlug}`);
  revalidatePath(`/admin/${seasonSlug}/prestart`);
}

export async function selectMajorEntrants(input: { seasonId: string; competitionEntryIds: string[] }): Promise<ActionResult<void>> {
  const parsed = entrantSelectionInput.safeParse(input);
  if (!parsed.success || new Set(parsed.data.competitionEntryIds).size !== parsed.data.competitionEntryIds.length) {
    return invalid("正式参赛队选择无效，不能包含重复 Entry。 ");
  }
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await traceOperation("major.prestart.select_entrants", {
      scope: "major",
      operation: "prestart.select_entrants",
      attributes: { "rivalhub.workflow": "major_prestart" },
    }, () => db.transaction((tx) => selectMajorEntrantsAndSyncRostersInTx(tx, {
      seasonId: season.id,
      competitionEntryIds: parsed.data.competitionEntryIds,
      actorId: auditActorId(admin),
    })));
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("selectMajorEntrants", error); }
}

/** Explicit exception path only; normal flow uses selectMajorEntrants. */
export async function repairMajorPrestartRoster(input: z.infer<typeof rosterRepairInput>): Promise<ActionResult<void>> {
  const parsed = rosterRepairInput.safeParse(input);
  if (!parsed.success) return invalid("最终名单输入无效。");
  const userIds = [...new Set(parsed.data.userIds)];
  if (userIds.length !== parsed.data.userIds.length) return invalid("最终名单中不能重复同一位选手。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    if (userIds.length < season.minTeamSize || userIds.length > season.maxTeamSize) {
      return invalid(`最终名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
    }
    await db.transaction((tx) => saveMajorPrestartRosterInTx(tx, {
      seasonId: season.id,
      entrantId: parsed.data.entrantId,
      userIds,
      reason: parsed.data.reason,
      actorId: auditActorId(admin),
    }));
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("repairMajorPrestartRoster", error); }
}

export async function confirmMajorPrestartRoster(input: z.input<typeof rosterExceptionInput>): Promise<ActionResult<void>> {
  const parsed = rosterExceptionInput.safeParse(input);
  if (!parsed.success) return invalid("赛季或正式参赛队标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      assertMajorPrestartEntrantsMutable(await ensureMajorPrestartStateInTx(tx, season.id));
      const [entrant] = await tx.select().from(majorTournamentEntrants)
        .where(and(eq(majorTournamentEntrants.id, parsed.data.entrantId), eq(majorTournamentEntrants.seasonId, season.id)));
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      const coherent = await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entrant.competitionEntryId });
      const roster = await tx.select({ userId: eventRosterMembers.userId, educationVerificationId: eventRosterMembers.educationVerificationId }).from(eventRosterMembers)
        .where(eq(eventRosterMembers.eventRosterId, coherent.eventRoster.id));
      if (roster.length < season.minTeamSize || roster.length > season.maxTeamSize) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单人数不符合赛事规则，不能确认。");
      }
      if (roster.some((member) => !member.educationVerificationId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单缺少已冻结的教育认证依据，不能确认。 ");
      const duplicate = await tx.execute(sql`
        SELECT r.user_id FROM event_roster_members r
        INNER JOIN major_tournament_entrants e ON e.competition_entry_id = (SELECT entry_id FROM event_rosters WHERE id = r.event_roster_id)
        WHERE e.season_id = ${season.id}
        GROUP BY r.user_id HAVING count(*) > 1 LIMIT 1
      `);
      if (duplicate.rows.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "同一选手不能同时出现在多支正式参赛队的最终名单中。");
      const now = new Date();
      await tx.update(eventRosters).set({ status: "confirmed", confirmedAt: now, confirmedBy: auditActorId(admin), updatedAt: now }).where(eq(eventRosters.id, coherent.eventRoster.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.confirm_roster", actorId: auditActorId(admin),
        targetId: entrant.id, targetType: "major_tournament_entrant", meta: { rosterSize: roster.length, reason: parsed.data.reason },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("confirmMajorPrestartRoster", error); }
}

/** 已确认的单队名单在全局锁定前可由管理员显式重新开放；该动作不会解冻赛事。 */
export async function reopenMajorPrestartRoster(input: z.input<typeof rosterExceptionInput>): Promise<ActionResult<void>> {
  const parsed = rosterExceptionInput.safeParse(input);
  if (!parsed.success) return invalid("赛季或正式参赛队标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      assertMajorPrestartEntrantsMutable(await ensureMajorPrestartStateInTx(tx, season.id));
      const [entrant] = await tx.select().from(majorTournamentEntrants)
        .where(and(eq(majorTournamentEntrants.id, parsed.data.entrantId), eq(majorTournamentEntrants.seasonId, season.id))).for("update");
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      const [roster] = await tx.select().from(eventRosters).where(eq(eventRosters.entryId, entrant.competitionEntryId)).for("update");
      if (!roster) throw new AppError(ErrorCode.NOT_FOUND, "赛事名单不存在。");
      if (roster.status === "frozen") throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "最终赛事名单已冻结，不能重新开放。");
      if (roster.status === "confirmed") {
        await tx.update(eventRosters).set({ status: "preparing", confirmedAt: null, confirmedBy: null, frozenAt: null, frozenBy: null, updatedAt: new Date() }).where(eq(eventRosters.id, roster.id));
        await tx.insert(auditLogs).values({ seasonId: season.id, action: "major_prestart.reopen_roster", actorId: auditActorId(admin), targetId: entrant.id, targetType: "major_tournament_entrant", meta: { eventRosterId: roster.id, reason: parsed.data.reason } });
      }
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("reopenMajorPrestartRoster", error); }
}

export async function addMajorPrestartIssue(input: { seasonId: string; category: "qualification" | "administration"; label: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, category: issueCategory, label: z.string().trim().min(1).max(240) }).safeParse(input);
  if (!parsed.success) return invalid("待处理事项输入无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const state = await ensureMajorPrestartStateInTx(tx, season.id);
      assertMajorPrestartEntrantsMutable(state);
      const [issue] = await tx.insert(majorPrestartIssues).values({ ...parsed.data }).returning({ id: majorPrestartIssues.id });
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.add_issue", actorId: auditActorId(admin),
        targetId: issue?.id, targetType: "major_prestart_issue", meta: { category: parsed.data.category },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("addMajorPrestartIssue", error); }
}

export async function resolveMajorPrestartIssue(input: { seasonId: string; issueId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, issueId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季或事项标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const [issue] = await tx.select().from(majorPrestartIssues)
        .where(and(eq(majorPrestartIssues.id, parsed.data.issueId), eq(majorPrestartIssues.seasonId, season.id)));
      if (!issue) throw new AppError(ErrorCode.NOT_FOUND, "待处理事项不存在。");
      await tx.update(majorPrestartIssues).set({ resolvedAt: new Date(), resolvedBy: auditActorId(admin), updatedAt: new Date() })
        .where(eq(majorPrestartIssues.id, issue.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.resolve_issue", actorId: auditActorId(admin),
        targetId: issue.id, targetType: "major_prestart_issue", meta: { category: issue.category },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("resolveMajorPrestartIssue", error); }
}

export async function lockMajorPrestartEntrants(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await traceOperation("major.prestart.lock_entrants", {
      scope: "major",
      operation: "prestart.lock_entrants",
      attributes: { "rivalhub.workflow": "major_prestart" },
    }, () => db.transaction((tx) => lockMajorPrestartEntrantsInTx(tx, {
      seasonId: season.id,
      actorId: auditActorId(admin),
    })));
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("lockMajorPrestartEntrants", error); }
}

export async function saveMajorTournamentSeeds(input: { seasonId: string; entryIds: string[]; overrideReason?: string }): Promise<ActionResult<void>> {
  const parsed = tournamentSeedsInput.safeParse(input);
  if (!parsed.success) return invalid("赛事种子或人工调整说明无效。 ");
  if (new Set(parsed.data.entryIds).size !== parsed.data.entryIds.length) return invalid("赛事种子不能包含重复 Entry。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const overrideReason = parsed.data.overrideReason?.trim() || null;
      await saveMajorTournamentSeedsInTx(tx, {
        seasonId: season.id,
        entryIds: parsed.data.entryIds,
        overrideReason,
        actorId: auditActorId(admin),
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("saveMajorTournamentSeeds", error); }
}

export async function confirmMajorTournamentSeeds(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      await confirmMajorTournamentSeedsInTx(tx, {
        seasonId: season.id,
        actorId: auditActorId(admin),
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("confirmMajorTournamentSeeds", error); }
}

/** 管理员显式确认后原子启动 Stage 1；重试返回同一已创建运行记录。 */
export async function startMajor(input: { seasonId: string }): Promise<ActionResult<MajorStartResult>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await traceOperation("major.start", {
      scope: "major",
      operation: "start",
      attributes: { "rivalhub.workflow": "major_runtime" },
    }, () => db.transaction((tx) => startMajorInTransaction(tx, {
      seasonId: season.id,
      actorId: auditActorId(admin),
    })));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("startMajor", error); }
}

/** 明确确认指定 StageRun 的一轮 Swiss 比赛，并在同一事务中生成下一轮。 */
export async function finalizeMajorSwissRound(input: { seasonId: string; stageRunId: string; expectedRound: 1 | 2 | 3 | 4 | 5 }): Promise<ActionResult<MajorSwissRoundFinalizationResult>> {
  const parsed = z.object({ seasonId: uuid, stageRunId: uuid, expectedRound: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]) }).safeParse(input);
  if (!parsed.success) return invalid("赛季或待确认轮次无效。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await traceOperation("major.swiss_round.finalize", {
      scope: "major",
      operation: "swiss_round.finalize",
      attributes: { "rivalhub.workflow": "major_runtime" },
    }, () => db.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
      seasonId: season.id,
      stageRunId: parsed.data.stageRunId,
      expectedRound: parsed.data.expectedRound,
      actorId: auditActorId(admin),
    })));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("finalizeMajorSwissRound", error); }
}

export async function transitionMajorSwissStage(input: { seasonId: string; sourceStageRunId: string }): Promise<ActionResult<MajorStageTransitionResult>> {
  const parsed = z.object({ seasonId: uuid, sourceStageRunId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("阶段切换请求无效。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await traceOperation("major.swiss_stage.transition", {
      scope: "major",
      operation: "swiss_stage.transition",
      attributes: { "rivalhub.workflow": "major_runtime" },
    }, () => db.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
      seasonId: season.id,
      sourceStageRunId: parsed.data.sourceStageRunId,
      actorId: auditActorId(admin),
    })));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("transitionMajorSwissStage", error); }
}

export async function startMajorPlayoff(input: { seasonId: string; sourceStageRunId: string; hasThirdPlaceMatch: boolean }): Promise<ActionResult<MajorPlayoffStartResult>> {
  const parsed = z.object({ seasonId: uuid, sourceStageRunId: uuid, hasThirdPlaceMatch: z.boolean() }).safeParse(input);
  if (!parsed.success) return invalid("淘汰赛启动请求无效。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await traceOperation("major.playoff.start", {
      scope: "major",
      operation: "playoff.start",
      attributes: { "rivalhub.workflow": "major_runtime" },
    }, () => db.transaction((tx) => startMajorPlayoffInTransaction(tx, {
      seasonId: season.id, sourceStageRunId: parsed.data.sourceStageRunId, actorId: auditActorId(admin), hasThirdPlaceMatch: parsed.data.hasThirdPlaceMatch,
    })));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("startMajorPlayoff", error); }
}

export async function finalizeMajorPlayoffRound(input: { seasonId: string; stageRunId: string; expectedRound: "quarterfinal" | "semifinal" | "final" }): Promise<ActionResult<MajorPlayoffFinalizationResult>> {
  const parsed = z.object({ seasonId: uuid, stageRunId: uuid, expectedRound: z.enum(["quarterfinal", "semifinal", "final"]) }).safeParse(input);
  if (!parsed.success) return invalid("淘汰赛确认请求无效。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => finalizeMajorPlayoffRoundInTransaction(tx, {
      seasonId: season.id, stageRunId: parsed.data.stageRunId, expectedRound: parsed.data.expectedRound, actorId: auditActorId(admin),
    }));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("finalizeMajorPlayoffRound", error); }
}
