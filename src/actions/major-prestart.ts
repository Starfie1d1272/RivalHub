"use server";

import { writeAuditInTx } from "@/lib/audit/write";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  competitionQualificationRuns,
  eventRosterMembers,
  eventRosters,
  majorPrestartStates,
  majorStageRuns,
  majorTournamentEntrants,
  majorTournamentSeeds,
  seasons,
} from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { getStandardMajorDefinition } from "@/lib/major/standard";
import { createMajor24StagePlan, createMajorDefaultCapabilities } from "@/lib/competition/templates";
import { ok, type ActionResult } from "@/types/action";
import { updatePublicHomeTag } from "@/lib/revalidation";
import { startMajorInTransaction, type MajorStartResult } from "@/lib/major/start";
import { finalizeMajorSwissRoundInTransaction, type MajorSwissRoundFinalizationResult } from "@/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction, type MajorStageTransitionResult } from "@/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction, type MajorPlayoffFinalizationResult, type MajorPlayoffStartResult } from "@/lib/major/playoff-runtime";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { traceOperation } from "@/lib/observability/server";
import { assertSinglePrestartEntryCoherenceInTx } from "@/lib/event-rosters/coherence";
import { lockMajorPrestartEntrantsInTx, selectMajorEntrantsAndSyncRostersInTx } from "@/lib/major/prestart-entrants";
import { saveMajorPrestartRosterInTx } from "@/lib/major/prestart-roster";
import { assertMajorPrestartEntrantsMutable, ensureMajorPrestartStateInTx } from "@/lib/major/prestart-state";
import { confirmMajorTournamentSeedsInTx, saveMajorTournamentSeedsInTx } from "@/lib/major/prestart-seeds";

const uuid = z.guid();
const rosterRepairInput = z.object({ seasonId: uuid, entrantId: uuid, userIds: z.array(uuid).min(1).max(16), reason: z.string().trim().min(1).max(1000) });
const rosterExceptionInput = z.object({ seasonId: uuid, entrantId: uuid, reason: z.string().trim().min(1).max(1000) });
const entrantSelectionInput = z.object({ seasonId: uuid, competitionEntryIds: z.array(uuid) });
const tournamentSeedsInput = z.object({ seasonId: uuid, entryIds: z.array(uuid) });


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
  updatePublicHomeTag();
  revalidatePath(`/admin/${seasonSlug}`);
  revalidatePath(`/admin/${seasonSlug}/prestart`);
}

export async function selectMajorEntrants(input: { seasonId: string; competitionEntryIds: string[] }): Promise<ActionResult<void>> {
  const parsed = entrantSelectionInput.safeParse(input);
  if (!parsed.success || new Set(parsed.data.competitionEntryIds).size !== parsed.data.competitionEntryIds.length) {
    return failValidation("正式参赛队选择无效，不能重复选择同一支报名队伍。 ");
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

export async function setMajorManagedProfile(input: { seasonId: string; profileId: "major-24" | "major-32" }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, profileId: z.enum(["major-24", "major-32"]) }).safeParse(input);
  if (!parsed.success) return failValidation("Major 正赛规模无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const [lockedSeason] = await tx.select().from(seasons).where(eq(seasons.id, season.id)).for("update");
      if (!lockedSeason) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      if (lockedSeason.status !== "registration") {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "Major 正赛规模只能在报名阶段、产生依赖事实前调整。");
      }
      const current = getStandardMajorDefinition(lockedSeason).managedProfile;
      if (current?.id === parsed.data.profileId) return;
      const [state] = await tx.select().from(majorPrestartStates).where(eq(majorPrestartStates.seasonId, season.id));
      if (state && (state.entrantsLockedAt || state.seedsConfirmedAt || state.seedsLockedAt)) {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正赛赛前事实已经锁定，不能调整正赛规模。");
      }
      const [qualificationRun] = await tx.select({ id: competitionQualificationRuns.id }).from(competitionQualificationRuns)
        .where(eq(competitionQualificationRuns.seasonId, season.id)).limit(1);
      const [entrant] = await tx.select({ id: majorTournamentEntrants.id }).from(majorTournamentEntrants)
        .where(eq(majorTournamentEntrants.seasonId, season.id)).limit(1);
      const [seed] = await tx.select({ id: majorTournamentSeeds.id }).from(majorTournamentSeeds)
        .where(eq(majorTournamentSeeds.seasonId, season.id)).limit(1);
      const [stageRun] = await tx.select({ id: majorStageRuns.id }).from(majorStageRuns)
        .where(eq(majorStageRuns.seasonId, season.id)).limit(1);
      if (qualificationRun || entrant || seed || stageRun) {
        throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已经产生 Play-in 或正赛依赖事实，不能调整正赛规模。");
      }
      const stagePlan = parsed.data.profileId === "major-24"
        ? createMajor24StagePlan()
        : createMajorDefaultCapabilities().stagePlan;
      await tx.update(seasons).set({ stagePlan }).where(eq(seasons.id, season.id));
      await writeAuditInTx(tx, {
        seasonId: season.id,
        action: "major_prestart.set_managed_profile",
        actorId: auditActorId(admin),
        targetId: season.id,
        meta: { from: current?.id ?? null, to: parsed.data.profileId },
      });
    });
    revalidateMajorPrestart(season.slug);
    revalidatePath(`/admin/${season.slug}/settings`);
    return ok(undefined);
  } catch (error) { return actionError("setMajorManagedProfile", error); }
}

/** Explicit exception path only; normal flow uses selectMajorEntrants. */
export async function repairMajorPrestartRoster(input: z.infer<typeof rosterRepairInput>): Promise<ActionResult<void>> {
  const parsed = rosterRepairInput.safeParse(input);
  if (!parsed.success) return failValidation("最终名单输入无效。");
  const userIds = [...new Set(parsed.data.userIds)];
  if (userIds.length !== parsed.data.userIds.length) return failValidation("最终名单中不能重复同一位选手。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    if (userIds.length < season.minTeamSize || userIds.length > season.maxTeamSize) {
      return failValidation(`最终名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
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
  if (!parsed.success) return failValidation("赛季或正式参赛队标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      assertMajorPrestartEntrantsMutable(await ensureMajorPrestartStateInTx(tx, season.id));
      const [entrant] = await tx.select().from(majorTournamentEntrants)
        .where(and(eq(majorTournamentEntrants.id, parsed.data.entrantId), eq(majorTournamentEntrants.seasonId, season.id)));
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      const coherent = await assertSinglePrestartEntryCoherenceInTx(tx, season.id, { competitionEntryId: entrant.competitionEntryId });
      const roster = await tx.select({ userId: eventRosterMembers.userId, educationVerificationId: eventRosterMembers.educationVerificationId }).from(eventRosterMembers)
        .where(and(eq(eventRosterMembers.eventRosterId, coherent.eventRoster.id), eq(eventRosterMembers.isCurrent, true)));
      if (roster.length < season.minTeamSize || roster.length > season.maxTeamSize) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单人数不符合赛事规则，不能确认。");
      }
      if (roster.some((member) => !member.educationVerificationId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单缺少已冻结的教育认证依据，不能确认。 ");
      const duplicate = await tx.execute(sql`
        SELECT r.user_id FROM event_roster_members r
        INNER JOIN major_tournament_entrants e ON e.competition_entry_id = (SELECT entry_id FROM event_rosters WHERE id = r.event_roster_id)
        WHERE e.season_id = ${season.id} AND r.is_current = true
        GROUP BY r.user_id HAVING count(*) > 1 LIMIT 1
      `);
      if (duplicate.rows.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "同一选手不能同时出现在多支正式参赛队的最终名单中。");
      const now = new Date();
      await tx.update(eventRosters).set({ status: "confirmed", confirmedAt: now, confirmedBy: auditActorId(admin), updatedAt: now }).where(eq(eventRosters.id, coherent.eventRoster.id));
      await writeAuditInTx(tx, {
        seasonId: season.id, action: "major_prestart.confirm_roster", actorId: auditActorId(admin),
        targetId: entrant.id,meta: { rosterSize: roster.length, reason: parsed.data.reason },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("confirmMajorPrestartRoster", error); }
}

/** 已确认的单队名单在全局锁定前可由管理员显式重新开放；该动作不会解冻赛事。 */
export async function reopenMajorPrestartRoster(input: z.input<typeof rosterExceptionInput>): Promise<ActionResult<void>> {
  const parsed = rosterExceptionInput.safeParse(input);
  if (!parsed.success) return failValidation("赛季或正式参赛队标识无效。");
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
        await writeAuditInTx(tx, { seasonId: season.id, action: "major_prestart.reopen_roster", actorId: auditActorId(admin), targetId: entrant.id,meta: { eventRosterId: roster.id, reason: parsed.data.reason } });
      }
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("reopenMajorPrestartRoster", error); }
}

export async function lockMajorPrestartEntrants(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("赛季标识无效。");
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

export async function saveMajorTournamentSeeds(input: { seasonId: string; entryIds: string[] }): Promise<ActionResult<void>> {
  const parsed = tournamentSeedsInput.safeParse(input);
  if (!parsed.success) return failValidation("赛事种子无效。 ");
  if (new Set(parsed.data.entryIds).size !== parsed.data.entryIds.length) return failValidation("赛事种子不能包含重复队伍。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      await saveMajorTournamentSeedsInTx(tx, {
        seasonId: season.id,
        entryIds: parsed.data.entryIds,
        actorId: auditActorId(admin),
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("saveMajorTournamentSeeds", error); }
}

export async function confirmMajorTournamentSeeds(input: { seasonId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid }).safeParse(input);
  if (!parsed.success) return failValidation("赛季标识无效。");
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
  if (!parsed.success) return failValidation("赛季标识无效。");
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
  if (!parsed.success) return failValidation("赛季或待确认轮次无效。 ");
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
  if (!parsed.success) return failValidation("阶段切换请求无效。 ");
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
  if (!parsed.success) return failValidation("淘汰赛启动请求无效。 ");
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
  if (!parsed.success) return failValidation("淘汰赛确认请求无效。 ");
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
