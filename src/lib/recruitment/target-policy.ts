import { and, eq, gt, isNull, or } from "drizzle-orm";
import { seasons } from "@/db/schema";

const RECRUITMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type RecruitmentTargetSeason = Pick<typeof seasons.$inferSelect, "status" | "registrationDeadline">;

/**
 * Recruitment may form around an unpublished future event, but not once the
 * competition has moved beyond registration. This is intentionally narrower
 * than the generic Season lifecycle and shared by writes, public reads, and
 * target selectors.
 */
export function isRecruitmentTargetAvailable(season: RecruitmentTargetSeason, now: Date): boolean {
  if (season.status === "draft") return true;
  return season.status === "registration" && (!season.registrationDeadline || season.registrationDeadline > now);
}

export function recruitmentTargetExpiresAt(season: RecruitmentTargetSeason | null, now: Date): Date {
  const ordinaryExpiry = new Date(now.getTime() + RECRUITMENT_TTL_MS);
  if (season?.status !== "registration" || !season.registrationDeadline) return ordinaryExpiry;
  return season.registrationDeadline < ordinaryExpiry ? season.registrationDeadline : ordinaryExpiry;
}

/** SQL projection of isRecruitmentTargetAvailable for the public read model. */
export function recruitmentTargetAvailableCondition(now: Date) {
  return or(
    eq(seasons.status, "draft"),
    and(eq(seasons.status, "registration"), or(isNull(seasons.registrationDeadline), gt(seasons.registrationDeadline, now))),
  );
}
