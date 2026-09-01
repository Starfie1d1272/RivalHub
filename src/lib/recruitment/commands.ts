import { and, eq, sql } from "drizzle-orm";
import type { TxDb } from "@/db/client";
import { auditLogs, recruitmentIntents, recruitmentInterests, seasons, teams } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import type { Cs2Position } from "@/lib/config/cs2-positions";

const RECRUITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function auditRecruitment(tx: TxDb, action: string, actorId: string, targetId: string, targetType: "recruitment_intent" | "recruitment_interest", meta?: Record<string, unknown>) {
  await tx.insert(auditLogs).values({ seasonId: null, action, actorId, targetId, targetType, meta: meta ?? null });
}

async function lockTeam(tx: TxDb, teamId: string) {
  const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
  if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");
  return team;
}

async function requireLockedCaptain(tx: TxDb, teamId: string, userId: string) {
  const team = await lockTeam(tx, teamId);
  if (team.status !== "active") throw new AppError(ErrorCode.VALIDATION_FAILED, "队伍已解散。");
  if (team.captainUserId !== userId) throw new AppError(ErrorCode.FORBIDDEN, "只有当前队长可以管理队伍招募。");
  return team;
}

async function lockUser(tx: TxDb, userId: string) {
  const result = await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
  if (result.rowCount !== 1) throw new AppError(ErrorCode.NOT_FOUND, "用户不存在。");
}

async function recruitmentExpiry(tx: TxDb, targetSeasonId: string | null, now: Date): Promise<Date> {
  const ordinaryExpiry = new Date(now.getTime() + RECRUITMENT_TTL_MS);
  if (!targetSeasonId) return ordinaryExpiry;
  const [season] = await tx.select().from(seasons).where(eq(seasons.id, targetSeasonId)).for("update");
  if (!season || ["finished", "archived"].includes(season.status)) throw new AppError(ErrorCode.VALIDATION_FAILED, "目标赛事不可用于公开组队。");
  if (season.registrationDeadline && season.registrationDeadline.getTime() <= now.getTime()) throw new AppError(ErrorCode.VALIDATION_FAILED, "目标赛事报名已截止。");
  return season.registrationDeadline && season.registrationDeadline < ordinaryExpiry ? season.registrationDeadline : ordinaryExpiry;
}

export async function upsertTeamRecruitmentInTx(
  tx: TxDb,
  input: { teamId: string; userId: string; actorId: string; positions: Cs2Position[]; targetSeasonId: string | null; note: string | null },
): Promise<{ id: string; expiresAt: Date }> {
  await requireLockedCaptain(tx, input.teamId, input.userId);
  const now = new Date();
  const expiresAt = await recruitmentExpiry(tx, input.targetSeasonId, now);
  const [existing] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.teamId, input.teamId)).for("update");
  if (existing) {
    const [intent] = await tx.update(recruitmentIntents).set({ positions: input.positions, targetSeasonId: input.targetSeasonId, note: input.note, status: "open", expiresAt, updatedAt: now }).where(eq(recruitmentIntents.id, existing.id)).returning({ id: recruitmentIntents.id, expiresAt: recruitmentIntents.expiresAt });
    if (existing.status !== "open" || existing.expiresAt <= now) {
      await tx.delete(recruitmentInterests).where(eq(recruitmentInterests.recruitmentIntentId, existing.id));
    }
    await auditRecruitment(tx, "recruitment.team.upsert", input.actorId, existing.id, "recruitment_intent", { teamId: input.teamId, positions: input.positions, targetSeasonId: input.targetSeasonId });
    return intent;
  }
  const [intent] = await tx.insert(recruitmentIntents).values({ kind: "team_recruiting", teamId: input.teamId, positions: input.positions, targetSeasonId: input.targetSeasonId, note: input.note, expiresAt }).returning({ id: recruitmentIntents.id, expiresAt: recruitmentIntents.expiresAt });
  await auditRecruitment(tx, "recruitment.team.create", input.actorId, intent.id, "recruitment_intent", { teamId: input.teamId, positions: input.positions, targetSeasonId: input.targetSeasonId });
  return intent;
}

export async function closeTeamRecruitmentInTx(tx: TxDb, input: { teamId: string; userId: string; actorId: string }): Promise<void> {
  await requireLockedCaptain(tx, input.teamId, input.userId);
  const [intent] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.teamId, input.teamId)).for("update");
  if (!intent || intent.status === "closed") throw new AppError(ErrorCode.NOT_FOUND, "当前没有公开招募信息。");
  await tx.update(recruitmentIntents).set({ status: "closed", updatedAt: new Date() }).where(eq(recruitmentIntents.id, intent.id));
  await tx.delete(recruitmentInterests).where(eq(recruitmentInterests.recruitmentIntentId, intent.id));
  await auditRecruitment(tx, "recruitment.team.close", input.actorId, intent.id, "recruitment_intent", { teamId: input.teamId });
}

/** Called by the Team lifecycle owner; its disband audit is the canonical record. */
export async function closeTeamRecruitmentForDisbandInTx(tx: TxDb, teamId: string): Promise<void> {
  const [intent] = await tx.select().from(recruitmentIntents).where(and(eq(recruitmentIntents.teamId, teamId), eq(recruitmentIntents.status, "open"))).for("update");
  if (!intent) return;
  await tx.update(recruitmentIntents).set({ status: "closed", updatedAt: new Date() }).where(eq(recruitmentIntents.id, intent.id));
  await tx.delete(recruitmentInterests).where(eq(recruitmentInterests.recruitmentIntentId, intent.id));
}

export async function upsertPlayerLftInTx(
  tx: TxDb,
  input: { userId: string; actorId: string; positions: Cs2Position[]; targetSeasonId: string | null; note: string | null },
): Promise<{ id: string; expiresAt: Date }> {
  await lockUser(tx, input.userId);
  const now = new Date();
  const expiresAt = await recruitmentExpiry(tx, input.targetSeasonId, now);
  const [existing] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.userId, input.userId)).for("update");
  if (existing) {
    const [intent] = await tx.update(recruitmentIntents).set({ positions: input.positions, targetSeasonId: input.targetSeasonId, note: input.note, status: "open", expiresAt, updatedAt: now }).where(eq(recruitmentIntents.id, existing.id)).returning({ id: recruitmentIntents.id, expiresAt: recruitmentIntents.expiresAt });
    await auditRecruitment(tx, "recruitment.player.upsert", input.actorId, existing.id, "recruitment_intent", { positions: input.positions, targetSeasonId: input.targetSeasonId });
    return intent;
  }
  const [intent] = await tx.insert(recruitmentIntents).values({ kind: "player_lft", userId: input.userId, positions: input.positions, targetSeasonId: input.targetSeasonId, note: input.note, expiresAt }).returning({ id: recruitmentIntents.id, expiresAt: recruitmentIntents.expiresAt });
  await auditRecruitment(tx, "recruitment.player.create", input.actorId, intent.id, "recruitment_intent", { positions: input.positions, targetSeasonId: input.targetSeasonId });
  return intent;
}

export async function closePlayerLftInTx(tx: TxDb, input: { userId: string; actorId?: string }): Promise<void> {
  await lockUser(tx, input.userId);
  const [intent] = await tx.select().from(recruitmentIntents).where(and(eq(recruitmentIntents.userId, input.userId), eq(recruitmentIntents.status, "open"))).for("update");
  if (!intent) return;
  await tx.update(recruitmentIntents).set({ status: "closed", updatedAt: new Date() }).where(eq(recruitmentIntents.id, intent.id));
  if (input.actorId) await auditRecruitment(tx, "recruitment.player.close", input.actorId, intent.id, "recruitment_intent");
}

export async function expressRecruitmentInterestInTx(tx: TxDb, input: { recruitmentIntentId: string; userId: string; actorId: string }): Promise<void> {
  await lockUser(tx, input.userId);
  const [intent] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.id, input.recruitmentIntentId)).for("update");
  if (!intent || intent.kind !== "team_recruiting" || intent.status !== "open" || intent.expiresAt <= new Date()) throw new AppError(ErrorCode.NOT_FOUND, "该招募信息已不再公开。");
  const team = await lockTeam(tx, intent.teamId!);
  if (team.status !== "active") throw new AppError(ErrorCode.NOT_FOUND, "该招募信息已不再公开。");
  if (team.captainUserId === input.userId) throw new AppError(ErrorCode.VALIDATION_FAILED, "不能向自己的队伍表达加入意向。");
  const [interest] = await tx.insert(recruitmentInterests).values({ recruitmentIntentId: intent.id, userId: input.userId }).onConflictDoNothing().returning({ id: recruitmentInterests.id });
  if (!interest) throw new AppError(ErrorCode.REGISTRATION_DUPLICATE, "你已表达过加入意向。");
  await auditRecruitment(tx, "recruitment.interest.create", input.actorId, interest.id, "recruitment_interest", { recruitmentIntentId: intent.id, teamId: intent.teamId });
}

export async function withdrawRecruitmentInterestInTx(tx: TxDb, input: { recruitmentIntentId: string; userId: string; actorId: string }): Promise<void> {
  await lockUser(tx, input.userId);
  const [interest] = await tx.select().from(recruitmentInterests).where(and(eq(recruitmentInterests.recruitmentIntentId, input.recruitmentIntentId), eq(recruitmentInterests.userId, input.userId))).for("update");
  if (!interest) throw new AppError(ErrorCode.NOT_FOUND, "加入意向不存在。");
  await tx.delete(recruitmentInterests).where(eq(recruitmentInterests.id, interest.id));
  await auditRecruitment(tx, "recruitment.interest.withdraw", input.actorId, interest.id, "recruitment_interest", { recruitmentIntentId: input.recruitmentIntentId });
}

export async function dismissRecruitmentInterestInTx(tx: TxDb, input: { recruitmentIntentId: string; interestUserId: string; userId: string; actorId: string }): Promise<void> {
  const [intent] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.id, input.recruitmentIntentId)).for("update");
  if (!intent || intent.kind !== "team_recruiting") throw new AppError(ErrorCode.NOT_FOUND, "队伍招募不存在。");
  await requireLockedCaptain(tx, intent.teamId!, input.userId);
  const [interest] = await tx.select().from(recruitmentInterests).where(and(eq(recruitmentInterests.recruitmentIntentId, intent.id), eq(recruitmentInterests.userId, input.interestUserId))).for("update");
  if (!interest) throw new AppError(ErrorCode.NOT_FOUND, "加入意向不存在。");
  await tx.delete(recruitmentInterests).where(eq(recruitmentInterests.id, interest.id));
  await auditRecruitment(tx, "recruitment.interest.dismiss", input.actorId, interest.id, "recruitment_interest", { recruitmentIntentId: intent.id, teamId: intent.teamId, userId: input.interestUserId });
}

export async function removeInterestAfterInvitationInTx(tx: TxDb, input: { recruitmentIntentId: string; teamId: string; userId: string }): Promise<void> {
  const [intent] = await tx.select().from(recruitmentIntents).where(eq(recruitmentIntents.id, input.recruitmentIntentId)).for("update");
  if (!intent || intent.kind !== "team_recruiting" || intent.teamId !== input.teamId) throw new AppError(ErrorCode.FORBIDDEN, "该加入意向不属于当前队伍。");
  await tx.delete(recruitmentInterests).where(and(eq(recruitmentInterests.recruitmentIntentId, input.recruitmentIntentId), eq(recruitmentInterests.userId, input.userId)));
}
