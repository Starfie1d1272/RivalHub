import { and, eq, gt, isNull, or } from "drizzle-orm";
import { seasons } from "@/db/schema";
import { canSelfManageEventRoster } from "@/lib/registration/window";

const RECRUITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RecruitmentTargetSeason = Pick<typeof seasons.$inferSelect, "status" | "registrationClosesAt" | "rosterChangeClosesAt">;

/**
 * Recruitment is available for every published participation window, including
 * unscheduled/upcoming registration, and remains available after new
 * applications close only while an approved Entry can still self-manage its
 * event roster. This is shared by writes, public reads, workspace state, and
 * target selectors.
 */
export function isRecruitmentTargetAvailable(season: RecruitmentTargetSeason, now: Date): boolean {
  return canSelfManageEventRoster(season, now);
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
