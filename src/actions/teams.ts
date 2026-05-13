"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import { auditLogs, seasonRegistrations, seasons, teams } from "@/db/schema";
import { actionError, failValidation } from "@/lib/action-utils";
import { AppError, ErrorCode } from "@/lib/errors";
import { auditActorId, requireAuth } from "@/lib/auth/session";
import { ok, type ActionResult } from "@/types/action";

const MIN_TEAM_NAME_LENGTH = 2;
const MAX_TEAM_NAME_LENGTH = 32;

export async function updateTeamName(
  teamId: string,
  rawName: string,
): Promise<ActionResult<void>> {
  const name = rawName.trim();
  if (name.length < MIN_TEAM_NAME_LENGTH || name.length > MAX_TEAM_NAME_LENGTH) {
    return failValidation(`队伍名称需为 ${MIN_TEAM_NAME_LENGTH}-${MAX_TEAM_NAME_LENGTH} 个字符`);
  }

  try {
    const session = await requireAuth();
    const result = await db.transaction(async (tx) => {
      const team = await tx.query.teams.findFirst({
        where: eq(teams.id, teamId),
      });
      if (!team) {
        throw new AppError(ErrorCode.NOT_FOUND, "队伍不存在");
      }

      const registration = await tx.query.seasonRegistrations.findFirst({
        where: and(
          eq(seasonRegistrations.seasonId, team.seasonId),
          eq(seasonRegistrations.userId, session.userId),
        ),
      });
      if (!registration || registration.id !== team.captainRegistrationId) {
        throw new AppError(ErrorCode.FORBIDDEN, "只有队长可以修改队伍名称");
      }

      const season = await tx.query.seasons.findFirst({
        where: eq(seasons.id, team.seasonId),
      });
      if (!season) {
        throw new AppError(ErrorCode.SEASON_NOT_FOUND, "赛季不存在");
      }

      if (team.name !== name) {
        await tx.update(teams).set({ name }).where(eq(teams.id, team.id));
        await tx.insert(auditLogs).values({
          seasonId: team.seasonId,
          action: "team.rename",
          actorId: auditActorId(session),
          targetId: team.id,
          targetType: "team",
          meta: { from: team.name, to: name },
        });
      }

      return { seasonSlug: season.slug };
    });

    revalidatePath(`/${result.seasonSlug}/teams`);
    revalidatePath(`/${result.seasonSlug}/teams/${teamId}`);
    revalidatePath(`/${result.seasonSlug}/draft`);
    revalidatePath(`/${result.seasonSlug}/draft/captain`);

    return ok(undefined);
  } catch (e) {
    return actionError("updateTeamName", e);
  }
}
