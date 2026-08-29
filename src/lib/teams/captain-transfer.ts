import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLogs, majorPrestartEntrants, seasons, teamMembers, teams } from "@/db/schema";
import { AppError, ErrorCode } from "@/lib/errors";
import { getRegistrationWindowState } from "@/lib/registration/window";
import { normalizeTeamRegistrationConfig } from "@/types/season";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface FormalCaptainTransferInput {
  teamId: string;
  toUserId: string;
  actorUserId: string;
  /**
   * Auth boundary owned by the calling Server Action. Invoked only when the
   * actor is not the locked current captain; must throw unless the actor is a
   * current-season admin, super_admin or emergency Root.
   */
  assertSeasonAdmin: (seasonId: string) => Promise<void>;
}

export interface FormalCaptainTransferResult {
  seasonSlug: string;
  fromUserId: string;
  toUserId: string;
  emergencyOverride: boolean;
}

/**
 * Formal team captain transfer. Every authority and state check reads rows
 * locked inside this transaction: team row → season lifecycle row → Major
 * entrant (when present) → target team_member. Concurrent transfers or roster
 * locks therefore serialize on the locked current captain state.
 */
export async function transferFormalTeamCaptainInTransaction(tx: Transaction, input: FormalCaptainTransferInput): Promise<FormalCaptainTransferResult> {
  await tx.execute(sql`SELECT id FROM teams WHERE id = ${input.teamId} FOR UPDATE`);
  const team = await tx.query.teams.findFirst({ where: eq(teams.id, input.teamId) });
  if (!team) throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在。");

  let emergencyOverride = false;
  if (team.captainUserId !== input.actorUserId) {
    await input.assertSeasonAdmin(team.seasonId);
    emergencyOverride = true;
  }

  await tx.execute(sql`SELECT id FROM seasons WHERE id = ${team.seasonId} FOR UPDATE`);
  const season = await tx.query.seasons.findFirst({ where: eq(seasons.id, team.seasonId) });
  if (!season) throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在。");

  await tx.execute(sql`SELECT id FROM major_prestart_entrants WHERE season_id = ${team.seasonId} AND team_id = ${team.id} FOR UPDATE`);
  const entrant = await tx.query.majorPrestartEntrants.findFirst({
    where: and(eq(majorPrestartEntrants.seasonId, team.seasonId), eq(majorPrestartEntrants.teamId, team.id)),
    columns: { rosterConfirmedAt: true },
  });

  const teamConfig = normalizeTeamRegistrationConfig(season.teamRegistrationConfig);
  if (!emergencyOverride) {
    if (!teamConfig.captainCanTransfer) throw new AppError(ErrorCode.FORBIDDEN, "当前赛事不允许队长交接。");
    const window = getRegistrationWindowState(season);
    if (season.status !== "registration" || !window.canSubmit || entrant?.rosterConfirmedAt) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, "正式名单已锁定或赛事已进入赛务阶段，只有管理员可以执行队长交接。");
    }
  }

  await tx.execute(sql`SELECT id FROM team_members WHERE team_id = ${team.id} AND user_id = ${input.toUserId} FOR UPDATE`);
  const member = await tx.query.teamMembers.findFirst({
    where: and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, input.toUserId)),
  });
  if (!member) throw new AppError(ErrorCode.VALIDATION_FAILED, "新队长必须是当前正式队伍成员。");

  await tx.update(teams).set({ captainUserId: input.toUserId }).where(eq(teams.id, team.id));
  await tx.insert(auditLogs).values({
    seasonId: team.seasonId,
    action: "team.transfer_captain",
    actorId: input.actorUserId,
    targetId: team.id,
    targetType: "team",
    meta: { fromUserId: team.captainUserId, toUserId: input.toUserId, emergencyOverride },
  });
  return { seasonSlug: season.slug, fromUserId: team.captainUserId, toUserId: input.toUserId, emergencyOverride };
}
