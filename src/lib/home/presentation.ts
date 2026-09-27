import type { PublicSeason } from "@/lib/data/public-seasons";
import { isRegistrationActuallyOpen } from "@/lib/seasons/presentation";

export function shouldLoadRegistrationPositionCounts(
  season: Pick<PublicSeason, "status" | "registrationMode" | "registrationOpensAt" | "registrationOpenedAt" | "registrationClosesAt">,
): boolean {
  return season.registrationMode === "solo" && isRegistrationActuallyOpen(season);
}
