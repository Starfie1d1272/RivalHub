"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditLogs,
  majorPrestartEntrants,
  majorPrestartIssues,
  majorPrestartRosterMembers,
  majorPrestartStates,
  majorTournamentSeeds,
  seasons,
  teamMembers,
  teams,
  users,
  educationVerifications,
  institutions,
} from "@/db/schema";
import { actionError } from "@/lib/action-utils";
import { auditActorId, requireSeasonAdmin } from "@/lib/auth/session";
import { AppError, ErrorCode } from "@/lib/errors";
import { checkStandardMajorCapabilities, normalizeAffiliationRules, normalizeRegistrationConfig, normalizeStagePlan, normalizeTeamRegistrationConfig } from "@/types/season";
import { fail, ok, type ActionResult } from "@/types/action";
import { startMajorInTransaction, type MajorStartResult } from "@/lib/major/start";
import { finalizeMajorSwissRoundInTransaction, type MajorSwissRoundFinalizationResult } from "@/lib/major/swiss-runtime";
import { transitionMajorSwissStageInTransaction, type MajorStageTransitionResult } from "@/lib/major/stage-transition";
import { finalizeMajorPlayoffRoundInTransaction, startMajorPlayoffInTransaction, type MajorPlayoffFinalizationResult, type MajorPlayoffStartResult } from "@/lib/major/playoff-runtime";
import { revalidateSeasonPaths } from "@/lib/revalidation";
import { evaluateRosterEducationEligibility, type EducationEligibilityMember } from "@/lib/education/eligibility";

const uuid = z.string().uuid();
const issueCategory = z.enum(["qualification", "administration"]);
const rosterInput = z.object({ seasonId: uuid, entrantId: uuid, userIds: z.array(uuid).min(1).max(16) });

function invalid(message: string): ActionResult<never> {
  return fail({ code: ErrorCode.VALIDATION_FAILED, message });
}

function standardMajorOrThrow(season: typeof seasons.$inferSelect): void {
  const result = checkStandardMajorCapabilities({
    registrationMode: season.registrationMode,
    hasCaptainVoting: season.hasCaptainVoting,
    hasDraft: season.hasDraft,
    stagePlan: normalizeStagePlan(season.stagePlan),
    registrationConfig: normalizeRegistrationConfig(season.registrationConfig),
    teamRegistrationConfig: normalizeTeamRegistrationConfig(season.teamRegistrationConfig),
    affiliationRules: normalizeAffiliationRules(season.affiliationRules),
    minTeamSize: season.minTeamSize,
    maxTeamSize: season.maxTeamSize,
    starterCount: season.starterCount,
    positions: season.positions,
  });
  if (!result.isStandardMajor) {
    throw new AppError(ErrorCode.SEASON_CAPABILITY_DISABLED, "当前赛事不是标准 Major，不能管理赛前事实。");
  }
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

async function ensureState(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], seasonId: string) {
  await tx.insert(majorPrestartStates).values({ seasonId }).onConflictDoNothing();
  const [state] = await tx.select().from(majorPrestartStates)
    .where(eq(majorPrestartStates.seasonId, seasonId)).for("update");
  if (!state) throw new AppError(ErrorCode.INTERNAL_ERROR, "赛前状态初始化失败");
  return state;
}

function assertEntrantsMutable(state: { entrantsLockedAt: Date | null }): void {
  if (state.entrantsLockedAt) {
    throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "正式参赛队和最终名单已经锁定，不能再修改。");
  }
}

function revalidateMajorPrestart(seasonSlug: string): void {
  revalidatePath(`/admin/${seasonSlug}`);
}

async function approvedRosterEducation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userIds: readonly string[],
  affiliationRules: ReturnType<typeof normalizeAffiliationRules>,
): Promise<Map<string, string>> {
  const rows = await tx.select({ userId: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt, verificationId: educationVerifications.id, academicStatus: educationVerifications.academicStatus, institutionCode: institutions.moeInstitutionCode, institutionName: institutions.name })
    .from(users).leftJoin(educationVerifications, and(eq(educationVerifications.userId, users.id), eq(educationVerifications.status, "approved"))).leftJoin(institutions, eq(educationVerifications.institutionId, institutions.id)).where(inArray(users.id, [...userIds]));
  const selected = new Map<string, EducationEligibilityMember>();
  for (const row of rows) {
    const candidate: EducationEligibilityMember = { userId: row.userId, email: row.email, emailVerifiedAt: row.emailVerifiedAt, verification: row.verificationId && row.academicStatus && row.institutionName ? { id: row.verificationId, status: "approved", academicStatus: row.academicStatus, institutionCode: row.institutionCode, institutionName: row.institutionName } : null };
    const prior = selected.get(row.userId);
    const preferred = candidate.verification && affiliationRules.some((rule) => rule.institutionCode === candidate.verification?.institutionCode && rule.eligibleAcademicStatuses.includes(candidate.verification.academicStatus));
    if (!prior || (!prior.verification && candidate.verification) || (preferred && prior.verification?.institutionCode !== candidate.verification?.institutionCode)) selected.set(row.userId, candidate);
  }
  const decision = evaluateRosterEducationEligibility([...selected.values()], affiliationRules);
  if (!decision.eligible || decision.selectedVerificationIds.size !== userIds.length) throw new AppError(ErrorCode.VALIDATION_FAILED, decision.blockers.join(" "));
  return decision.selectedVerificationIds;
}

export async function addMajorPrestartEntrant(input: { seasonId: string; teamId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, teamId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季或队伍标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const state = await ensureState(tx, season.id);
      assertEntrantsMutable(state);
      const [team] = await tx.select({ id: teams.id }).from(teams)
        .where(and(eq(teams.id, parsed.data.teamId), eq(teams.seasonId, season.id)));
      if (!team) throw new AppError(ErrorCode.NOT_FOUND, "该队伍不属于当前赛事。");
      const existing = await tx.query.majorPrestartEntrants.findFirst({
        where: and(eq(majorPrestartEntrants.seasonId, season.id), eq(majorPrestartEntrants.teamId, team.id)),
      });
      if (existing) return;
      const members = await tx.select({ userId: teamMembers.userId }).from(teamMembers)
        .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.seasonId, season.id)));
      if (members.length < season.minTeamSize) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `正式队伍至少需要 ${season.minTeamSize} 名成员才能进入 Major。`);
      }
      const verificationIds = await approvedRosterEducation(tx, members.map((member) => member.userId), normalizeAffiliationRules(season.affiliationRules));
      const [entrant] = await tx.insert(majorPrestartEntrants).values({ seasonId: season.id, teamId: team.id })
        .returning({ id: majorPrestartEntrants.id });
      if (!entrant) throw new AppError(ErrorCode.INTERNAL_ERROR, "正式参赛队创建失败。");
      await tx.insert(majorPrestartRosterMembers).values(members.map((member) => ({ entrantId: entrant.id, userId: member.userId, educationVerificationId: verificationIds.get(member.userId) })));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.add_entrant", actorId: auditActorId(admin),
        targetId: entrant.id, targetType: "major_prestart_entrant", meta: { teamId: team.id, rosterSize: members.length },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("addMajorPrestartEntrant", error); }
}

export async function removeMajorPrestartEntrant(input: { seasonId: string; entrantId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, entrantId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季或正式参赛队标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      assertEntrantsMutable(await ensureState(tx, season.id));
      const [entrant] = await tx.select().from(majorPrestartEntrants)
        .where(and(eq(majorPrestartEntrants.id, parsed.data.entrantId), eq(majorPrestartEntrants.seasonId, season.id)));
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      await tx.delete(majorPrestartEntrants).where(eq(majorPrestartEntrants.id, entrant.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.remove_entrant", actorId: auditActorId(admin),
        targetId: entrant.id, targetType: "major_prestart_entrant", meta: { teamId: entrant.teamId },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("removeMajorPrestartEntrant", error); }
}

export async function saveMajorPrestartRoster(input: z.infer<typeof rosterInput>): Promise<ActionResult<void>> {
  const parsed = rosterInput.safeParse(input);
  if (!parsed.success) return invalid("最终名单输入无效。");
  const userIds = [...new Set(parsed.data.userIds)];
  if (userIds.length !== parsed.data.userIds.length) return invalid("最终名单中不能重复同一位选手。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    if (userIds.length < season.minTeamSize || userIds.length > season.maxTeamSize) {
      return invalid(`最终名单必须为 ${season.minTeamSize}-${season.maxTeamSize} 人。`);
    }
    await db.transaction(async (tx) => {
      assertEntrantsMutable(await ensureState(tx, season.id));
      const [entrant] = await tx.select().from(majorPrestartEntrants)
        .where(and(eq(majorPrestartEntrants.id, parsed.data.entrantId), eq(majorPrestartEntrants.seasonId, season.id)));
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      const formalMembers = await tx.select({ userId: teamMembers.userId }).from(teamMembers)
        .where(and(eq(teamMembers.teamId, entrant.teamId), eq(teamMembers.seasonId, season.id), inArray(teamMembers.userId, userIds)));
      if (formalMembers.length !== userIds.length) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单只能选择该正式队伍当前的成员。 ");
      }
      const verificationIds = await approvedRosterEducation(tx, userIds, normalizeAffiliationRules(season.affiliationRules));
      await tx.delete(majorPrestartRosterMembers).where(eq(majorPrestartRosterMembers.entrantId, entrant.id));
      await tx.insert(majorPrestartRosterMembers).values(userIds.map((userId) => ({ entrantId: entrant.id, userId, educationVerificationId: verificationIds.get(userId) })));
      await tx.update(majorPrestartEntrants).set({ rosterConfirmedAt: null, rosterConfirmedBy: null, updatedAt: new Date() })
        .where(eq(majorPrestartEntrants.id, entrant.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.save_roster", actorId: auditActorId(admin),
        targetId: entrant.id, targetType: "major_prestart_entrant", meta: { rosterSize: userIds.length },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("saveMajorPrestartRoster", error); }
}

export async function confirmMajorPrestartRoster(input: { seasonId: string; entrantId: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, entrantId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("赛季或正式参赛队标识无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      assertEntrantsMutable(await ensureState(tx, season.id));
      const [entrant] = await tx.select().from(majorPrestartEntrants)
        .where(and(eq(majorPrestartEntrants.id, parsed.data.entrantId), eq(majorPrestartEntrants.seasonId, season.id)));
      if (!entrant) throw new AppError(ErrorCode.NOT_FOUND, "正式参赛队不存在。");
      const roster = await tx.select({ userId: majorPrestartRosterMembers.userId, educationVerificationId: majorPrestartRosterMembers.educationVerificationId }).from(majorPrestartRosterMembers)
        .where(eq(majorPrestartRosterMembers.entrantId, entrant.id));
      if (roster.length < season.minTeamSize || roster.length > season.maxTeamSize) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单人数不符合赛事规则，不能确认。");
      }
      if (roster.some((member) => !member.educationVerificationId)) throw new AppError(ErrorCode.VALIDATION_FAILED, "最终名单缺少已冻结的教育认证依据，不能确认。 ");
      const duplicate = await tx.execute(sql`
        SELECT r.user_id FROM major_prestart_roster_members r
        INNER JOIN major_prestart_entrants e ON e.id = r.entrant_id
        WHERE e.season_id = ${season.id}
        GROUP BY r.user_id HAVING count(*) > 1 LIMIT 1
      `);
      if (duplicate.rows.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "同一选手不能同时出现在多支正式参赛队的最终名单中。");
      await tx.update(majorPrestartEntrants).set({ rosterConfirmedAt: new Date(), rosterConfirmedBy: auditActorId(admin), updatedAt: new Date() })
        .where(eq(majorPrestartEntrants.id, entrant.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.confirm_roster", actorId: auditActorId(admin),
        targetId: entrant.id, targetType: "major_prestart_entrant", meta: { rosterSize: roster.length },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("confirmMajorPrestartRoster", error); }
}

export async function addMajorPrestartIssue(input: { seasonId: string; category: "qualification" | "administration"; label: string }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, category: issueCategory, label: z.string().trim().min(1).max(240) }).safeParse(input);
  if (!parsed.success) return invalid("待处理事项输入无效。");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const state = await ensureState(tx, season.id);
      assertEntrantsMutable(state);
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
    await db.transaction(async (tx) => {
      const state = await ensureState(tx, season.id);
      if (state.entrantsLockedAt) return;
      const entrants = await tx.select({ id: majorPrestartEntrants.id, confirmedAt: majorPrestartEntrants.rosterConfirmedAt })
        .from(majorPrestartEntrants).where(eq(majorPrestartEntrants.seasonId, season.id));
      if (entrants.length !== 32) throw new AppError(ErrorCode.VALIDATION_FAILED, "锁定前必须恰好选择 32 支正式参赛队。 ");
      if (entrants.some((entrant) => !entrant.confirmedAt)) throw new AppError(ErrorCode.VALIDATION_FAILED, "所有正式参赛队必须先确认最终赛事名单。 ");
      const rosterCounts = await tx.execute(sql`
        SELECT entrant_id, count(*)::int AS count FROM major_prestart_roster_members
        WHERE entrant_id IN (${sql.join(entrants.map((entrant) => sql`${entrant.id}`), sql`, `)})
        GROUP BY entrant_id
      `);
      if (rosterCounts.rows.length !== entrants.length || rosterCounts.rows.some((row) => Number(row.count) < season.minTeamSize || Number(row.count) > season.maxTeamSize)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "存在不符合人数规则的最终赛事名单。 ");
      }
      const duplicate = await tx.execute(sql`
        SELECT r.user_id FROM major_prestart_roster_members r
        INNER JOIN major_prestart_entrants e ON e.id = r.entrant_id
        WHERE e.season_id = ${season.id}
        GROUP BY r.user_id HAVING count(*) > 1 LIMIT 1
      `);
      if (duplicate.rows.length > 0) throw new AppError(ErrorCode.VALIDATION_FAILED, "最终赛事名单存在重复选手。 ");
      const unresolved = await tx.query.majorPrestartIssues.findFirst({
        where: and(eq(majorPrestartIssues.seasonId, season.id), sql`${majorPrestartIssues.resolvedAt} IS NULL`),
      });
      if (unresolved) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先处理所有资格和管理事项。 ");
      await tx.update(majorPrestartStates).set({ entrantsLockedAt: new Date(), entrantsLockedBy: auditActorId(admin), updatedAt: new Date() })
        .where(eq(majorPrestartStates.id, state.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.lock_entrants", actorId: auditActorId(admin),
        targetId: state.id, targetType: "major_prestart_state", meta: { entrantCount: entrants.length },
      });
    });
    revalidateMajorPrestart(season.slug);
    return ok(undefined);
  } catch (error) { return actionError("lockMajorPrestartEntrants", error); }
}

export async function saveMajorTournamentSeeds(input: { seasonId: string; teamIds: string[] }): Promise<ActionResult<void>> {
  const parsed = z.object({ seasonId: uuid, teamIds: z.array(uuid).length(32) }).safeParse(input);
  if (!parsed.success) return invalid("赛事种子必须提供恰好 32 支队伍。 ");
  if (new Set(parsed.data.teamIds).size !== 32) return invalid("赛事种子不能包含重复队伍。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    await db.transaction(async (tx) => {
      const state = await ensureState(tx, season.id);
      if (state.seedsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已经正式开赛，不能修改赛事种子。 ");
      if (!state.entrantsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先锁定正式参赛队和最终赛事名单。 ");
      const entrants = await tx.select({ id: majorPrestartEntrants.id, teamId: majorPrestartEntrants.teamId }).from(majorPrestartEntrants)
        .where(eq(majorPrestartEntrants.seasonId, season.id));
      const entrantsByTeamId = new Map(entrants.map((entrant) => [entrant.teamId, entrant]));
      if (entrantsByTeamId.size !== 32 || parsed.data.teamIds.some((teamId) => !entrantsByTeamId.has(teamId))) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事种子必须且只能覆盖已锁定的 32 支正式参赛队。 ");
      }
      await tx.delete(majorTournamentSeeds).where(eq(majorTournamentSeeds.seasonId, season.id));
      await tx.insert(majorTournamentSeeds).values(parsed.data.teamIds.map((teamId, index) => ({
        seasonId: season.id, entrantId: entrantsByTeamId.get(teamId)!.id, tournamentSeed: index + 1,
      })));
      await tx.update(majorPrestartStates).set({
        seedRevision: state.seedRevision + 1,
        confirmedSeedRevision: null,
        updatedAt: new Date(),
      }).where(eq(majorPrestartStates.id, state.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.save_tournament_seeds", actorId: auditActorId(admin),
        targetId: state.id, targetType: "major_prestart_state", meta: { seedRevision: state.seedRevision + 1 },
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
      const state = await ensureState(tx, season.id);
      if (state.seedsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "赛事已经正式开赛，不能重新确认赛事种子。 ");
      if (!state.entrantsLockedAt) throw new AppError(ErrorCode.SEASON_INVALID_STATUS, "请先锁定正式参赛队和最终赛事名单。 ");
      if (state.seedRevision < 1) throw new AppError(ErrorCode.VALIDATION_FAILED, "请先保存赛事 1–32 种子排序。 ");
      const countResult = await tx.execute<{ seed_count: string; team_count: string }>(sql`
        SELECT count(*) AS seed_count, count(DISTINCT entrant_id) AS team_count
        FROM major_tournament_seeds WHERE season_id = ${season.id}
      `);
      const counts = countResult.rows[0];
      if (Number(counts?.seed_count) !== 32 || Number(counts?.team_count) !== 32) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, "赛事种子不完整，不能确认。 ");
      }
      await tx.update(majorPrestartStates).set({ confirmedSeedRevision: state.seedRevision, updatedAt: new Date() })
        .where(eq(majorPrestartStates.id, state.id));
      await tx.insert(auditLogs).values({
        seasonId: season.id, action: "major_prestart.confirm_tournament_seeds", actorId: auditActorId(admin),
        targetId: state.id, targetType: "major_prestart_state", meta: { seedRevision: state.seedRevision },
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
    const result = await db.transaction((tx) => startMajorInTransaction(tx, {
      seasonId: season.id,
      actorId: auditActorId(admin),
    }));
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
    const result = await db.transaction((tx) => finalizeMajorSwissRoundInTransaction(tx, {
      seasonId: season.id,
      stageRunId: parsed.data.stageRunId,
      expectedRound: parsed.data.expectedRound,
      actorId: auditActorId(admin),
    }));
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
    const result = await db.transaction((tx) => transitionMajorSwissStageInTransaction(tx, {
      seasonId: season.id,
      sourceStageRunId: parsed.data.sourceStageRunId,
      actorId: auditActorId(admin),
    }));
    revalidateMajorPrestart(season.slug);
    revalidateSeasonPaths(season.slug, ["matches", "adminMatches"]);
    return ok(result);
  } catch (error) { return actionError("transitionMajorSwissStage", error); }
}

export async function startMajorPlayoff(input: { seasonId: string; sourceStageRunId: string }): Promise<ActionResult<MajorPlayoffStartResult>> {
  const parsed = z.object({ seasonId: uuid, sourceStageRunId: uuid }).safeParse(input);
  if (!parsed.success) return invalid("淘汰赛启动请求无效。 ");
  try {
    const { season, admin } = await seasonAndAdminOrThrow(parsed.data.seasonId);
    const result = await db.transaction((tx) => startMajorPlayoffInTransaction(tx, {
      seasonId: season.id, sourceStageRunId: parsed.data.sourceStageRunId, actorId: auditActorId(admin),
    }));
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
