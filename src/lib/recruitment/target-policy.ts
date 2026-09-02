import { and, eq, gt, isNull, or, sql, type SQLWrapper } from "drizzle-orm";
import { competitionEntries, seasons } from "@/db/schema";

const RECRUITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RecruitmentTargetSeason = Pick<typeof seasons.$inferSelect, "status" | "registrationClosesAt" | "rosterChangeClosesAt">;

/**
 * Recruitment is available for every published participation window, including
 * unscheduled/upcoming registration, and remains available after new
 * applications close only while an approved Entry can still self-manage its
 * event roster. This is shared by writes, public reads, workspace state, and
 * target selectors.
 */
export function canRecruitForSeason(season: RecruitmentTargetSeason, now: Date): boolean {
  if (season.status !== "registration") return false;
  const deadline = season.rosterChangeClosesAt ?? season.registrationClosesAt;
  return !deadline || deadline > now;
}

export function isRecruitmentTargetAvailable(season: RecruitmentTargetSeason, now: Date): boolean {
  return canRecruitForSeason(season, now);
}

/** After new applications close, Team recruitment remains public only for a
 * Team that already has an effective Entry whose roster can still change. */
export function isTeamRecruitmentTargetAvailable(season: RecruitmentTargetSeason, hasEffectiveEntry: boolean, now: Date): boolean {
  return isRecruitmentTargetAvailable(season, now)
    && (!season.registrationClosesAt || season.registrationClosesAt > now || hasEffectiveEntry);
}

export function recruitmentTargetExpiresAt(season: RecruitmentTargetSeason | null, now: Date): Date {
  const ordinaryExpiry = new Date(now.getTime() + RECRUITMENT_TTL_MS);
  const deadline = season?.rosterChangeClosesAt ?? season?.registrationClosesAt;
  if (season?.status !== "registration" || !deadline) return ordinaryExpiry;
  return deadline < ordinaryExpiry ? deadline : ordinaryExpiry;
}

/** SQL projection of isRecruitmentTargetAvailable for the public read model. */
export function recruitmentTargetAvailableCondition(now: Date) {
  return or(
    and(
      eq(seasons.status, "registration"),
      or(
        gt(seasons.rosterChangeClosesAt, now),
        and(isNull(seasons.rosterChangeClosesAt), or(isNull(seasons.registrationClosesAt), gt(seasons.registrationClosesAt, now))),
      ),
    ),
  );
}

export function teamRecruitmentTargetAvailableCondition(now: Date, teamId: SQLWrapper) {
  return and(
    recruitmentTargetAvailableCondition(now),
    or(
      isNull(seasons.registrationClosesAt),
      gt(seasons.registrationClosesAt, now),
      sql`exists (select 1 from ${competitionEntries} where ${competitionEntries.competitionId} = ${seasons.id} and ${competitionEntries.teamId} = ${teamId} and ${competitionEntries.registrationStatus} not in ('rejected', 'withdrawn'))`,
    ),
  );
}
