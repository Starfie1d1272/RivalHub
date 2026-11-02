import type { Season } from "@/db/schema/seasons";

/** A v2 solo Major remains in formation while its normal prestart runs. */
export function isMajorPrestartPhase(season: Pick<Season, "status" | "registrationMode" | "teamRegistrationConfig">): boolean {
  return season.status === "registration" || (season.status === "drafting" && season.registrationMode === "solo" && season.teamRegistrationConfig.qualificationPolicy?.version === 2);
}
